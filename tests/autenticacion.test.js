const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair } = require('jose');
const { withApp, api, createCustomer, createAccount, operate } = require('./helpers/api');
const { createUser } = require('./helpers/auth');

test('autenticación: sin sesión la API responde 401, salvo health y config', async () => {
  await withApp(async (baseUrl) => {
    for (const path of ['/api/customers', '/api/accounts', '/api/transactions', '/api/me', '/api/users', '/api/no-existe']) {
      const response = await api(baseUrl, path, { token: null });
      assert.equal(response.status, 401, path);
      assert.equal(response.data.code, 'SIN_SESION');
    }
    assert.equal((await api(baseUrl, '/api/health', { token: null })).status, 200);
    const config = await api(baseUrl, '/api/config', { token: null });
    assert.equal(config.status, 200);
    assert.deepEqual(Object.keys(config.data).sort(), ['supabasePublishableKey', 'supabaseUrl']);
  });
});

test('autenticación: rechaza sesiones expiradas, falsificadas o de otro emisor', async () => {
  await withApp(async (baseUrl, db, { users, auth }) => {
    const expired = await auth.sign(users.admin, { expiresIn: '-1m' });
    const expiredResponse = await api(baseUrl, '/api/me', { token: expired });
    assert.equal(expiredResponse.status, 401);
    assert.equal(expiredResponse.data.code, 'SESION_EXPIRADA');

    const { privateKey: otherKey } = await generateKeyPair('ES256');
    const forged = await auth.sign(users.admin, { key: otherKey });
    assert.equal((await api(baseUrl, '/api/me', { token: forged })).data.code, 'SESION_INVALIDA');

    const otherIssuer = await auth.sign(users.admin, { issuer: 'https://otro.supabase.co/auth/v1' });
    assert.equal((await api(baseUrl, '/api/me', { token: otherIssuer })).status, 401);

    assert.equal((await api(baseUrl, '/api/me', { token: 'texto-cualquiera' })).status, 401);
  });
});

test('autenticación: un usuario sin perfil o inactivo no tiene acceso', async () => {
  await withApp(async (baseUrl, db, { auth }) => {
    const [noProfile] = await db.query("INSERT INTO auth.users (email) VALUES ('sinperfil@test.co') RETURNING id");
    const response = await api(baseUrl, '/api/me', { token: await auth.sign(noProfile.id) });
    assert.equal(response.status, 403);
    assert.equal(response.data.code, 'SIN_ACCESO');

    const inactive = await createUser(db, { rol: 'cajero', activo: false });
    assert.equal((await api(baseUrl, '/api/accounts', { token: await auth.sign(inactive) })).status, 403);
  });
});

test('autenticación: /api/me devuelve el perfil y rol de la sesión', async () => {
  await withApp(async (baseUrl, db, { tokens, users }) => {
    const me = await api(baseUrl, '/api/me', { token: tokens.cajero });
    assert.equal(me.status, 200);
    assert.equal(me.data.id, users.cajero);
    assert.equal(me.data.rol, 'cajero');
  });
});

test('permisos: el cajero consulta y opera, pero no administra', async () => {
  await withApp(async (baseUrl, db, { tokens, users }) => {
    const customer = await createCustomer(baseUrl);
    const account = await createAccount(baseUrl, customer.id, { saldo_inicial: 100 });
    const cajero = { token: tokens.cajero };

    assert.equal((await api(baseUrl, '/api/customers', cajero)).status, 200);
    assert.equal((await api(baseUrl, '/api/accounts', cajero)).status, 200);
    assert.equal((await api(baseUrl, '/api/transactions', cajero)).status, 200);

    const deposit = await operate(baseUrl, 'deposit', account.id, 50, cajero);
    assert.equal(deposit.status, 200);
    assert.equal(deposit.data.transaction.operador_id, users.cajero, 'registra quién hizo la operación');
    assert.equal((await operate(baseUrl, 'withdraw', account.id, 20, cajero)).status, 200);

    const forbidden = [
      ['POST', '/api/customers', { documento: '1' }],
      ['PUT', `/api/customers/${customer.id}`, {}],
      ['POST', `/api/customers/${customer.id}/inactivate`],
      ['POST', '/api/accounts', { cliente_id: customer.id }],
      ['PUT', `/api/accounts/${account.id}`, {}],
      ['POST', `/api/accounts/${account.id}/inactivate`],
      ['GET', '/api/users'],
      ['POST', '/api/users', {}],
    ];
    for (const [method, path, body] of forbidden) {
      const response = await api(baseUrl, path, { method, body, ...cajero });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(response.data.code, 'SIN_PERMISO');
    }
  });
});

test('permisos: el cliente solo ve sus propios datos', async () => {
  await withApp(async (baseUrl, db, { auth }) => {
    const ana = await createCustomer(baseUrl, { documento: '100' });
    const luis = await createCustomer(baseUrl, { documento: '200', nombres: 'Luis' });
    const anaAccount = await createAccount(baseUrl, ana.id, { saldo_inicial: 10 });
    const luisAccount = await createAccount(baseUrl, luis.id, { saldo_inicial: 20 });
    const token = await auth.sign(await createUser(db, { rol: 'cliente', clienteId: ana.id }));

    const accounts = await api(baseUrl, '/api/me/accounts', { token });
    assert.deepEqual(accounts.data.map((a) => a.numero_cuenta), [anaAccount.numero_cuenta]);

    const customer = await api(baseUrl, '/api/me/customer', { token });
    assert.equal(customer.data.documento, '100');

    const own = await api(baseUrl, `/api/me/transactions?accountNumber=${anaAccount.numero_cuenta}`, { token });
    assert.equal(own.status, 200);
    assert.equal(own.data.movements.length, 1);

    const other = await api(baseUrl, `/api/me/transactions?accountNumber=${luisAccount.numero_cuenta}`, { token });
    assert.equal(other.status, 404, 'no puede ver la cuenta de otro cliente');

    for (const path of ['/api/customers', '/api/accounts', '/api/transactions', '/api/users']) {
      assert.equal((await api(baseUrl, path, { token })).status, 403, path);
    }
    assert.equal((await operate(baseUrl, 'withdraw', luisAccount.id, 1, { token })).status, 403);
  });
});

test('permisos: las rutas del cliente no están disponibles para el personal', async () => {
  await withApp(async (baseUrl, db, { tokens }) => {
    assert.equal((await api(baseUrl, '/api/me/accounts', { token: tokens.cajero })).status, 403);
  });
});

test('usuarios: el administrador crea cajeros y clientes vinculados', async () => {
  await withApp(async (baseUrl) => {
    const cajero = await api(baseUrl, '/api/users', {
      method: 'POST',
      body: { email: 'Cajero1@NovaBank.co', password: 'Clave-segura-1', rol: 'cajero', nombre_completo: 'Carlos Caja' },
    });
    assert.equal(cajero.status, 201);
    assert.equal(cajero.data.user.email, 'cajero1@novabank.co');
    assert.equal(cajero.data.user.rol, 'cajero');

    const duplicate = await api(baseUrl, '/api/users', {
      method: 'POST',
      body: { email: 'cajero1@novabank.co', password: 'Clave-segura-1', rol: 'cajero', nombre_completo: 'Otro' },
    });
    assert.equal(duplicate.status, 409);

    await createCustomer(baseUrl, { documento: '777' });
    const cliente = await api(baseUrl, '/api/users', {
      method: 'POST',
      body: { email: 'ana@cliente.co', password: 'Clave-segura-2', rol: 'cliente', documento_cliente: '777' },
    });
    assert.equal(cliente.status, 201);
    assert.equal(cliente.data.user.documento_cliente, '777');
    assert.equal(cliente.data.user.nombre_completo, 'Ana Gomez');

    const secondUserSameCustomer = await api(baseUrl, '/api/users', {
      method: 'POST',
      body: { email: 'otra@cliente.co', password: 'Clave-segura-3', rol: 'cliente', documento_cliente: '777' },
    });
    assert.equal(secondUserSameCustomer.status, 409);

    const list = await api(baseUrl, '/api/users');
    assert.equal(list.data.length, 4, 'admin y cajero de prueba + los 2 nuevos');
  });
});

test('usuarios: valida datos y no deja usuarios a medias', async () => {
  await withApp(async (baseUrl, db) => {
    const cases = [
      [{ email: 'malo', password: 'Clave-segura-1', rol: 'cajero', nombre_completo: 'X Y' }, 400],
      [{ email: 'a@b.co', password: 'corta', rol: 'cajero', nombre_completo: 'X Y' }, 400],
      [{ email: 'a@b.co', password: 'Clave-segura-1', rol: 'superusuario', nombre_completo: 'X Y' }, 400],
      [{ email: 'a@b.co', password: 'Clave-segura-1', rol: 'cliente' }, 400],
      [{ email: 'a@b.co', password: 'Clave-segura-1', rol: 'cliente', documento_cliente: '404' }, 404],
    ];
    for (const [body, status] of cases) {
      assert.equal((await api(baseUrl, '/api/users', { method: 'POST', body })).status, status, JSON.stringify(body));
    }
    const orphans = await db.query("SELECT u.id FROM auth.users u LEFT JOIN public.perfiles p ON p.id = u.id WHERE p.id IS NULL");
    assert.equal(orphans.length, 0);
  });
});

test('usuarios: el administrador inactiva y reactiva usuarios, pero no a sí mismo', async () => {
  await withApp(async (baseUrl, db, { tokens, users }) => {
    const inactivate = await api(baseUrl, `/api/users/${users.cajero}/inactivate`, { method: 'POST' });
    assert.equal(inactivate.status, 200);
    assert.equal(inactivate.data.user.activo, false);
    assert.equal((await api(baseUrl, '/api/accounts', { token: tokens.cajero })).status, 403, 'el cajero inactivo pierde el acceso');

    assert.equal((await api(baseUrl, `/api/users/${users.cajero}/activate`, { method: 'POST' })).status, 200);
    assert.equal((await api(baseUrl, '/api/accounts', { token: tokens.cajero })).status, 200);

    assert.equal((await api(baseUrl, `/api/users/${users.admin}/inactivate`, { method: 'POST' })).status, 409);
  });
});
