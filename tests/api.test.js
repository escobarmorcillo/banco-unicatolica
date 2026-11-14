const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withApp, api, createCustomer, createAccount } = require('./helpers/api');
const { createTestDatabase } = require('./helpers/test-database');

test('api: rutas inexistentes responden 404 en JSON y el JSON mal formado 400', async () => {
  await withApp(async (baseUrl) => {
    const missing = await api(baseUrl, '/api/no-existe');
    assert.equal(missing.status, 404);
    assert.match(missing.data.error, /no encontrado/i);

    const response = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ esto no es json',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/);
  });
});

test('api: oculta los errores internos de la base de datos', async () => {
  const database = await createTestDatabase();
  const originalError = console.error;
  console.error = () => {};
  try {
    await withApp(async (baseUrl) => {
      await database.close();
      const response = await api(baseUrl, '/api/customers');
      assert.equal(response.status, 500);
      assert.equal(response.data.error, 'Ocurrió un error interno. Intenta nuevamente.');
    }, { database });
  } finally {
    console.error = originalError;
  }
});

test('api: los datos persisten al reiniciar la aplicación', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novabank-'));
  try {
    const first = await createTestDatabase({ dataDir });
    await withApp(async (baseUrl) => {
      const customer = await createCustomer(baseUrl, { documento: '44444444' });
      await createAccount(baseUrl, customer.id, { saldo_inicial: 1500 });
    }, { database: first });
    await first.close();

    const second = await createTestDatabase({ dataDir });
    await withApp(async (baseUrl) => {
      const customers = await api(baseUrl, '/api/customers');
      const accounts = await api(baseUrl, '/api/accounts');
      assert.ok(customers.data.some((c) => c.documento === '44444444'));
      assert.ok(accounts.data.some((a) => a.numero_cuenta === '1000000001' && a.saldo === 150000));
    }, { database: second });
    await second.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
