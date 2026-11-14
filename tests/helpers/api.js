// Utilidades compartidas por las pruebas de la API.
const { randomUUID } = require('node:crypto');
const { createApp } = require('../../src/app');
const { createTestDatabase } = require('./test-database');
const { createTestAuth, createUser, createTestUserAdmin } = require('./auth');

// Sesión que usa api() cuando la prueba no indica otra (la del administrador).
const defaultTokens = new Map();

// Levanta la app con una base de pruebas nueva y dos usuarios (administrador y
// cajero), ejecuta la prueba y apaga todo.
// La prueba recibe (baseUrl, db, ctx) con ctx = { tokens, users, auth }.
async function withApp(testFn, { database } = {}) {
  const db = database || await createTestDatabase();
  const auth = await createTestAuth();
  const users = {
    admin: await createUser(db, { rol: 'administrador' }),
    cajero: await createUser(db, { rol: 'cajero' }),
  };
  const tokens = {
    admin: await auth.sign(users.admin),
    cajero: await auth.sign(users.cajero),
  };

  const app = createApp(db, {
    verifyToken: auth.verifyToken,
    userAdmin: createTestUserAdmin(db),
    publicConfig: { supabaseUrl: 'https://pruebas.supabase.co', supabasePublishableKey: 'sb_publishable_pruebas' },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  defaultTokens.set(baseUrl, tokens.admin);
  try {
    await testFn(baseUrl, db, { tokens, users, auth });
  } finally {
    defaultTokens.delete(baseUrl);
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    if (!database) await db.close();
  }
}

// token: undefined = administrador · null = sin sesión · texto = esa sesión.
async function api(baseUrl, pathUrl, { method = 'GET', body, token } = {}) {
  const sessionToken = token === undefined ? defaultTokens.get(baseUrl) : token;
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers,
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

// Depósito o retiro. Por defecto lo hace la sesión del administrador; pasa
// { token } para usar otra (por ejemplo la del cajero).
function operate(baseUrl, type, accountId, amount, { token, ...extra } = {}) {
  return api(baseUrl, `/api/transactions/${type}`, {
    method: 'POST',
    token,
    body: { account_id: accountId, amount, idempotency_key: randomUUID(), ...extra },
  });
}

module.exports = { withApp, api, validCustomer, createCustomer, createAccount, operate, randomUUID };
