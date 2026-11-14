const express = require('express');
const { queryOne } = require('../database');
const { validateCustomer, parseId } = require('../validation');
const { AppError, asyncHandler } = require('../errors');
const { ROLES, requireRole } = require('../auth/middleware');

const onlyAdmin = requireRole(ROLES.ADMIN);

const CUSTOMER_FIELDS = ['tipo_documento', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'telefono', 'correo', 'direccion'];

// Toma cada campo del cuerpo; si no viene, usa el valor actual (para actualizar).
function readCustomerPayload(body, current = {}) {
  const payload = {};
  for (const field of CUSTOMER_FIELDS) {
    payload[field] = String(body[field] || current[field] || '').trim();
  }
  return payload;
}

function createCustomersRouter(database) {
  const router = express.Router();

  async function getCustomerOr404(rawId) {
    const id = parseId(rawId);
    const customer = id && await queryOne(database, 'SELECT * FROM public.clientes WHERE id = $1', [id]);
    if (!customer) throw new AppError(404, 'Cliente no encontrado.');
    return customer;
  }

  async function setCustomerState(id, estado) {
    return queryOne(database, 'UPDATE public.clientes SET estado = $1 WHERE id = $2 RETURNING *', [estado, id]);
  }

  router.get('/', asyncHandler(async (req, res) => {
    const doc = String(req.query.document || '').trim();
    const rows = doc
      ? await database.query('SELECT * FROM public.clientes WHERE documento = $1 ORDER BY id DESC', [doc])
      : await database.query('SELECT * FROM public.clientes ORDER BY id DESC');
    res.json(rows);
  }));

  router.post('/', onlyAdmin, asyncHandler(async (req, res) => {
    const payload = readCustomerPayload(req.body || {});

    const missing = Object.values(payload).some((value) => !value || value.length < 2);
    if (missing) {
      throw new AppError(400, 'Todos los campos obligatorios deben estar completos.');
    }

    const validationError = validateCustomer(payload);
    if (validationError) throw new AppError(400, validationError);

    const existingDoc = await queryOne(database, 'SELECT id FROM public.clientes WHERE documento = $1', [payload.documento]);
    if (existingDoc) throw new AppError(409, 'El documento ya existe en el sistema.');

    const customer = await queryOne(database, `
      INSERT INTO public.clientes (tipo_documento, documento, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, CUSTOMER_FIELDS.map((field) => payload[field]));

    res.status(201).json({ customer, message: 'Cliente registrado correctamente.' });
  }));

  router.put('/:id', onlyAdmin, asyncHandler(async (req, res) => {
    const current = await getCustomerOr404(req.params.id);
    if (current.estado !== 'activo') throw new AppError(409, 'No se puede actualizar un cliente inactivo. Actívalo primero.');
    const payload = readCustomerPayload(req.body || {}, current);

    const validationError = validateCustomer(payload);
    if (validationError) throw new AppError(400, validationError);

    const duplicate = await queryOne(database, 'SELECT id FROM public.clientes WHERE documento = $1 AND id <> $2', [payload.documento, current.id]);
    if (duplicate) throw new AppError(409, 'El documento ya existe para otro cliente.');

    const customer = await queryOne(database, `
      UPDATE public.clientes
      SET tipo_documento = $1, documento = $2, nombres = $3, apellidos = $4, fecha_nacimiento = $5, telefono = $6, correo = $7, direccion = $8
      WHERE id = $9
      RETURNING *
    `, [...CUSTOMER_FIELDS.map((field) => payload[field]), current.id]);

    res.json({ customer, message: 'Cliente actualizado correctamente.' });
  }));

  router.post('/:id/inactivate', onlyAdmin, asyncHandler(async (req, res) => {
    const current = await getCustomerOr404(req.params.id);

    const activeAccount = await queryOne(database, "SELECT id FROM public.cuentas WHERE cliente_id = $1 AND estado = 'activo' LIMIT 1", [current.id]);
    if (activeAccount) {
      throw new AppError(409, 'No se puede inactivar el cliente porque tiene cuentas activas asociadas.');
    }

    const customer = await setCustomerState(current.id, 'inactivo');
    res.json({ customer, message: 'Cliente inactivado correctamente.' });
  }));

  router.post('/:id/activate', onlyAdmin, asyncHandler(async (req, res) => {
    const current = await getCustomerOr404(req.params.id);
    if (current.estado === 'activo') throw new AppError(409, 'El cliente ya está activo.');

    const customer = await setCustomerState(current.id, 'activo');
    res.json({ customer, message: 'Cliente activado correctamente.' });
  }));

  return router;
}

module.exports = { createCustomersRouter };
