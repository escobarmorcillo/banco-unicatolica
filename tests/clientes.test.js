const test = require('node:test');
const assert = require('node:assert/strict');
const { withApp, api, validCustomer, createCustomer, createAccount } = require('./helpers/api');

test('clientes: registra un cliente válido y rechaza el documento duplicado', async () => {
  await withApp(async (baseUrl) => {
    const first = await api(baseUrl, '/api/customers', { method: 'POST', body: validCustomer() });
    assert.equal(first.status, 201);
    assert.equal(first.data.message, 'Cliente registrado correctamente.');
    assert.equal(first.data.customer.fecha_nacimiento, '1990-05-01');

    const duplicate = await api(baseUrl, '/api/customers', { method: 'POST', body: validCustomer() });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.data.error, /documento/i);
  });
});

test('clientes: rechaza menores de 18 años y permite listar', async () => {
  await withApp(async (baseUrl) => {
    const underageDate = new Date();
    underageDate.setUTCFullYear(underageDate.getUTCFullYear() - 17);
    const underage = await api(baseUrl, '/api/customers', {
      method: 'POST',
      body: validCustomer({ documento: '99999999', fecha_nacimiento: underageDate.toISOString().slice(0, 10) }),
    });
    assert.equal(underage.status, 400);
    assert.match(underage.data.error, /18/i);

    const list = await api(baseUrl, '/api/customers');
    assert.equal(list.status, 200);
    assert.equal(Array.isArray(list.data), true);
  });
});

test('clientes: valida formato y longitud de documento, nombres y teléfono', async () => {
  await withApp(async (baseUrl) => {
    const valid = validCustomer({ nombres: 'Ana María', apellidos: 'Gómez Ñúñez' });
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

    const validResponse = await api(baseUrl, '/api/customers', { method: 'POST', body: valid });
    assert.equal(validResponse.status, 201);
  });
});

test('clientes: aplica las mismas reglas al actualizar', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '55555555' });
    const base = { documento: '55555555', telefono: '3001112233', nombres: 'Ana', apellidos: 'Gomez', correo: 'ana@test.com', direccion: 'Calle 1' };
    const invalidUpdates = [
      { ...base, documento: '12ABC' },
      { ...base, telefono: '30011122334' },
      { ...base, nombres: 'Ana2' },
      { ...base, apellidos: 'Gómez!' },
    ];

    for (const body of invalidUpdates) {
      const response = await api(baseUrl, `/api/customers/${customer.id}`, { method: 'PUT', body });
      assert.equal(response.status, 400);
    }

    const updated = await api(baseUrl, `/api/customers/${customer.id}`, {
      method: 'PUT',
      body: { ...base, telefono: '3012223344', nombres: 'ANA María', apellidos: 'Gómez Ñúñez', correo: 'ana.actualizada@test.com', direccion: 'Carrera 2' },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.customer.nombres, 'ANA María');
    assert.equal(updated.data.customer.apellidos, 'Gómez Ñúñez');
  });
});

test('clientes: inactiva y reactiva; no inactiva con cuentas activas', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl, { documento: '44444444' });
    const id = customer.id;

    const alreadyActive = await api(baseUrl, `/api/customers/${id}/activate`, { method: 'POST' });
    assert.equal(alreadyActive.status, 409);

    const account = await createAccount(baseUrl, id);
    const blocked = await api(baseUrl, `/api/customers/${id}/inactivate`, { method: 'POST' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /cuentas activas/i);

    await api(baseUrl, `/api/accounts/${account.id}/inactivate`, { method: 'POST' });
    const inactive = await api(baseUrl, `/api/customers/${id}/inactivate`, { method: 'POST' });
    assert.equal(inactive.data.customer.estado, 'inactivo');

    const active = await api(baseUrl, `/api/customers/${id}/activate`, { method: 'POST' });
    assert.equal(active.status, 200);
    assert.equal(active.data.customer.estado, 'activo');
  });
});

test('clientes: responde 404 para ids inexistentes o inválidos', async () => {
  await withApp(async (baseUrl) => {
    for (const id of ['99999', 'abc', '-1']) {
      const response = await api(baseUrl, `/api/customers/${id}/activate`, { method: 'POST' });
      assert.equal(response.status, 404);
    }
  });
});

test('clientes: solo acepta Cédula o Pasaporte como tipo de documento', async () => {
  await withApp(async (baseUrl) => {
    const response = await api(baseUrl, '/api/customers', { method: 'POST', body: validCustomer({ tipo_documento: 'Tarjeta de identidad' }) });
    assert.equal(response.status, 400);
    assert.match(response.data.error, /Cédula o Pasaporte/);
    assert.equal((await api(baseUrl, '/api/customers', { method: 'POST', body: validCustomer({ tipo_documento: 'Pasaporte' }) })).status, 201);
  });
});

test('clientes: un cliente inactivo no se puede editar hasta activarlo', async () => {
  await withApp(async (baseUrl) => {
    const customer = await createCustomer(baseUrl);
    await api(baseUrl, `/api/customers/${customer.id}/inactivate`, { method: 'POST' });

    const blocked = await api(baseUrl, `/api/customers/${customer.id}`, { method: 'PUT', body: { telefono: '3109998877' } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /inactivo/i);

    await api(baseUrl, `/api/customers/${customer.id}/activate`, { method: 'POST' });
    const allowed = await api(baseUrl, `/api/customers/${customer.id}`, { method: 'PUT', body: { telefono: '3109998877' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.customer.telefono, '3109998877');
  });
});
