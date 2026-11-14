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

function isUniqueViolation(error) {
  return error.code === '23505' || /UNIQUE constraint failed/i.test(error.message || '');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message });
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
