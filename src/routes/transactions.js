const express = require('express');
const { queryOne } = require('../database');
const { parseValidMoney, parseId, isUuid } = require('../validation');
const { AppError, asyncHandler } = require('../errors');

// Toda la lógica del dinero (bloqueo, validación de saldo, registro y reintentos)
// vive en las funciones SQL realizar_deposito y realizar_retiro.
const OPERATIONS = {
  deposit: {
    sqlFunction: 'public.realizar_deposito',
    defaultDescription: 'Depósito',
    invalidAmountMessage: 'El monto del depósito debe ser mayor que cero y tener máximo dos decimales.',
    successMessage: 'Depósito registrado correctamente.',
  },
  withdraw: {
    sqlFunction: 'public.realizar_retiro',
    defaultDescription: 'Retiro',
    invalidAmountMessage: 'El monto del retiro debe ser mayor que cero y tener máximo dos decimales.',
    successMessage: 'Retiro registrado correctamente.',
  },
};

function createTransactionsRouter(database) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const accountNumber = String(req.query.accountNumber || '').trim();
    const where = accountNumber ? ' WHERE c.numero_cuenta = $1' : '';
    const rows = await database.query(`
      SELECT t.*, c.numero_cuenta, c.saldo AS saldo_actual
      FROM public.transacciones t
      INNER JOIN public.cuentas c ON c.id = t.cuenta_id
      ${where}
      ORDER BY t.fecha_hora DESC, t.id DESC
    `, accountNumber ? [accountNumber] : []);
    res.json(rows);
  }));

  function operationHandler(operation) {
    return asyncHandler(async (req, res) => {
      const body = req.body || {};
      const accountId = parseId(body.account_id || body.cuenta_id);
      const amount = parseValidMoney(body.amount ?? body.monto ?? '0');
      const description = String(body.description || body.descripcion || operation.defaultDescription).trim();
      const idempotencyKey = body.idempotency_key;

      if (!accountId) throw new AppError(400, 'Debe seleccionar una cuenta válida.');
      if (!amount) throw new AppError(400, operation.invalidAmountMessage);
      if (!isUuid(idempotencyKey)) throw new AppError(400, 'Falta el identificador único de la operación.');

      // El operador es siempre el usuario de la sesión, nunca un dato del navegador.
      const operatorId = req.user.id;
      const transaction = await queryOne(
        database,
        `SELECT * FROM ${operation.sqlFunction}($1, $2, $3, $4, $5)`,
        [accountId, amount.cents, description || operation.defaultDescription, operatorId, idempotencyKey]
      );

      const account = await queryOne(database, 'SELECT * FROM public.cuentas WHERE id = $1', [accountId]);
      res.json({ account, transaction, message: operation.successMessage });
    });
  }

  router.post('/deposit', operationHandler(OPERATIONS.deposit));
  router.post('/withdraw', operationHandler(OPERATIONS.withdraw));

  return router;
}

module.exports = { createTransactionsRouter };
