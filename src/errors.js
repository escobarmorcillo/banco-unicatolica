// Manejo centralizado de errores de la API.

// Error de negocio: su mensaje sí se muestra al usuario.
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 4 no captura errores de funciones async; este envoltorio los pasa a errorHandler.
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function apiNotFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado.' });
}

// Errores de negocio lanzados por las funciones SQL (códigos NB400, NB403, NB404, NB409).
function databaseBusinessStatus(error) {
  const match = /^NB(400|403|404|409)$/.exec(error.code || '');
  return match ? Number(match[1]) : null;
}

function isUniqueViolation(error) {
  return error.code === '23505';
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const businessStatus = databaseBusinessStatus(error);
  if (businessStatus) {
    res.status(businessStatus).json({ error: error.message });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
    return;
  }
  if (isUniqueViolation(error)) {
    res.status(409).json({ error: 'El registro ya existe en el sistema.' });
    return;
  }
  // Errores internos: se registran en el servidor, pero no se muestran al usuario.
  console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(500).json({ error: 'Ocurrió un error interno. Intenta nuevamente.' });
}

module.exports = { AppError, asyncHandler, apiNotFound, errorHandler };
