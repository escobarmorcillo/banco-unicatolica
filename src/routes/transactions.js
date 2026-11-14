const express = require('express');
const { promisifyAll, promisifyGet, promisifyRun, runTransaction } = require('../database');
const { parseValidMoney, dateNow } = require('../validation');
const { AppError, asyncHandler } = require('../errors');

const INACTIVE_ACCOUNT_MESSAGE = 'No se puede operar sobre una cuenta inactiva.';

const OPERATIONS = {
  deposit: {
    type: 'deposito',
    defaultDescription: 'Depósito',
    invalidAmountMessage: 'El monto del depósito debe ser mayor que cero y tener máximo dos decimales.',
    successMessage: 'Depósito registrado correctamente.',
    apply: (balance, amount) => balance + amount,
  },
  withdraw: {
    type: 'retiro',
    defaultDescription: 'Retiro',
    invalidAmountMessage: 'El monto del retiro debe ser mayor que cero y tener máximo dos decimales.',
    successMessage: 'Retiro registrado correctamente.',
    apply: (balance, amount) => {
      if (amount > balance) throw new AppError(400, 'El retiro excede el saldo disponible.');
      return balance - amount;
    },
  },
};

function createTransactionsRouter(database) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const accountNumber = (req.query.accountNumber || '').trim();
    let sql = `
      SELECT t.*, c.numero_cuenta, c.saldo AS saldo_actual
      FROM transacciones t
      INNER JOIN cuentas c ON c.id = t.cuenta_id
    `;
    const params = [];
    if (accountNumber) {
      sql += ' WHERE c.numero_cuenta = ?';
      params.push(accountNumber);
    }
    sql += ' ORDER BY t.fecha_hora DESC, t.id DESC';
    res.json(await promisifyAll(database, sql, params));
  }));

  // Depósito y retiro comparten el mismo flujo; solo cambia cómo se calcula el nuevo saldo.
  function operationHandler(operation) {
    return asyncHandler(async (req, res) => {
      const body = req.body || {};
      const accountId = Number(body.account_id || body.cuenta_id);
      const amount = parseValidMoney(body.amount ?? body.monto ?? '0');
      const description = (body.description || body.descripcion || operation.defaultDescription).trim();

      if (!accountId) throw new AppError(400, 'Debe seleccionar una cuenta válida.');
      if (!amount) throw new AppError(400, operation.invalidAmountMessage);

      const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      if (!account) throw new AppError(404, 'La cuenta no existe.');
      if (account.estado !== 'activo') throw new AppError(409, INACTIVE_ACCOUNT_MESSAGE);

      await runTransaction(database, async () => {
        const lock = database.isPostgres ? ' FOR UPDATE' : '';
        const current = await promisifyGet(database, `SELECT saldo, estado FROM cuentas WHERE id = ?${lock}`, [accountId]);
        if (!current || current.estado !== 'activo') throw new AppError(409, INACTIVE_ACCOUNT_MESSAGE);

        const newBalance = operation.apply(current.saldo, amount.cents);
        await promisifyRun(database, 'UPDATE cuentas SET saldo = ?, fecha_actualizacion = ? WHERE id = ?', [newBalance, dateNow(), accountId]);
        await promisifyRun(database, `
          INSERT INTO transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [accountId, operation.type, amount.cents, current.saldo, newBalance, description || operation.defaultDescription, dateNow()]);
      });

      const updatedAccount = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      res.json({ account: updatedAccount, message: operation.successMessage });
    });
  }

  router.post('/deposit', operationHandler(OPERATIONS.deposit));
  router.post('/withdraw', operationHandler(OPERATIONS.withdraw));

  return router;
}

module.exports = { createTransactionsRouter };
