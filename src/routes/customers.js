const express = require('express');
const { promisifyAll, promisifyGet, promisifyRun } = require('../database');
const { validateCustomer, dateNow } = require('../validation');
const { AppError, asyncHandler } = require('../errors');

const CUSTOMER_FIELDS = ['tipo_documento', 'documento', 'nombres', 'apellidos', 'fecha_nacimiento', 'telefono', 'correo', 'direccion'];

// Toma cada campo del cuerpo; si no viene, usa el valor actual (para actualizar).
function readCustomerPayload(body, current = {}) {
  const payload = {};
  for (const field of CUSTOMER_FIELDS) {
    payload[field] = (body[field] || current[field] || '').trim();
  }
  return payload;
}

function createCustomersRouter(database) {
  const router = express.Router();

  async function getCustomerOr404(customerId) {
    const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
    if (!customer) throw new AppError(404, 'Cliente no encontrado.');
    return customer;
  }

  router.get('/', asyncHandler(async (req, res) => {
    const doc = (req.query.document || '').trim();
    const sql = doc
      ? 'SELECT * FROM clientes WHERE documento = ? ORDER BY id DESC'
      : 'SELECT * FROM clientes ORDER BY id DESC';
    const rows = await promisifyAll(database, sql, doc ? [doc] : []);
    res.json(rows.map((row) => ({ ...row, estado: row.estado || 'activo' })));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const payload = readCustomerPayload(req.body || {});

    const missing = Object.values(payload).some((value) => !value || value.length < 2);
    if (missing) {
      throw new AppError(400, 'Todos los campos obligatorios deben estar completos.');
    }

    const validationError = validateCustomer(payload);
    if (validationError) throw new AppError(400, validationError);

    const existingDoc = await promisifyGet(database, 'SELECT id FROM clientes WHERE documento = ?', [payload.documento]);
    if (existingDoc) throw new AppError(409, 'El documento ya existe en el sistema.');

    const result = await promisifyRun(database, `
      INSERT INTO clientes (tipo_documento, documento, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion, estado, fecha_creacion, fecha_actualizacion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?, ?)
    `, [payload.tipo_documento, payload.documento, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.telefono, payload.correo, payload.direccion, dateNow(), dateNow()]);

    const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [result.id]);
    res.status(201).json({ customer, message: 'Cliente registrado correctamente.' });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const customerId = Number(req.params.id);
    const row = await getCustomerOr404(customerId);
    const payload = readCustomerPayload(req.body || {}, row);

    const validationError = validateCustomer(payload);
    if (validationError) throw new AppError(400, validationError);

    const duplicate = await promisifyGet(database, 'SELECT id FROM clientes WHERE documento = ? AND id != ?', [payload.documento, customerId]);
    if (duplicate) throw new AppError(409, 'El documento ya existe para otro cliente.');

    await promisifyRun(database, `
      UPDATE clientes
      SET tipo_documento = ?, documento = ?, nombres = ?, apellidos = ?, fecha_nacimiento = ?, telefono = ?, correo = ?, direccion = ?, fecha_actualizacion = ?
      WHERE id = ?
    `, [payload.tipo_documento, payload.documento, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.telefono, payload.correo, payload.direccion, dateNow(), customerId]);

    const updated = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
    res.json({ customer: updated, message: 'Cliente actualizado correctamente.' });
  }));

  router.post('/:id/inactivate', asyncHandler(async (req, res) => {
    const customerId = Number(req.params.id);
    await getCustomerOr404(customerId);

    const activeAccounts = await promisifyAll(database, 'SELECT id FROM cuentas WHERE cliente_id = ? AND estado = ?', [customerId, 'activo']);
    if (activeAccounts.length > 0) {
      throw new AppError(409, 'No se puede inactivar el cliente porque tiene cuentas activas asociadas.');
    }

    await promisifyRun(database, 'UPDATE clientes SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['inactivo', dateNow(), customerId]);
    const updated = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
    res.json({ customer: updated, message: 'Cliente inactivado correctamente.' });
  }));

  router.post('/:id/activate', asyncHandler(async (req, res) => {
    const customerId = Number(req.params.id);
    const customer = await getCustomerOr404(customerId);
    if (customer.estado === 'activo') throw new AppError(409, 'El cliente ya está activo.');

    await promisifyRun(database, 'UPDATE clientes SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['activo', dateNow(), customerId]);
    const updated = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
    res.json({ customer: updated, message: 'Cliente activado correctamente.' });
  }));

  return router;
}

module.exports = { createCustomersRouter };
