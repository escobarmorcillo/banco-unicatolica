const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp, api, createCustomer, createAccount, operate } = require('./helpers/api');

test('cuentas: crea cuenta, rechaza número duplicado, inválido y saldo negativo', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '11111111', nombres: 'Luis', apellidos: 'Pérez' });
    const post = (body) => api(baseUrl, '/api/accounts', { method: 'POST', body: { cliente_id: customer.id, tipo_cuenta: 'Ahorros', ...body } });

    const invalidNumber = await post({ numero_cuenta: '10A1', saldo_inicial: 0 });
    assert.equal(invalidNumber.status, 400);
    assert.match(invalidNumber.data.error, /solo puede contener números/i);

    const invalidPrecision = await post({ numero_cuenta: '1003', saldo_inicial: '10.123' });
    assert.equal(invalidPrecision.status, 400);
    assert.match(invalidPrecision.data.error, /máximo dos decimales/i);

    const account = await post({ numero_cuenta: '1001', saldo_inicial: 500 });
    assert.equal(account.status, 201);
    assert.equal(account.data.account.numero_cuenta, '1001');
    assert.equal(account.data.account.saldo, 50000);

    const hiddenInactivation = await api(baseUrl, `/api/accounts/${account.data.account.id}`, {
      method: 'PUT',
      body: { tipo_cuenta: 'Ahorros', estado: 'inactivo' },
    });
    assert.equal(hiddenInactivation.status, 409);
    assert.match(hiddenInactivation.data.error, /saldo/i);

    const searchByCustomer = await api(baseUrl, '/api/accounts?search=luis');
    assert.equal(searchByCustomer.status, 200);
    assert.equal(searchByCustomer.data[0].numero_cuenta, '1001');

    const duplicate = await post({ numero_cuenta: '1001', tipo_cuenta: 'Corriente', saldo_inicial: 100 });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.data.error, /número de cuenta/i);

    const negative = await post({ numero_cuenta: '1002', tipo_cuenta: 'Corriente', saldo_inicial: -10 });
    assert.equal(negative.status, 400);
    assert.match(negative.data.error, /negativo/i);
  });
});

test('cuentas: el saldo inicial queda registrado en el historial', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    await createAccount(baseUrl, customer.id, { numero_cuenta: '7001', saldo_inicial: 1500 });
    const history = await api(baseUrl, '/api/transactions?accountNumber=7001');
    assert.equal(history.data.length, 1);
    assert.equal(history.data[0].saldo_resultante, 150000);
  });
});

test('cuentas: solo se inactiva con saldo cero y bloquea operaciones en cuentas inactivas', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '33333333' });
    const account = await createAccount(baseUrl, customer.id, { numero_cuenta: '3001', tipo_cuenta: 'Nomina' });

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
    const account = await createAccount(baseUrl, customer.id, { numero_cuenta: '5001' });

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
