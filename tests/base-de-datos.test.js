// Reglas que la propia base de datos garantiza, aunque alguien salte el backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createTestDatabase } = require('./helpers/test-database');

async function withDatabase(testFn) {
  const db = await createTestDatabase();
  try {
    await testFn(db);
  } finally {
    await db.close();
  }
}

async function createUser(db, rol, clienteId = null) {
  const [user] = await db.query('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
  await db.query('INSERT INTO public.perfiles (id, rol, nombre_completo, cliente_id) VALUES ($1, $2, $3, $4)', [user.id, rol, `Usuario ${rol}`, clienteId]);
  return user.id;
}

async function seed(db) {
  const cajero = await createUser(db, 'cajero');
  const [cliente] = await db.query(`
    INSERT INTO public.clientes (tipo_documento, documento, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion)
    VALUES ('Cedula', '100', 'Ana', 'Gomez', '1990-01-01', '3001112233', 'a@b.co', 'Calle 1') RETURNING id`);
  const [otro] = await db.query(`
    INSERT INTO public.clientes (tipo_documento, documento, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion)
    VALUES ('Cedula', '200', 'Luis', 'Mora', '1990-01-01', '3001112233', 'l@b.co', 'Calle 2') RETURNING id`);
  const [cuenta] = await db.query("INSERT INTO public.cuentas (cliente_id, numero_cuenta, tipo_cuenta) VALUES ($1, '1', 'Ahorros') RETURNING id", [cliente.id]);
  const [cuentaOtro] = await db.query("INSERT INTO public.cuentas (cliente_id, numero_cuenta, tipo_cuenta) VALUES ($1, '2', 'Ahorros') RETURNING id", [otro.id]);
  await db.query('SELECT public.realizar_deposito($1, 1000, null, $2, $3)', [cuenta.id, cajero, randomUUID()]);
  await db.query('SELECT public.realizar_deposito($1, 2000, null, $2, $3)', [cuentaOtro.id, cajero, randomUUID()]);
  return { cliente, otro, cuenta, cuentaOtro, cajero };
}

async function asUser(db, userId, callback) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId || '']);
    await tx.query(userId ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
    return callback(tx);
  });
}

const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('base de datos: el saldo no se puede cambiar con un UPDATE directo', async () => {
  await withDatabase(async (db) => {
    const { cuenta } = await seed(db);
    await rejects(db.query('UPDATE public.cuentas SET saldo = 999999 WHERE id = $1', [cuenta.id]), 'NB409');
  });
});

test('base de datos: el historial de transacciones no se puede modificar ni borrar', async () => {
  await withDatabase(async (db) => {
    await seed(db);
    await rejects(db.query('UPDATE public.transacciones SET monto = 1'), 'NB409');
    await rejects(db.query('DELETE FROM public.transacciones'), 'NB409');
  });
});

test('base de datos: rechaza movimientos con saldos incoherentes', async () => {
  await withDatabase(async (db) => {
    const { cuenta, cajero } = await seed(db);
    await rejects(db.query(`
      INSERT INTO public.transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, operador_id)
      VALUES ($1, 'deposito', 100, 0, 999, $2)`, [cuenta.id, cajero]), '23514');
  });
});

test('base de datos: toda operación exige un operador del personal activo', async () => {
  await withDatabase(async (db) => {
    const { cliente, cuenta, cajero } = await seed(db);
    const usuarioCliente = await createUser(db, 'cliente', cliente.id);

    const [ok] = await db.query('SELECT * FROM public.realizar_deposito($1, 500, null, $2, $3)', [cuenta.id, cajero, randomUUID()]);
    assert.equal(ok.operador_id, cajero);

    await rejects(db.query('SELECT public.realizar_deposito($1, 500, null, $2, $3)', [cuenta.id, usuarioCliente, randomUUID()]), 'NB403');
    await rejects(db.query('SELECT public.realizar_deposito($1, 500, null, null, $2)', [cuenta.id, randomUUID()]), 'NB403');

    await db.query('UPDATE public.perfiles SET activo = false WHERE id = $1', [cajero]);
    await rejects(db.query('SELECT public.realizar_deposito($1, 500, null, $2, $3)', [cuenta.id, cajero, randomUUID()]), 'NB403');
  });
});

test('base de datos: un perfil de cliente debe estar vinculado a un cliente', async () => {
  await withDatabase(async (db) => {
    await rejects(createUser(db, 'cliente', null), '23514');
    const { cliente } = await seed(db);
    await rejects(createUser(db, 'cajero', cliente.id), '23514');
  });
});

test('RLS: sin sesión (anon) no se puede leer ni escribir nada', async () => {
  await withDatabase(async (db) => {
    await seed(db);
    await rejects(asUser(db, null, (tx) => tx.query('SELECT * FROM public.cuentas')), '42501');
    await rejects(asUser(db, null, (tx) => tx.query("INSERT INTO public.clientes (tipo_documento) VALUES ('x')")), '42501');
  });
});

test('RLS: un cliente solo ve sus propias cuentas y movimientos, y no puede escribir', async () => {
  await withDatabase(async (db) => {
    const { cliente, cuenta } = await seed(db);
    const userId = await createUser(db, 'cliente', cliente.id);

    const cuentas = await asUser(db, userId, (tx) => tx.query('SELECT id FROM public.cuentas'));
    assert.deepEqual(cuentas.map((c) => c.id), [cuenta.id]);

    const movimientos = await asUser(db, userId, (tx) => tx.query('SELECT cuenta_id FROM public.transacciones'));
    assert.ok(movimientos.length > 0 && movimientos.every((m) => m.cuenta_id === cuenta.id));

    const clientes = await asUser(db, userId, (tx) => tx.query('SELECT id FROM public.clientes'));
    assert.deepEqual(clientes.map((c) => c.id), [cliente.id]);

    await rejects(asUser(db, userId, (tx) => tx.query('UPDATE public.cuentas SET estado = $1', ['inactivo'])), '42501');
    await rejects(asUser(db, userId, (tx) => tx.query('SELECT public.realizar_deposito($1, 1, null, $2, $3)', [cuenta.id, userId, randomUUID()])), '42501');
  });
});

test('RLS: el personal ve todas las cuentas', async () => {
  await withDatabase(async (db) => {
    const { cajero } = await seed(db);
    const cuentas = await asUser(db, cajero, (tx) => tx.query('SELECT id FROM public.cuentas'));
    assert.equal(cuentas.length, 2);
  });
});
