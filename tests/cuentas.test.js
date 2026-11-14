const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp, api, createCustomer, createAccount, operate } = require('./helpers/api');

test('cuentas: el sistema asigna un número único de 10 dígitos con prefijo por tipo', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    const created = [];
    for (const tipo of ['Ahorros', 'Ahorros', 'Corriente', 'Nomina']) {
      created.push(await createAccount(baseUrl, customer.id, { tipo_cuenta: tipo }));
    }
    assert.deepEqual(created.map((a) => a.numero_cuenta), ['1000000001', '1000000002', '2000000001', '3000000001']);

    const ignored = await createAccount(baseUrl, customer.id, { numero_cuenta: '999', tipo_cuenta: 'Ahorros' });
    assert.equal(ignored.numero_cuenta, '1000000003', 'un número enviado por el navegador se ignora');
  });
});

test('cuentas: cuentas abiertas al mismo tiempo nunca repiten número', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customer.id, tipo_cuenta: ['Ahorros', 'Corriente', 'Nomina'][i % 3], saldo_inicial: 0 },
    })));
    assert.ok(results.every((r) => r.status === 201));
    const numbers = results.map((r) => r.data.account.numero_cuenta);
    assert.equal(new Set(numbers).size, numbers.length);
  });
});

test('cuentas: valida tipo, saldo inicial y titular', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '11111111', nombres: 'Luis', apellidos: 'Pérez' });
    const post = (body) => api(baseUrl, '/api/accounts', { method: 'POST', body: { cliente_id: customer.id, tipo_cuenta: 'Ahorros', ...body } });

    assert.equal((await post({ tipo_cuenta: 'Inversion' })).status, 400);
    assert.match((await post({ saldo_inicial: '10.123' })).data.error, /máximo dos decimales/i);
    assert.match((await post({ saldo_inicial: -10 })).data.error, /negativo/i);
    assert.equal((await post({ cliente_id: 99999 })).status, 404);

    const account = await post({ saldo_inicial: 500 });
    assert.equal(account.status, 201);
    assert.equal(account.data.account.saldo, 50000);
    assert.match(account.data.message, new RegExp(account.data.account.numero_cuenta));

    const searchByCustomer = await api(baseUrl, '/api/accounts?search=luis');
    assert.equal(searchByCustomer.data[0].numero_cuenta, account.data.account.numero_cuenta);
  });
});

test('cuentas: el saldo inicial queda registrado como depósito con su operador', async () => {
  await withApp(async (baseUrl, db, { users }) => {
    const customer = await createCustomer(baseUrl);
    const account = await createAccount(baseUrl, customer.id, { saldo_inicial: 1500 });
    const history = await api(baseUrl, `/api/transactions?accountNumber=${account.numero_cuenta}`);
    assert.equal(history.data.length, 1);
    assert.equal(history.data[0].tipo_transaccion, 'deposito');
    assert.equal(history.data[0].saldo_resultante, 150000);
    assert.equal(history.data[0].operador_id, users.admin);
  });
});

test('cuentas: no se abren cuentas para clientes inactivos', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    await api(baseUrl, `/api/customers/${customer.id}/inactivate`, { method: 'POST' });
    const response = await api(baseUrl, '/api/accounts', { method: 'POST', body: { cliente_id: customer.id, tipo_cuenta: 'Ahorros' } });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /inactivo/i);
  });
});

test('cuentas: el tipo queda fijo y solo se edita el estado', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    const account = await createAccount(baseUrl, customer.id, { tipo_cuenta: 'Ahorros' });

    const changeType = await api(baseUrl, `/api/accounts/${account.id}`, { method: 'PUT', body: { tipo_cuenta: 'Corriente' } });
    assert.equal(changeType.status, 409);
    assert.match(changeType.data.error, /tipo de cuenta no se puede cambiar/i);

    const sameType = await api(baseUrl, `/api/accounts/${account.id}`, { method: 'PUT', body: { tipo_cuenta: 'Ahorros', estado: 'inactivo' } });
    assert.equal(sameType.status, 200);
    assert.equal(sameType.data.account.estado, 'inactivo');
  });
});

test('cuentas: solo se inactiva con saldo cero y bloquea operaciones en cuentas inactivas', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '33333333' });
    const withBalance = await createAccount(baseUrl, customer.id, { saldo_inicial: 10 });
    const blocked = await api(baseUrl, `/api/accounts/${withBalance.id}/inactivate`, { method: 'POST' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /saldo/i);

    const account = await createAccount(baseUrl, customer.id, { tipo_cuenta: 'Nomina' });
    const inactive = await api(baseUrl, `/api/accounts/${account.id}/inactivate`, { method: 'POST' });
    assert.equal(inactive.status, 200);
    assert.equal(inactive.data.account.estado, 'inactivo');

    const depositOnInactive = await operate(baseUrl, 'deposit', account.id, 50);
    assert.equal(depositOnInactive.status, 409);
    assert.match(depositOnInactive.data.error, /inactiva/i);
  });
});

test('cuentas: solo se reactiva si el cliente está activo', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '55555555' });
    const account = await createAccount(baseUrl, customer.id);

    const alreadyActive = await api(baseUrl, `/api/accounts/${account.id}/activate`, { method: 'POST' });
    assert.equal(alreadyActive.status, 409);

    await api(baseUrl, `/api/accounts/${account.id}/inactivate`, { method: 'POST' });
    await api(baseUrl, `/api/customers/${customer.id}/inactivate`, { method: 'POST' });

    const blocked = await api(baseUrl, `/api/accounts/${account.id}/activate`, { method: 'POST' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /cliente está inactivo/i);

    const blockedByUpdate = await api(baseUrl, `/api/accounts/${account.id}`, { method: 'PUT', body: { estado: 'activo' } });
    assert.equal(blockedByUpdate.status, 409);

    await api(baseUrl, `/api/customers/${customer.id}/activate`, { method: 'POST' });
    const active = await api(baseUrl, `/api/accounts/${account.id}/activate`, { method: 'POST' });
    assert.equal(active.status, 200);
    assert.equal(active.data.account.estado, 'activo');
  });
});
