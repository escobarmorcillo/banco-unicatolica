// Utilidades compartidas por las pruebas de la API.
const { randomUUID } = require('node:crypto');
const { createApp } = require('../../src/app');
const { createTestDatabase } = require('./test-database');

// Levanta la app con una base de pruebas nueva, ejecuta la prueba y apaga todo.
async function withApp(testFn, { database } = {}) {
  const db = database || await createTestDatabase();
  const server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await testFn(baseUrl, db);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    if (!database) await db.close();
  }
}

async function api(baseUrl, pathUrl, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : {} };
}

const validCustomer = (overrides = {}) => ({
  tipo_documento: 'Cedula',
  documento: '12345678',
  nombres: 'Ana',
  apellidos: 'Gomez',
  fecha_nacimiento: '1990-05-01',
  telefono: '3001112233',
  correo: 'ana@test.com',
  direccion: 'Calle 1',
  ...overrides,
});

async function createCustomer(baseUrl, overrides = {}) {
  const response = await api(baseUrl, '/api/customers', { method: 'POST', body: validCustomer(overrides) });
  if (response.status !== 201) throw new Error(`No se pudo crear el cliente: ${response.data.error}`);
  return response.data.customer;
}

async function createAccount(baseUrl, customerId, overrides = {}) {
  const response = await api(baseUrl, '/api/accounts', {
    method: 'POST',
    body: { cliente_id: customerId, numero_cuenta: '1001', tipo_cuenta: 'Ahorros', saldo_inicial: 0, ...overrides },
  });
  if (response.status !== 201) throw new Error(`No se pudo crear la cuenta: ${response.data.error}`);
  return response.data.account;
}

function operate(baseUrl, type, accountId, amount, extra = {}) {
  return api(baseUrl, `/api/transactions/${type}`, {
    method: 'POST',
    body: { account_id: accountId, amount, idempotency_key: randomUUID(), ...extra },
  });
}

module.exports = { withApp, api, validCustomer, createCustomer, createAccount, operate, randomUUID };
