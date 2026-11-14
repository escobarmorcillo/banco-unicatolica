const { queryOne } = require('../database');
const { AppError, asyncHandler } = require('../errors');
const { isExpiredError } = require('./verify-token');

const ROLES = {
  ADMIN: 'administrador',
  CAJERO: 'cajero',
  CLIENTE: 'cliente',
};
const STAFF = [ROLES.ADMIN, ROLES.CAJERO];

// Exige una sesión válida y carga el perfil del usuario en req.user.
// 401: sin sesión, sesión inválida o expirada. 403: usuario sin perfil o inactivo.
function authenticate(database, verifyToken) {
  return asyncHandler(async (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new AppError(401, 'Debes iniciar sesión.', 'SIN_SESION');

    let payload;
    try {
      payload = await verifyToken(match[1]);
    } catch (error) {
      if (isExpiredError(error)) throw new AppError(401, 'Tu sesión expiró. Inicia sesión de nuevo.', 'SESION_EXPIRADA');
      throw new AppError(401, 'La sesión no es válida. Inicia sesión de nuevo.', 'SESION_INVALIDA');
    }

    const profile = await queryOne(database, `
      SELECT p.id, p.rol, p.nombre_completo, p.cliente_id, p.activo, u.email
      FROM public.perfiles p
      INNER JOIN auth.users u ON u.id = p.id
      WHERE p.id = $1
    `, [payload.sub]);
    if (!profile || !profile.activo) {
      throw new AppError(403, 'Tu usuario no tiene acceso a NovaBank. Contacta al administrador.', 'SIN_ACCESO');
    }

    req.user = profile;
    next();
  });
}

// Permite continuar solo a los roles indicados.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      next(new AppError(403, 'No tienes permiso para realizar esta acción.', 'SIN_PERMISO'));
      return;
    }
    next();
  };
}

module.exports = { ROLES, STAFF, authenticate, requireRole };
