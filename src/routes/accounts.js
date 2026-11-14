const express = require('express');
const { queryOne } = require('../database');
const { ACCOUNT_TYPES, ACCOUNT_STATES, parseValidMoney, parseId } = require('../validation');
const { AppError, asyncHandler } = require('../errors');

const ACCOUNT_WITH_OWNER_SQL = `
  SELECT a.*, c.documento, c.nombres, c.apellidos
  FROM public.cuentas a
  INNER JOIN public.clientes c ON c.id = a.cliente_id
`;
const INACTIVE_OWNER_MESSAGE = 'No se puede activar la cuenta porque el cliente está inactivo. Activa primero el cliente.';
const NON_ZERO_BALANCE_MESSAGE = 'La cuenta no puede inactivarse porque su saldo no es cero.';

function createAccountsRouter(database) {
  const router = express.Router();

  const getAccountWithOwner = (id, db = database) => queryOne(db, `${ACCOUNT_WITH_OWNER_SQL} WHERE a.id = $1`, [id]);

  async function getAccountOr404(rawId) {
    const id = parseId(rawId);
    const account = id && await queryOne(database, 'SELECT * FROM public.cuentas WHERE id = $1', [id]);
    if (!account) throw new AppError(404, 'Cuenta no encontrada.');
    return account;
  }

  async function assertOwnerIsActive(account) {
    const owner = await queryOne(database, 'SELECT estado FROM public.clientes WHERE id = $1', [account.cliente_id]);
    if (!owner || owner.estado !== 'activo') throw new AppError(409, INACTIVE_OWNER_MESSAGE);
  }

  async function updateAccount(id, tipoCuenta, estado) {
    await database.query('UPDATE public.cuentas SET tipo_cuenta = $1, estado = $2 WHERE id = $3', [tipoCuenta, estado, id]);
    return getAccountWithOwner(id);
  }

  router.get('/', asyncHandler(async (req, res) => {
    const filterByNumber = String(req.query.number || '').trim();
    const searchTerm = String(req.query.search || '').trim();
    const filterCustomerId = req.query.customerId ? parseId(req.query.customerId) : null;

    const params = [];
    const clauses = [];
    const param = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filterByNumber) {
      clauses.push(`a.numero_cuenta = ${param(filterByNumber)}`);
    }
    if (searchTerm) {
      const partial = param(`%${searchTerm}%`);
      clauses.push(`(a.numero_cuenta ILIKE ${partial} OR c.documento ILIKE ${partial} OR c.nombres ILIKE ${partial} OR c.apellidos ILIKE ${partial})`);
    }
    if (req.query.customerId) {
      clauses.push(`a.cliente_id = ${param(filterCustomerId || 0)}`);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = await database.query(`${ACCOUNT_WITH_OWNER_SQL}${where} ORDER BY a.id DESC`, params);
    res.json(rows.map((row) => ({ ...row, cliente: `${row.nombres} ${row.apellidos}` })));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const clienteId = parseId(body.cliente_id);
    const numeroCuenta = String(body.numero_cuenta || '').trim();
    const tipoCuenta = String(body.tipo_cuenta || '').trim();
    const saldoInicial = parseValidMoney(body.saldo_inicial ?? '0', true);

    if (!clienteId) throw new AppError(400, 'Debe seleccionar un cliente titular válido.');
    if (!numeroCuenta || !tipoCuenta) throw new AppError(400, 'El número de cuenta y el tipo de cuenta son obligatorios.');
    if (!/^\d+$/.test(numeroCuenta)) throw new AppError(400, 'El número de cuenta solo puede contener números.');
    if (!ACCOUNT_TYPES.includes(tipoCuenta)) throw new AppError(400, 'Tipo de cuenta no válido.');
    if (!saldoInicial) {
      throw new AppError(400, 'El saldo inicial debe ser un monto válido, no negativo y con máximo dos decimales.');
    }

    const customer = await queryOne(database, 'SELECT estado FROM public.clientes WHERE id = $1', [clienteId]);
    if (!customer) throw new AppError(404, 'El cliente titular no existe.');
    if (customer.estado !== 'activo') throw new AppError(409, 'No se puede crear una cuenta para un cliente inactivo.');

    const duplicate = await queryOne(database, 'SELECT id FROM public.cuentas WHERE numero_cuenta = $1', [numeroCuenta]);
    if (duplicate) throw new AppError(409, 'El número de cuenta ya existe.');

    // La cuenta y su saldo inicial se guardan juntos: o se guardan ambos o ninguno.
    const cents = saldoInicial.cents;
    const account = await database.transaction(async (tx) => {
      const created = await queryOne(tx, `
        INSERT INTO public.cuentas (cliente_id, numero_cuenta, tipo_cuenta, saldo)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [clienteId, numeroCuenta, tipoCuenta, cents]);

      if (cents > 0) {
        await tx.query(`
          INSERT INTO public.transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion)
          VALUES ($1, 'deposito', $2, 0, $2, 'Saldo inicial registrado')
        `, [created.id, cents]);
      }
      return getAccountWithOwner(created.id, tx);
    });

    res.status(201).json({ account, message: 'Cuenta creada y saldo inicial registrado en el historial.' });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);

    const body = req.body || {};
    const nextTipo = String(body.tipo_cuenta || account.tipo_cuenta || '').trim();
    const nextEstado = String(body.estado || account.estado || 'activo').trim();

    if (!nextTipo) throw new AppError(400, 'El tipo de cuenta es obligatorio.');
    if (!ACCOUNT_TYPES.includes(nextTipo)) throw new AppError(400, 'Tipo de cuenta no válido.');
    if (!ACCOUNT_STATES.includes(nextEstado)) throw new AppError(400, 'Estado de cuenta no válido.');
    if (nextEstado === 'inactivo' && account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);
    if (nextEstado === 'activo' && account.estado !== 'activo') await assertOwnerIsActive(account);

    const updated = await updateAccount(account.id, nextTipo, nextEstado);
    res.json({ account: updated, message: 'Cuenta actualizada correctamente.' });
  }));

  router.post('/:id/inactivate', asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);
    if (account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);

    const updated = await updateAccount(account.id, account.tipo_cuenta, 'inactivo');
    res.json({ account: updated, message: 'Cuenta inactivada correctamente.' });
  }));

  router.post('/:id/activate', asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);
    if (account.estado === 'activo') throw new AppError(409, 'La cuenta ya está activa.');
    await assertOwnerIsActive(account);

    const updated = await updateAccount(account.id, account.tipo_cuenta, 'activo');
    res.json({ account: updated, message: 'Cuenta activada correctamente.' });
  }));

  return router;
}

module.exports = { createAccountsRouter };
