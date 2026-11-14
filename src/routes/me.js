const express = require('express');
const { queryOne } = require('../database');
const { ROLES, requireRole } = require('../auth/middleware');
const { AppError, asyncHandler } = require('../errors');

// Rutas del usuario que inició sesión. Un cliente solo puede ver SUS datos:
// el cliente_id sale siempre de su perfil, nunca de la petición.
function createMeRouter(database) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { id, email, rol, nombre_completo: nombreCompleto, cliente_id: clienteId } = req.user;
    res.json({ id, email, rol, nombre_completo: nombreCompleto, cliente_id: clienteId });
  });

  const onlyCustomer = requireRole(ROLES.CLIENTE);

  router.get('/customer', onlyCustomer, asyncHandler(async (req, res) => {
    const customer = await queryOne(database, 'SELECT * FROM public.clientes WHERE id = $1', [req.user.cliente_id]);
    if (!customer) throw new AppError(404, 'No se encontró tu información de cliente.');
    res.json(customer);
  }));

  router.get('/accounts', onlyCustomer, asyncHandler(async (req, res) => {
    const accounts = await database.query(
      'SELECT id, numero_cuenta, tipo_cuenta, saldo, estado, fecha_creacion FROM public.cuentas WHERE cliente_id = $1 ORDER BY id',
      [req.user.cliente_id]
    );
    res.json(accounts);
  }));

  router.get('/transactions', onlyCustomer, asyncHandler(async (req, res) => {
    const accountNumber = String(req.query.accountNumber || '').trim();
    const account = accountNumber && await queryOne(
      database,
      'SELECT id, numero_cuenta, saldo FROM public.cuentas WHERE numero_cuenta = $1 AND cliente_id = $2',
      [accountNumber, req.user.cliente_id]
    );
    if (!account) throw new AppError(404, 'No se encontró esa cuenta entre tus cuentas.');

    const movements = await database.query(`
      SELECT id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora
      FROM public.transacciones
      WHERE cuenta_id = $1
      ORDER BY fecha_hora DESC, id DESC
    `, [account.id]);
    res.json({ account, movements });
  }));

  return router;
}

module.exports = { createMeRouter };
