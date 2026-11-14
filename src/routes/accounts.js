const express = require('express');
const { promisifyAll, promisifyGet, promisifyRun, runTransaction } = require('../database');
const { ACCOUNT_TYPES, ACCOUNT_STATES, parseValidMoney, dateNow } = require('../validation');
const { AppError, asyncHandler } = require('../errors');

const ACCOUNT_WITH_OWNER_SQL = 'SELECT a.*, c.documento, c.nombres, c.apellidos FROM cuentas a INNER JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?';
const INACTIVE_OWNER_MESSAGE = 'No se puede activar la cuenta porque el cliente está inactivo. Activa primero el cliente.';
const NON_ZERO_BALANCE_MESSAGE = 'La cuenta no puede inactivarse porque su saldo no es cero.';

function createAccountsRouter(database) {
  const router = express.Router();

  async function getAccountOr404(id) {
    const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [id]);
    if (!account) throw new AppError(404, 'Cuenta no encontrada.');
    return account;
  }

  async function assertOwnerIsActive(account) {
    const owner = await promisifyGet(database, 'SELECT estado FROM clientes WHERE id = ?', [account.cliente_id]);
    if (!owner || owner.estado !== 'activo') throw new AppError(409, INACTIVE_OWNER_MESSAGE);
  }

  router.get('/', asyncHandler(async (req, res) => {
    const { number, search, customerId } = req.query;
    const filterByNumber = (number || '').trim();
    const searchTerm = (search || '').trim();
    const filterCustomerId = customerId ? Number(customerId) : null;

    let sql = `
      SELECT a.*, c.documento, c.nombres, c.apellidos
      FROM cuentas a
      INNER JOIN clientes c ON c.id = a.cliente_id
    `;
    const params = [];
    const clauses = [];

    if (filterByNumber) {
      clauses.push('a.numero_cuenta = ?');
      params.push(filterByNumber);
    }
    if (searchTerm) {
      clauses.push('(LOWER(a.numero_cuenta) LIKE LOWER(?) OR LOWER(c.documento) LIKE LOWER(?) OR LOWER(c.nombres) LIKE LOWER(?) OR LOWER(c.apellidos) LIKE LOWER(?))');
      const partial = `%${searchTerm}%`;
      params.push(partial, partial, partial, partial);
    }
    if (filterCustomerId) {
      clauses.push('a.cliente_id = ?');
      params.push(filterCustomerId);
    }
    if (clauses.length) {
      sql += ' WHERE ' + clauses.join(' AND ');
    }
    sql += ' ORDER BY a.id DESC';

    const rows = await promisifyAll(database, sql, params);
    res.json(rows.map((row) => ({ ...row, cliente: `${row.nombres} ${row.apellidos}` })));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const clienteId = Number(body.cliente_id);
    const numeroCuenta = (body.numero_cuenta || '').trim();
    const tipoCuenta = (body.tipo_cuenta || '').trim();
    const saldoInicial = parseValidMoney(body.saldo_inicial ?? '0', true);

    if (!clienteId) throw new AppError(400, 'Debe seleccionar un cliente titular válido.');
    if (!numeroCuenta || !tipoCuenta) throw new AppError(400, 'El número de cuenta y el tipo de cuenta son obligatorios.');
    if (!/^\d+$/.test(numeroCuenta)) throw new AppError(400, 'El número de cuenta solo puede contener números.');
    if (!ACCOUNT_TYPES.includes(tipoCuenta)) throw new AppError(400, 'Tipo de cuenta no válido.');
    if (!saldoInicial) {
      throw new AppError(400, 'El saldo inicial debe ser un monto válido, no negativo y con máximo dos decimales.');
    }

    const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [clienteId]);
    if (!customer) throw new AppError(404, 'El cliente titular no existe.');
    if (customer.estado !== 'activo') throw new AppError(409, 'No se puede crear una cuenta para un cliente inactivo.');

    const duplicate = await promisifyGet(database, 'SELECT id FROM cuentas WHERE numero_cuenta = ?', [numeroCuenta]);
    if (duplicate) throw new AppError(409, 'El número de cuenta ya existe.');

    const cents = saldoInicial.cents;
    const account = await runTransaction(database, async () => {
      const result = await promisifyRun(database, `
        INSERT INTO cuentas (cliente_id, numero_cuenta, tipo_cuenta, saldo, estado, fecha_creacion, fecha_actualizacion)
        VALUES (?, ?, ?, ?, 'activo', ?, ?)
      `, [clienteId, numeroCuenta, tipoCuenta, cents, dateNow(), dateNow()]);

      const createdAccount = await promisifyGet(database, ACCOUNT_WITH_OWNER_SQL, [result.id]);

      if (cents > 0) {
        await promisifyRun(database, `
          INSERT INTO transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora)
          VALUES (?, 'deposito', ?, 0, ?, 'Saldo inicial registrado', ?)
        `, [createdAccount.id, cents, cents, dateNow()]);
      }
      return createdAccount;
    });

    res.status(201).json({ account, message: 'Cuenta creada y saldo inicial registrado en el historial.' });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const account = await getAccountOr404(id);

    const body = req.body || {};
    const nextTipo = (body.tipo_cuenta || account.tipo_cuenta || '').trim();
    const nextEstado = (body.estado || account.estado || 'activo').trim();

    if (!nextTipo) throw new AppError(400, 'El tipo de cuenta es obligatorio.');
    if (!ACCOUNT_TYPES.includes(nextTipo)) throw new AppError(400, 'Tipo de cuenta no válido.');
    if (!ACCOUNT_STATES.includes(nextEstado)) throw new AppError(400, 'Estado de cuenta no válido.');
    if (nextEstado === 'inactivo' && account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);
    if (nextEstado === 'activo' && account.estado !== 'activo') await assertOwnerIsActive(account);

    await promisifyRun(database, `
      UPDATE cuentas
      SET tipo_cuenta = ?, estado = ?, fecha_actualizacion = ?
      WHERE id = ?
    `, [nextTipo, nextEstado, dateNow(), id]);

    const updated = await promisifyGet(database, ACCOUNT_WITH_OWNER_SQL, [id]);
    res.json({ account: updated, message: 'Cuenta actualizada correctamente.' });
  }));

  router.post('/:id/inactivate', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const account = await getAccountOr404(id);
    if (account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);

    await promisifyRun(database, 'UPDATE cuentas SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['inactivo', dateNow(), id]);
    const updated = await promisifyGet(database, ACCOUNT_WITH_OWNER_SQL, [id]);
    res.json({ account: updated, message: 'Cuenta inactivada correctamente.' });
  }));

  router.post('/:id/activate', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const account = await getAccountOr404(id);
    if (account.estado === 'activo') throw new AppError(409, 'La cuenta ya está activa.');
    await assertOwnerIsActive(account);

    await promisifyRun(database, 'UPDATE cuentas SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['activo', dateNow(), id]);
    const updated = await promisifyGet(database, ACCOUNT_WITH_OWNER_SQL, [id]);
    res.json({ account: updated, message: 'Cuenta activada correctamente.' });
  }));

  return router;
}

module.exports = { createAccountsRouter };
