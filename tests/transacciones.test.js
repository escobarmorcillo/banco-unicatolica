const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp, api, createCustomer, createAccount, operate, randomUUID } = require('./helpers/api');

async function setupAccount(baseUrl, saldoInicial = 1000) {
  const customer = await createCustomer(baseUrl, { documento: '22222222' });
  return createAccount(baseUrl, customer.id, { saldo_inicial: saldoInicial });
}

test('transacciones: depósito y retiro actualizan el saldo y el historial', async () => {
  await withApp(async (baseUrl) => {
    const account = await setupAccount(baseUrl);

    const deposit = await operate(baseUrl, 'deposit', account.id, 250, { description: 'Depósito de prueba' });
    assert.equal(deposit.status, 200);
    assert.equal(deposit.data.account.saldo, 125000);
    assert.equal(deposit.data.transaction.saldo_anterior, 100000);

    const withdraw = await operate(baseUrl, 'withdraw', account.id, 300);
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.data.account.saldo, 95000);

    const history = await api(baseUrl, `/api/transactions?accountNumber=${account.numero_cuenta}`);
    assert.equal(history.status, 200);
    assert.equal(history.data.length, 3);
  });
});

test('transacciones: rechaza retiro mayor al saldo, montos inválidos y cuentas inexistentes', async () => {
  await withApp(async (baseUrl) => {
    const account = await setupAccount(baseUrl);

    const overdraw = await operate(baseUrl, 'withdraw', account.id, 5000);
    assert.equal(overdraw.status, 400);
    assert.match(overdraw.data.error, /excede el saldo/i);

    for (const amount of ['0', '-5', '10.123', 'abc']) {
      const response = await operate(baseUrl, 'deposit', account.id, amount);
      assert.equal(response.status, 400, `monto ${amount}`);
    }

    const missing = await operate(baseUrl, 'deposit', 99999, 10);
    assert.equal(missing.status, 404);

    const withoutKey = await api(baseUrl, '/api/transactions/deposit', { method: 'POST', body: { account_id: account.id, amount: 10 } });
    assert.equal(withoutKey.status, 400);
    assert.match(withoutKey.data.error, /identificador/i);

    const accounts = await api(baseUrl, `/api/accounts?number=${account.numero_cuenta}`);
    assert.equal(accounts.data[0].saldo, 100000, 'los intentos fallidos no cambian el saldo');
  });
});

test('transacciones: un reintento con el mismo identificador no duplica la operación', async () => {
  await withApp(async (baseUrl) => {
    const account = await setupAccount(baseUrl);
    const key = randomUUID();

    const first = await operate(baseUrl, 'deposit', account.id, 50, { idempotency_key: key });
    const retry = await operate(baseUrl, 'deposit', account.id, 50, { idempotency_key: key });
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.transaction.id, first.data.transaction.id);
    assert.equal(retry.data.account.saldo, 105000);

    const reusedWithOtherAmount = await operate(baseUrl, 'deposit', account.id, 70, { idempotency_key: key });
    assert.equal(reusedWithOtherAmount.status, 409);

    const history = await api(baseUrl, `/api/transactions?accountNumber=${account.numero_cuenta}`);
    assert.equal(history.data.length, 2, 'saldo inicial + un solo depósito');
  });
});

test('transacciones: operaciones simultáneas mantienen saldo y movimientos coherentes', async () => {
  await withApp(async (baseUrl) => {
    const account = await setupAccount(baseUrl, 0);

    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => operate(baseUrl, 'deposit', account.id, 100)),
      ...Array.from({ length: 5 }, () => operate(baseUrl, 'withdraw', account.id, 100)),
    ]);
    const succeeded = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status !== 200);
    assert.ok(rejected.every((r) => r.status === 400 && /excede/.test(r.data.error)), 'solo se rechazan retiros sin saldo');

    const history = (await api(baseUrl, `/api/transactions?accountNumber=${account.numero_cuenta}`)).data;
    const accountNow = (await api(baseUrl, `/api/accounts?number=${account.numero_cuenta}`)).data[0];
    const sum = history.reduce((total, t) => total + (t.tipo_transaccion === 'deposito' ? t.monto : -t.monto), 0);
    assert.equal(history.length, succeeded.length);
    assert.equal(accountNow.saldo, sum);
    assert.ok(accountNow.saldo >= 0);
  });
});
