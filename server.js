const express = require('express');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
require('dotenv').config();

const dbPath = path.join(__dirname, 'db', 'novabank.db');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMoney(cents) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function createDb(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new sqlite3.Database(filePath, (err) => {
    if (err) {
      console.error('Database connection failed', err.message);
      throw err;
    }
  });

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');
    db.run(`
      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo_documento TEXT NOT NULL,
        documento TEXT NOT NULL UNIQUE,
        nombres TEXT NOT NULL,
        apellidos TEXT NOT NULL,
        fecha_nacimiento TEXT NOT NULL,
        telefono TEXT NOT NULL,
        correo TEXT NOT NULL,
        direccion TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
        fecha_creacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS cuentas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        numero_cuenta TEXT NOT NULL UNIQUE,
        tipo_cuenta TEXT NOT NULL,
        saldo INTEGER NOT NULL DEFAULT 0,
        estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
        fecha_creacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_actualizacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS transacciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cuenta_id INTEGER NOT NULL,
        tipo_transaccion TEXT NOT NULL CHECK (tipo_transaccion IN ('deposito', 'retiro')),
        monto INTEGER NOT NULL,
        saldo_anterior INTEGER NOT NULL,
        saldo_resultante INTEGER NOT NULL,
        descripcion TEXT,
        fecha_hora TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cuenta_id) REFERENCES cuentas(id) ON DELETE RESTRICT
      );
    `);
  });

  return db;
}

function createSupabaseDb(connectionString = process.env.SUPABASE_DB_URL) {
  if (!connectionString) {
    throw new Error('La variable SUPABASE_DB_URL es obligatoria para conectar con Supabase.');
  }

  const certificatePath = process.env.SUPABASE_DB_CA_CERT;
  if (!certificatePath) {
    throw new Error('Configura SUPABASE_DB_CA_CERT con la ruta al certificado CA descargado desde Supabase.');
  }
  let ca;
  try {
    ca = fs.readFileSync(path.resolve(certificatePath), 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer el certificado CA de Supabase: ${error.message}`);
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    ssl: { ca, rejectUnauthorized: true },
  });
  const transactionContext = new AsyncLocalStorage();
  pool.on('error', (error) => {
    console.error('Supabase database pool error', error.message);
  });

  function normalizeSql(sql) {
    return sql
      .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;?\s*$/i, '')
      .replace(/\?/g, (_, offset) => {
        const previous = sql.slice(0, offset);
        const count = (previous.match(/\?/g) || []).length;
        return `$${count + 1}`;
      })
      .trim();
  }

  function normalizeRow(row) {
    if (!row) return row;
    const normalized = { ...row };
    for (const key of ['saldo', 'monto', 'saldo_anterior', 'saldo_resultante']) {
      if (typeof normalized[key] === 'string') {
        const value = Number(normalized[key]);
        if (!Number.isSafeInteger(value)) {
          throw new Error(`El valor de ${key} excede el rango numérico seguro.`);
        }
        normalized[key] = value;
      }
    }
    return normalized;
  }

  function execute(sql, params, kind, callback) {
    const statement = sql.trim().replace(/;$/, '');
    if (/^PRAGMA\s+foreign_keys\s*=\s*ON$/i.test(statement)) {
      callback(null);
      return;
    }

    if (/^BEGIN\s+IMMEDIATE$/i.test(statement)) {
      pool.connect((connectionError, client) => {
        if (connectionError) {
          callback(connectionError);
          return;
        }
        transactionContext.run(client, () => {
          client.query('BEGIN', (beginError) => {
            if (beginError) {
              client.release();
              callback(beginError);
              return;
            }
            callback.call({ lastID: undefined, changes: 0 }, null);
          });
        });
      });
      return;
    }

    if (/^(COMMIT|ROLLBACK)$/i.test(statement)) {
      const client = transactionContext.getStore();
      if (!client) {
        callback(new Error('No hay una transacción activa.'));
        return;
      }
      client.query(statement, (queryError) => {
        client.release();
        callback(queryError);
      });
      return;
    }

    let query = normalizeSql(statement);
    if (/^INSERT\s+INTO\s+(clientes|cuentas|transacciones)\b/i.test(query) && !/\bRETURNING\b/i.test(query)) {
      query += ' RETURNING id';
    }
    const client = transactionContext.getStore() || pool;
    client.query(query, params, (queryError, result) => {
      if (queryError) {
        callback(queryError);
        return;
      }

      try {
        if (kind === 'run') {
          const inserted = result.rows[0];
          callback.call({ lastID: inserted ? inserted.id : undefined, changes: result.rowCount }, null);
        } else if (kind === 'get') {
          callback(null, normalizeRow(result.rows[0]));
        } else {
          callback(null, result.rows.map(normalizeRow));
        }
      } catch (error) {
        callback(error);
      }
    });
  }

  return {
    isPostgres: true,
    serialize(callback) {
      callback();
    },
    run(sql, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      callback = callback || (() => {});
      execute(sql, params, 'run', callback);
    },
    get(sql, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      callback = callback || (() => {});
      execute(sql, params, 'get', callback);
    },
    all(sql, params = [], callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      callback = callback || (() => {});
      execute(sql, params, 'all', callback);
    },
  };
}

function createConfiguredDb() {
  return process.env.SUPABASE_DB_URL ? createSupabaseDb() : createDb(dbPath);
}

function promisifyRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function promisifyGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function promisifyAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function runTransaction(db, callback) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (err) => {
        if (err) {
          reject(err);
          return;
        }

        Promise.resolve()
          .then(callback)
          .then((result) =>
            new Promise((commitResolve, commitReject) => {
              db.run('COMMIT', (commitErr) => {
                if (commitErr) commitReject(commitErr);
                else commitResolve(result);
              });
            })
          )
          .then(resolve)
          .catch((error) => {
            db.run('ROLLBACK', () => reject(error));
          });
      });
    });
  });
}

function isAtLeastFifteen(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const [year, month, day] = dateString.split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return false;
  const today = new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 15, today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= cutoff;
}

function isAdult(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const [year, month, day] = dateString.split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return false;
  const today = new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= cutoff;
}

function validateCustomer(payload) {
  if (!/^\d{1,10}$/.test(payload.documento)) {
    return 'El documento debe contener solo números y tener máximo 10 dígitos.';
  }
  if (!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(payload.nombres)) {
    return 'Los nombres solo pueden contener letras y espacios.';
  }
  if (!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(payload.apellidos)) {
    return 'Los apellidos solo pueden contener letras y espacios.';
  }
  if (!isAtLeastFifteen(payload.fecha_nacimiento)) {
    return 'El cliente debe tener mínimo 15 años. Verifica la fecha de nacimiento.';
  }
  if (!/^\d{10}$/.test(payload.telefono)) {
    return 'El teléfono debe contener exactamente 10 números.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.correo)) {
    return 'El correo electrónico no tiene un formato válido.';
  }
  if (payload.direccion.length < 2) {
    return 'La dirección del cliente es obligatoria.';
  }
  return '';
}

function parseValidMoney(value, allowZero = false) {
  const normalized = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? { amount, cents } : null;
}

function dateNow() {
  return new Date().toISOString();
}

function accountBelongsToCustomer(accountId, customerId, db) {
  return promisifyGet(
    db,
    'SELECT c.id FROM cuentas c WHERE c.id = ? AND c.cliente_id = ?',
    [accountId, customerId]
  );
}

function capitalizeFirst(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function createApp(database = createConfiguredDb()) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/health', async (req, res) => {
    res.json({ ok: true, message: 'NovaBank API running' });
  });

  app.get('/api/customers', async (req, res) => {
    try {
      const doc = (req.query.document || '').trim();
      const sql = doc
        ? 'SELECT * FROM clientes WHERE documento = ? ORDER BY id DESC'
        : 'SELECT * FROM clientes ORDER BY id DESC';
      const values = doc ? [doc] : [];
      const rows = await promisifyAll(database, sql, values);
      res.json(rows.map((row) => ({ ...row, estado: row.estado || 'activo' })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const body = req.body || {};
      const payload = {
        tipo_documento: (body.tipo_documento || '').trim(),
        documento: (body.documento || '').trim(),
        nombres: (body.nombres || '').trim(),
        apellidos: (body.apellidos || '').trim(),
        fecha_nacimiento: (body.fecha_nacimiento || '').trim(),
        telefono: (body.telefono || '').trim(),
        correo: (body.correo || '').trim(),
        direccion: (body.direccion || '').trim(),
      };

      const missing = Object.entries(payload).filter(([, value]) => !value || value.length < 2);
      if (missing.length) {
        return res.status(400).json({ error: 'Todos los campos obligatorios deben estar completos.' });
      }

      const validationError = validateCustomer(payload);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const existingDoc = await promisifyGet(database, 'SELECT id FROM clientes WHERE documento = ?', [payload.documento]);
      if (existingDoc) {
        return res.status(409).json({ error: 'El documento ya existe en el sistema.' });
      }

      const result = await promisifyRun(database, `
        INSERT INTO clientes (tipo_documento, documento, nombres, apellidos, fecha_nacimiento, telefono, correo, direccion, estado, fecha_creacion, fecha_actualizacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?, ?)
      `, [payload.tipo_documento, payload.documento, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.telefono, payload.correo, payload.direccion, dateNow(), dateNow()]);

      const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [result.id]);
      res.status(201).json({ customer, message: 'Cliente registrado correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/customers/:id', async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const row = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
      if (!row) {
        return res.status(404).json({ error: 'Cliente no encontrado.' });
      }

      const body = req.body || {};
      const payload = {
        tipo_documento: (body.tipo_documento || row.tipo_documento || '').trim(),
        documento: (body.documento || row.documento || '').trim(),
        nombres: (body.nombres || row.nombres || '').trim(),
        apellidos: (body.apellidos || row.apellidos || '').trim(),
        fecha_nacimiento: (body.fecha_nacimiento || row.fecha_nacimiento || '').trim(),
        telefono: (body.telefono || row.telefono || '').trim(),
        correo: (body.correo || row.correo || '').trim(),
        direccion: (body.direccion || row.direccion || '').trim(),
      };

      const validationError = validateCustomer(payload);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const duplicate = await promisifyGet(database, 'SELECT id FROM clientes WHERE documento = ? AND id != ?', [payload.documento, customerId]);
      if (duplicate) {
        return res.status(409).json({ error: 'El documento ya existe para otro cliente.' });
      }

      await promisifyRun(database, `
        UPDATE clientes
        SET tipo_documento = ?, documento = ?, nombres = ?, apellidos = ?, fecha_nacimiento = ?, telefono = ?, correo = ?, direccion = ?, fecha_actualizacion = ?
        WHERE id = ?
      `, [payload.tipo_documento, payload.documento, payload.nombres, payload.apellidos, payload.fecha_nacimiento, payload.telefono, payload.correo, payload.direccion, dateNow(), customerId]);

      const updated = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
      res.json({ customer: updated, message: 'Cliente actualizado correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/customers/:id/inactivate', async (req, res) => {
    try {
      const customerId = Number(req.params.id);
      const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
      if (!customer) {
        return res.status(404).json({ error: 'Cliente no encontrado.' });
      }

      const activeAccounts = await promisifyAll(database, 'SELECT id FROM cuentas WHERE cliente_id = ? AND estado = ?', [customerId, 'activo']);
      if (activeAccounts.length > 0) {
        return res.status(409).json({
          error: 'No se puede inactivar el cliente porque tiene cuentas activas asociadas.',
        });
      }

      await promisifyRun(database, 'UPDATE clientes SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['inactivo', dateNow(), customerId]);
      const updated = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [customerId]);
      res.json({ customer: updated, message: 'Cliente inactivado correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/accounts', async (req, res) => {
    try {
      const { number, search, customerId } = req.query;
      const filterByNumber = (number || '').trim();
      const searchTerm = (search || '').trim();
      const filterCustomerId = customerId ? Number(customerId) : null;

      let sql = `
        SELECT a.*, c.documento, c.nombres, c.apellidos
        FROM cuentas a
        INNER JOIN clientes c ON c.id = a.cliente_id
      `;
      const params = [];
      const clauses = [];

      if (filterByNumber) {
        clauses.push('a.numero_cuenta = ?');
        params.push(filterByNumber);
      }
      if (searchTerm) {
        clauses.push('(LOWER(a.numero_cuenta) LIKE LOWER(?) OR LOWER(c.documento) LIKE LOWER(?) OR LOWER(c.nombres) LIKE LOWER(?) OR LOWER(c.apellidos) LIKE LOWER(?))');
        const partial = `%${searchTerm}%`;
        params.push(partial, partial, partial, partial);
      }
      if (filterCustomerId) {
        clauses.push('a.cliente_id = ?');
        params.push(filterCustomerId);
      }
      if (clauses.length) {
        sql += ' WHERE ' + clauses.join(' AND ');
      }
      sql += ' ORDER BY a.id DESC';

      const rows = await promisifyAll(database, sql, params);
      res.json(rows.map((row) => ({ ...row, cliente: `${row.nombres} ${row.apellidos}` })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accounts', async (req, res) => {
    try {
      const body = req.body || {};
      const clienteId = Number(body.cliente_id);
      const numeroCuenta = (body.numero_cuenta || '').trim();
      const tipoCuenta = (body.tipo_cuenta || '').trim();
      const saldoInicial = parseValidMoney(body.saldo_inicial ?? '0', true);

      if (!clienteId) {
        return res.status(400).json({ error: 'Debe seleccionar un cliente titular válido.' });
      }
      if (!numeroCuenta || !tipoCuenta) {
        return res.status(400).json({ error: 'El número de cuenta y el tipo de cuenta son obligatorios.' });
      }
      if (!/^\d+$/.test(numeroCuenta)) {
        return res.status(400).json({ error: 'El número de cuenta solo puede contener números.' });
      }
      if (!['Ahorros', 'Corriente', 'Nomina'].includes(tipoCuenta)) {
        return res.status(400).json({ error: 'Tipo de cuenta no válido.' });
      }
      if (!saldoInicial) {
        return res.status(400).json({ error: 'El saldo inicial debe ser un monto válido, no negativo y con máximo dos decimales.' });
      }

      const customer = await promisifyGet(database, 'SELECT * FROM clientes WHERE id = ?', [clienteId]);
      if (!customer) {
        return res.status(404).json({ error: 'El cliente titular no existe.' });
      }
      if (customer.estado !== 'activo') {
        return res.status(409).json({ error: 'No se puede crear una cuenta para un cliente inactivo.' });
      }

      const duplicate = await promisifyGet(database, 'SELECT id FROM cuentas WHERE numero_cuenta = ?', [numeroCuenta]);
      if (duplicate) {
        return res.status(409).json({ error: 'El número de cuenta ya existe.' });
      }

      const cents = saldoInicial.cents;
      const account = await runTransaction(database, async () => {
        const result = await promisifyRun(database, `
          INSERT INTO cuentas (cliente_id, numero_cuenta, tipo_cuenta, saldo, estado, fecha_creacion, fecha_actualizacion)
          VALUES (?, ?, ?, ?, 'activo', ?, ?)
        `, [clienteId, numeroCuenta, tipoCuenta, cents, dateNow(), dateNow()]);

        const createdAccount = await promisifyGet(database, 'SELECT a.*, c.documento, c.nombres, c.apellidos FROM cuentas a INNER JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?', [result.id]);

        if (cents > 0) {
          await promisifyRun(database, `
            INSERT INTO transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora)
            VALUES (?, 'deposito', ?, 0, ?, 'Saldo inicial registrado', ?)
          `, [createdAccount.id, cents, cents, dateNow()]);
        }
        return createdAccount;
      });

      res.status(201).json({ account, message: 'Cuenta creada y saldo inicial registrado en el historial.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/accounts/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [id]);
      if (!account) {
        return res.status(404).json({ error: 'Cuenta no encontrada.' });
      }

      const body = req.body || {};
      const nextTipo = (body.tipo_cuenta || account.tipo_cuenta || '').trim();
      const nextEstado = (body.estado || account.estado || 'activo').trim();

      if (!nextTipo) {
        return res.status(400).json({ error: 'El tipo de cuenta es obligatorio.' });
      }

      const allowed = ['Ahorros', 'Corriente', 'Nomina'];
      if (!allowed.includes(nextTipo)) {
        return res.status(400).json({ error: 'Tipo de cuenta no válido.' });
      }

      if (!['activo', 'inactivo'].includes(nextEstado)) {
        return res.status(400).json({ error: 'Estado de cuenta no válido.' });
      }

      if (nextEstado === 'inactivo' && account.saldo !== 0) {
        return res.status(409).json({ error: 'La cuenta no puede inactivarse porque su saldo no es cero.' });
      }

      await promisifyRun(database, `
        UPDATE cuentas
        SET tipo_cuenta = ?, estado = ?, fecha_actualizacion = ?
        WHERE id = ?
      `, [nextTipo, nextEstado, dateNow(), id]);

      const updated = await promisifyGet(database, 'SELECT a.*, c.documento, c.nombres, c.apellidos FROM cuentas a INNER JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?', [id]);
      res.json({ account: updated, message: 'Cuenta actualizada correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/accounts/:id/inactivate', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [id]);
      if (!account) {
        return res.status(404).json({ error: 'Cuenta no encontrada.' });
      }
      if (account.saldo !== 0) {
        return res.status(409).json({ error: 'La cuenta no puede inactivarse porque su saldo no es cero.' });
      }

      await promisifyRun(database, 'UPDATE cuentas SET estado = ?, fecha_actualizacion = ? WHERE id = ?', ['inactivo', dateNow(), id]);
      const updated = await promisifyGet(database, 'SELECT a.*, c.documento, c.nombres, c.apellidos FROM cuentas a INNER JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?', [id]);
      res.json({ account: updated, message: 'Cuenta inactivada correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/transactions', async (req, res) => {
    try {
      const accountNumber = (req.query.accountNumber || '').trim();
      let sql = `
        SELECT t.*, c.numero_cuenta, c.saldo AS saldo_actual
        FROM transacciones t
        INNER JOIN cuentas c ON c.id = t.cuenta_id
      `;
      const params = [];
      if (accountNumber) {
        sql += ' WHERE c.numero_cuenta = ?';
        params.push(accountNumber);
      }
      sql += ' ORDER BY t.fecha_hora DESC, t.id DESC';
      const rows = await promisifyAll(database, sql, params);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/transactions/deposit', async (req, res) => {
    try {
      const body = req.body || {};
      const accountId = Number(body.account_id || body.cuenta_id);
      const amount = parseValidMoney(body.amount ?? body.monto ?? '0');
      const description = (body.description || body.descripcion || 'Depósito').trim();

      if (!accountId) {
        return res.status(400).json({ error: 'Debe seleccionar una cuenta válida.' });
      }
      if (!amount) {
        return res.status(400).json({ error: 'El monto del depósito debe ser mayor que cero y tener máximo dos decimales.' });
      }

      const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      if (!account) {
        return res.status(404).json({ error: 'La cuenta no existe.' });
      }
      if (account.estado !== 'activo') {
        return res.status(409).json({ error: 'No se puede operar sobre una cuenta inactiva.' });
      }

      const centsAmount = amount.cents;
      await runTransaction(database, async () => {
        const lock = database.isPostgres ? ' FOR UPDATE' : '';
        const current = await promisifyGet(database, `SELECT saldo, estado FROM cuentas WHERE id = ?${lock}`, [accountId]);
        if (!current || current.estado !== 'activo') {
          throw new Error('No se puede operar sobre una cuenta inactiva.');
        }
        const newBalance = current.saldo + centsAmount;
        await promisifyRun(database, 'UPDATE cuentas SET saldo = ?, fecha_actualizacion = ? WHERE id = ?', [newBalance, dateNow(), accountId]);
        await promisifyRun(database, `
          INSERT INTO transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora)
          VALUES (?, 'deposito', ?, ?, ?, ?, ?)
        `, [accountId, centsAmount, current.saldo, newBalance, description || 'Depósito', dateNow()]);
      });

      const updatedAccount = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      res.json({ account: updatedAccount, message: 'Depósito registrado correctamente.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/transactions/withdraw', async (req, res) => {
    try {
      const body = req.body || {};
      const accountId = Number(body.account_id || body.cuenta_id);
      const amount = parseValidMoney(body.amount ?? body.monto ?? '0');
      const description = (body.description || body.descripcion || 'Retiro').trim();

      if (!accountId) {
        return res.status(400).json({ error: 'Debe seleccionar una cuenta válida.' });
      }
      if (!amount) {
        return res.status(400).json({ error: 'El monto del retiro debe ser mayor que cero y tener máximo dos decimales.' });
      }

      const account = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      if (!account) {
        return res.status(404).json({ error: 'La cuenta no existe.' });
      }
      if (account.estado !== 'activo') {
        return res.status(409).json({ error: 'No se puede operar sobre una cuenta inactiva.' });
      }

      const centsAmount = amount.cents;
      await runTransaction(database, async () => {
        const lock = database.isPostgres ? ' FOR UPDATE' : '';
        const current = await promisifyGet(database, `SELECT saldo, estado FROM cuentas WHERE id = ?${lock}`, [accountId]);
        if (!current || current.estado !== 'activo') {
          throw new Error('No se puede operar sobre una cuenta inactiva.');
        }
        if (centsAmount > current.saldo) {
          throw new Error('El retiro excede el saldo disponible.');
        }
        const newBalance = current.saldo - centsAmount;
        await promisifyRun(database, 'UPDATE cuentas SET saldo = ?, fecha_actualizacion = ? WHERE id = ?', [newBalance, dateNow(), accountId]);
        await promisifyRun(database, `
          INSERT INTO transacciones (cuenta_id, tipo_transaccion, monto, saldo_anterior, saldo_resultante, descripcion, fecha_hora)
          VALUES (?, 'retiro', ?, ?, ?, ?, ?)
        `, [accountId, centsAmount, current.saldo, newBalance, description || 'Retiro', dateNow()]);
      });

      const updatedAccount = await promisifyGet(database, 'SELECT * FROM cuentas WHERE id = ?', [accountId]);
      res.json({ account: updatedAccount, message: 'Retiro registrado correctamente.' });
    } catch (error) {
      const message = error.message || 'Error al registrar el retiro';
      res.status(400).json({ error: message });
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`NovaBank running on http://localhost:${port}`);
  });
}

module.exports = { createApp, createDb, createSupabaseDb, formatMoney, isAdult, runTransaction, promisifyAll, promisifyGet, promisifyRun };
