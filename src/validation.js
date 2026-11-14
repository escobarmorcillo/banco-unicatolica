// Reglas de validación compartidas por las rutas de la API.

const ACCOUNT_TYPES = ['Ahorros', 'Corriente', 'Nomina'];
const ACCOUNT_STATES = ['activo', 'inactivo'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAtLeastFifteen(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const [year, month, day] = dateString.split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return false;
  const today = new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 15, today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= cutoff;
}

function validateCustomer(payload) {
  if (!/^\d{1,10}$/.test(payload.documento)) {
    return 'El documento debe contener solo números y tener máximo 10 dígitos.';
  }
  if (!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(payload.nombres)) {
    return 'Los nombres solo pueden contener letras y espacios.';
  }
  if (!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(payload.apellidos)) {
    return 'Los apellidos solo pueden contener letras y espacios.';
  }
  if (!isAtLeastFifteen(payload.fecha_nacimiento)) {
    return 'El cliente debe tener mínimo 15 años. Verifica la fecha de nacimiento.';
  }
  if (!/^\d{10}$/.test(payload.telefono)) {
    return 'El teléfono debe contener exactamente 10 números.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.correo)) {
    return 'El correo electrónico no tiene un formato válido.';
  }
  if (payload.direccion.length < 2) {
    return 'La dirección del cliente es obligatoria.';
  }
  return '';
}

// Convierte un monto en texto a centavos. Devuelve null si no es válido.
function parseValidMoney(value, allowZero = false) {
  const normalized = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? { amount, cents } : null;
}

// Identificador numérico de la URL (/api/customers/:id). Devuelve null si no es válido.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

module.exports = {
  ACCOUNT_TYPES,
  ACCOUNT_STATES,
  isAtLeastFifteen,
  validateCustomer,
  parseValidMoney,
  parseId,
  isUuid,
};
