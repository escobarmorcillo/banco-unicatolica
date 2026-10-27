const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, createDb } = require('../server');

async function withApp(testFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novabank-'));
  const dbPath = path.join(dir, 'novabank.db');
  const app = createApp(createDb(dbPath));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await testFn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (error) {}
  }
}

async function api(baseUrl, pathUrl, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = text ? JSON.parse(text) : {};
  return { status: response.status, data };
}

test('registers valid customer and rejects duplicate document', async () => {
  await withApp(async (baseUrl) => {
    const first = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '12345678', nombres: 'Ana', apellidos: 'Gomez', fecha_nacimiento: '1990-05-01', telefono: '3001112233', correo: 'ana@test.com', direccion: 'Calle 1' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.data.message, 'Cliente registrado correctamente.');

    const duplicate = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '12345678', nombres: 'Ana', apellidos: 'Gomez', fecha_nacimiento: '1990-05-01', telefono: '3001112233', correo: 'ana@test.com', direccion: 'Calle 1' },
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.data.error, /documento/i);
  });
});

test('rejects a customer younger than 15 and allows listing', async () => {
  await withApp(async (baseUrl) => {
    const underageDate = new Date();
    underageDate.setUTCFullYear(underageDate.getUTCFullYear() - 14);
    const underage = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '99999999', nombres: 'Pedro', apellidos: 'Lopez', fecha_nacimiento: underageDate.toISOString().slice(0, 10), telefono: '3002223344', correo: 'pedro@test.com', direccion: 'Avenida 2' },
    });
    assert.equal(underage.status, 400);
    assert.match(underage.data.error, /15/i);

    const list = await api(baseUrl, '/api/customers');
    assert.equal(list.status, 200);
    assert.equal(Array.isArray(list.data), true);
  });
});

test('validates customer document, names and phone format and length', async () => {
  await withApp(async (baseUrl) => {
    const valid = { tipo_documento: 'Cedula', documento: '12345678', nombres: 'Ana María', apellidos: 'Gómez Ñúñez', fecha_nacimiento: '1990-05-01', telefono: '3001112233', correo: 'ana@test.com', direccion: 'Calle 1' };
    const invalidCases = [
      { body: { ...valid, documento: '123ABC' }, message: /documento.*solo números/i },
      { body: { ...valid, documento: '12345678901' }, message: /documento.*máximo 10/i },
      { body: { ...valid, nombres: 'Ana2' }, message: /nombres.*letras/i },
      { body: { ...valid, apellidos: 'Gómez!' }, message: /apellidos.*letras/i },
      { body: { ...valid, telefono: '300ABC2233' }, message: /teléfono.*10 números/i },
      { body: { ...valid, telefono: '300123' }, message: /teléfono.*10 números/i },
      { body: { ...valid, telefono: '30011122334' }, message: /teléfono.*10 números/i },
    ];

    for (const { body, message } of invalidCases) {
      const response = await api(baseUrl, '/api/customers', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.match(response.data.error, message);
    }

    const validCustomer = await api(baseUrl, '/api/customers', { method: 'POST', body: valid });
    assert.equal(validCustomer.status, 201);
  });
});

test('applies the same customer restrictions when updating customer details', async () => {
  await withApp(async (baseUrl) => {
    const created = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '55555555', nombres: 'Ana', apellidos: 'Gomez', fecha_nacimiento: '1990-05-01', telefono: '3001112233', correo: 'ana@test.com', direccion: 'Calle 1' },
    });
    const id = created.data.customer.id;
    const invalidUpdates = [
      { documento: '12ABC', telefono: '3001112233', nombres: 'Ana', apellidos: 'Gomez', correo: 'ana@test.com', direccion: 'Calle 1' },
      { documento: '55555555', telefono: '30011122334', nombres: 'Ana', apellidos: 'Gomez', correo: 'ana@test.com', direccion: 'Calle 1' },
      { documento: '55555555', telefono: '3001112233', nombres: 'Ana2', apellidos: 'Gomez', correo: 'ana@test.com', direccion: 'Calle 1' },
      { documento: '55555555', telefono: '3001112233', nombres: 'Ana', apellidos: 'Gómez!', correo: 'ana@test.com', direccion: 'Calle 1' },
    ];

    for (const body of invalidUpdates) {
      const response = await api(baseUrl, `/api/customers/${id}`, { method: 'PUT', body });
      assert.equal(response.status, 400);
    }

    const updated = await api(baseUrl, `/api/customers/${id}`, {
      method: 'PUT',
      body: { documento: '55555555', telefono: '3012223344', nombres: 'ANA María', apellidos: 'Gómez Ñúñez', correo: 'ana.actualizada@test.com', direccion: 'Carrera 2' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.customer.nombres, 'ANA María');
    assert.equal(updated.data.customer.apellidos, 'Gómez Ñúñez');
  });
});

test('creates account, rejects duplicate number and negative initial balance', async () => {
  await withApp(async (baseUrl) => {
    const customer = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '11111111', nombres: 'Luis', apellidos: 'Pérez', fecha_nacimiento: '1988-02-10', telefono: '3005556677', correo: 'luis@test.com', direccion: 'Cra 5' },
    });
    const customerId = customer.data.customer.id;

    const invalidNumber = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customerId, numero_cuenta: '10A1', tipo_cuenta: 'Ahorros', saldo_inicial: 0 },
    });
    assert.equal(invalidNumber.status, 400);
    assert.match(invalidNumber.data.error, /solo puede contener números/i);

    const invalidPrecision = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customerId, numero_cuenta: '1003', tipo_cuenta: 'Ahorros', saldo_inicial: '10.123' },
    });
    assert.equal(invalidPrecision.status, 400);
    assert.match(invalidPrecision.data.error, /máximo dos decimales/i);

    const account = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customerId, numero_cuenta: '1001', tipo_cuenta: 'Ahorros', saldo_inicial: 500 },
    });
    assert.equal(account.status, 201);
    assert.equal(account.data.account.numero_cuenta, '1001');

    const hiddenInactivation = await api(baseUrl, `/api/accounts/${account.data.account.id}`, {
      method: 'PUT',
      body: { tipo_cuenta: 'Ahorros', estado: 'inactivo' },
    });
    assert.equal(hiddenInactivation.status, 409);
    assert.match(hiddenInactivation.data.error, /saldo/i);

    const searchByCustomer = await api(baseUrl, '/api/accounts?search=Luis');
    assert.equal(searchByCustomer.status, 200);
    assert.equal(searchByCustomer.data[0].numero_cuenta, '1001');

    const duplicate = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customerId, numero_cuenta: '1001', tipo_cuenta: 'Corriente', saldo_inicial: 100 },
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.data.error, /número de cuenta/i);

    const negative = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customerId, numero_cuenta: '1002', tipo_cuenta: 'Corriente', saldo_inicial: -10 },
    });
    assert.equal(negative.status, 400);
    assert.match(negative.data.error, /negativo/i);
  });
});

test('processes deposit and withdrawal with integrity rules', async () => {
  await withApp(async (baseUrl) => {
    const customer = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '22222222', nombres: 'Marta', apellidos: 'Santos', fecha_nacimiento: '1993-07-15', telefono: '3004445566', correo: 'marta@test.com', direccion: 'Carrera 10' },
    });
    const account = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customer.data.customer.id, numero_cuenta: '2001', tipo_cuenta: 'Ahorros', saldo_inicial: 1000 },
    });
    const accountId = account.data.account.id;

    const invalidDeposit = await api(baseUrl, '/api/transactions/deposit', {
      method: 'POST',
      body: { account_id: accountId, amount: '10.123' },
    });
    assert.equal(invalidDeposit.status, 400);
    assert.match(invalidDeposit.data.error, /máximo dos decimales/i);

    const deposit = await api(baseUrl, '/api/transactions/deposit', {
      method: 'POST',
      body: { account_id: accountId, amount: 250, description: 'Depósito de prueba' },
    });
    assert.equal(deposit.status, 200);
    assert.equal(deposit.data.account.saldo, 125000);

    const withdraw = await api(baseUrl, '/api/transactions/withdraw', {
      method: 'POST',
      body: { account_id: accountId, amount: 300, description: 'Retiro de prueba' },
    });
    assert.equal(withdraw.status, 200);
    assert.equal(withdraw.data.account.saldo, 95000);

    const overdraw = await api(baseUrl, '/api/transactions/withdraw', {
      method: 'POST',
      body: { account_id: accountId, amount: 5000, description: 'Retiro invalido' },
    });
    assert.equal(overdraw.status, 400);
    assert.match(overdraw.data.error, /excede|saldo/i);

    const history = await api(baseUrl, '/api/transactions?accountNumber=2001');
    assert.equal(history.status, 200);
    assert.equal(history.data.length >= 3, true);
  });
});

test('inactivates account only when balance is zero and blocks operations on inactive account', async () => {
  await withApp(async (baseUrl) => {
    const customer = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: { tipo_documento: 'Cedula', documento: '33333333', nombres: 'Nora', apellidos: 'Melo', fecha_nacimiento: '1985-12-01', telefono: '3007778899', correo: 'nora@test.com', direccion: 'Diagonal 8' },
    });
    const account = await api(baseUrl, '/api/accounts', {
      method: 'POST',
      body: { cliente_id: customer.data.customer.id, numero_cuenta: '3001', tipo_cuenta: 'Nomina', saldo_inicial: 0 },
    });

    const inactive = await api(baseUrl, '/api/accounts/' + account.data.account.id + '/inactivate', { method: 'POST' });
    assert.equal(inactive.status, 200);
    assert.equal(inactive.data.account.estado, 'inactivo');

    const depositOnInactive = await api(baseUrl, '/api/transactions/deposit', {
      method: 'POST',
      body: { account_id: account.data.account.id, amount: 50, description: 'No permitido' },
    });
    assert.equal(depositOnInactive.status, 409);
    assert.match(depositOnInactive.data.error, /inactiva/i);
  });
});

test('persists customer and account data across app restarts using same SQLite database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novabank-persist-'));
  const dbPath = path.join(dir, 'novabank.db');

  const app1 = createApp(createDb(dbPath));
  const server1 = app1.listen(0);
  await new Promise((resolve) => server1.once('listening', resolve));
  const baseUrl1 = `http://127.0.0.1:${server1.address().port}`;

  const created = await api(baseUrl1, '/api/customers', {
    method: 'POST',
    body: { tipo_documento: 'Cedula', documento: '44444444', nombres: 'Carlos', apellidos: 'Rojas', fecha_nacimiento: '1987-01-20', telefono: '3009988776', correo: 'carlos@test.com', direccion: 'Bajo 17' },
  });
  const customerId = created.data.customer.id;
  await api(baseUrl1, '/api/accounts', {
    method: 'POST',
    body: { cliente_id: customerId, numero_cuenta: '4001', tipo_cuenta: 'Corriente', saldo_inicial: 1500 },
  });

  await new Promise((resolve, reject) => server1.close((err) => (err ? reject(err) : resolve())));

  const app2 = createApp(createDb(dbPath));
  const server2 = app2.listen(0);
  await new Promise((resolve) => server2.once('listening', resolve));
  const baseUrl2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const customerList = await api(baseUrl2, '/api/customers');
    const accountList = await api(baseUrl2, '/api/accounts');
    assert.equal(customerList.status, 200);
    assert.equal(accountList.status, 200);
    assert.ok(customerList.data.some((customer) => customer.documento === '44444444'));
    assert.ok(accountList.data.some((account) => account.numero_cuenta === '4001'));
  } finally {
    await new Promise((resolve, reject) => server2.close((err) => (err ? reject(err) : resolve())));
    try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch (error) {}
  }
});
