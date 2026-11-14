const express = require('express');
const { queryOne } = require('../database');
const { ACCOUNT_TYPES, ACCOUNT_STATES, parseValidMoney, parseId } = require('../validation');
const { AppError, asyncHandler } = require('../errors');
const { ROLES, requireRole } = require('../auth/middleware');

const onlyAdmin = requireRole(ROLES.ADMIN);

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

  // Solo el estado es editable; el número, el tipo y el titular son fijos.
  async function setAccountState(id, estado) {
    await database.query('UPDATE public.cuentas SET estado = $1 WHERE id = $2', [estado, id]);
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

  router.post('/', onlyAdmin, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const clienteId = parseId(body.cliente_id);
    const tipoCuenta = String(body.tipo_cuenta || '').trim();
    const saldoInicial = parseValidMoney(body.saldo_inicial ?? '0', true);

    if (!clienteId) throw new AppError(400, 'Debe seleccionar un cliente titular válido.');
    if (!ACCOUNT_TYPES.includes(tipoCuenta)) throw new AppError(400, 'Selecciona un tipo de cuenta válido.');
    if (!saldoInicial) {
      throw new AppError(400, 'El saldo inicial debe ser un monto válido, no negativo y con máximo dos decimales.');
    }

    // abrir_cuenta valida al titular, asigna el número y registra el saldo
    // inicial como depósito, todo en un solo paso atómico.
    const created = await queryOne(
      database,
      'SELECT id FROM public.abrir_cuenta($1, $2, $3, $4)',
      [clienteId, tipoCuenta, saldoInicial.cents, req.user.id]
    );
    const account = await getAccountWithOwner(created.id);

    res.status(201).json({ account, message: `Cuenta ${account.numero_cuenta} creada correctamente.` });
  }));

  router.put('/:id', onlyAdmin, asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);

    const body = req.body || {};
    const nextTipo = String(body.tipo_cuenta || account.tipo_cuenta).trim();
    const nextEstado = String(body.estado || account.estado).trim();

    // El tipo define el prefijo del número, por eso queda fijo desde la apertura.
    if (nextTipo !== account.tipo_cuenta) {
      throw new AppError(409, 'El tipo de cuenta no se puede cambiar después de abrirla.');
    }
    if (!ACCOUNT_STATES.includes(nextEstado)) throw new AppError(400, 'Estado de cuenta no válido.');
    if (nextEstado === 'inactivo' && account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);
    if (nextEstado === 'activo' && account.estado !== 'activo') await assertOwnerIsActive(account);

    const updated = await setAccountState(account.id, nextEstado);
    res.json({ account: updated, message: 'Cuenta actualizada correctamente.' });
  }));

  router.post('/:id/inactivate', onlyAdmin, asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);
    if (account.saldo !== 0) throw new AppError(409, NON_ZERO_BALANCE_MESSAGE);

    const updated = await setAccountState(account.id, 'inactivo');
    res.json({ account: updated, message: 'Cuenta inactivada correctamente.' });
  }));

  router.post('/:id/activate', onlyAdmin, asyncHandler(async (req, res) => {
    const account = await getAccountOr404(req.params.id);
    if (account.estado === 'activo') throw new AppError(409, 'La cuenta ya está activa.');
    await assertOwnerIsActive(account);

    const updated = await setAccountState(account.id, 'activo');
    res.json({ account: updated, message: 'Cuenta activada correctamente.' });
  }));

  return router;
}

module.exports = { createAccountsRouter };
