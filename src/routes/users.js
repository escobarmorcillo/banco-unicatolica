const express = require('express');
const { queryOne } = require('../database');
const { ROLES } = require('../auth/middleware');
const { AppError, asyncHandler } = require('../errors');
const { isUuid } = require('../validation');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const USERS_SQL = `
  SELECT p.id, u.email, p.rol, p.nombre_completo, p.cliente_id, c.documento AS documento_cliente,
         p.activo, p.fecha_creacion
  FROM public.perfiles p
  INNER JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
`;

// Gestión de usuarios (solo administrador). Crea el usuario en Supabase Auth
// y su perfil con el rol en la tabla perfiles.
function createUsersRouter(database, userAdmin) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await database.query(`${USERS_SQL} ORDER BY p.fecha_creacion DESC`));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    if (!userAdmin) {
      throw new AppError(503, 'La creación de usuarios no está configurada en el servidor (falta SUPABASE_SECRET_KEY).');
    }

    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const rol = String(body.rol || '').trim();
    let nombreCompleto = String(body.nombre_completo || '').trim();
    const documentoCliente = String(body.documento_cliente || '').trim();

    if (!EMAIL_PATTERN.test(email)) throw new AppError(400, 'Escribe un correo electrónico válido.');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(400, `La contraseña inicial debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    if (!Object.values(ROLES).includes(rol)) throw new AppError(400, 'Selecciona un rol válido.');

    let clienteId = null;
    if (rol === ROLES.CLIENTE) {
      if (!documentoCliente) throw new AppError(400, 'Para un usuario cliente indica el documento del cliente.');
      const customer = await queryOne(database, 'SELECT id, nombres, apellidos, estado FROM public.clientes WHERE documento = $1', [documentoCliente]);
      if (!customer) throw new AppError(404, 'No existe un cliente con ese documento. Regístralo primero.');
      if (customer.estado !== 'activo') throw new AppError(409, 'El cliente está inactivo.');
      const linked = await queryOne(database, 'SELECT id FROM public.perfiles WHERE cliente_id = $1', [customer.id]);
      if (linked) throw new AppError(409, 'Ese cliente ya tiene un usuario.');
      clienteId = customer.id;
      if (!nombreCompleto) nombreCompleto = `${customer.nombres} ${customer.apellidos}`;
    }
    if (nombreCompleto.length < 2) throw new AppError(400, 'Escribe el nombre completo del usuario.');

    let created;
    try {
      created = await userAdmin.createUser({ email, password });
    } catch (error) {
      if (/already|exists|registered/i.test(error.message)) throw new AppError(409, 'Ya existe un usuario con ese correo.');
      if (/password/i.test(error.message)) throw new AppError(400, 'La contraseña no cumple los requisitos de seguridad.');
      throw error;
    }

    // Si falla el perfil, se elimina el usuario recién creado para no dejarlo a medias.
    try {
      await database.query(
        'INSERT INTO public.perfiles (id, rol, nombre_completo, cliente_id) VALUES ($1, $2, $3, $4)',
        [created.id, rol, nombreCompleto, clienteId]
      );
    } catch (error) {
      await userAdmin.deleteUser(created.id).catch(() => {});
      throw error;
    }

    const user = await queryOne(database, `${USERS_SQL} WHERE p.id = $1`, [created.id]);
    res.status(201).json({ user, message: 'Usuario creado correctamente.' });
  }));

  async function setActive(req, res, activo) {
    if (!isUuid(req.params.id)) throw new AppError(404, 'Usuario no encontrado.');
    if (req.params.id === req.user.id) throw new AppError(409, 'No puedes cambiar el estado de tu propio usuario.');
    const updated = await queryOne(database, 'UPDATE public.perfiles SET activo = $1 WHERE id = $2 RETURNING id', [activo, req.params.id]);
    if (!updated) throw new AppError(404, 'Usuario no encontrado.');
    const user = await queryOne(database, `${USERS_SQL} WHERE p.id = $1`, [req.params.id]);
    res.json({ user, message: activo ? 'Usuario activado correctamente.' : 'Usuario inactivado correctamente.' });
  }

  router.post('/:id/inactivate', asyncHandler((req, res) => setActive(req, res, false)));
  router.post('/:id/activate', asyncHandler((req, res) => setActive(req, res, true)));

  return router;
}

module.exports = { createUsersRouter };
