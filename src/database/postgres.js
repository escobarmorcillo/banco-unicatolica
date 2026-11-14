const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Pool } = require('pg');

// Conexión a Supabase PostgreSQL con la misma interfaz (run/get/all) que SQLite.
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

  function withOptionalParams(kind) {
    return (sql, params = [], callback) => {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      execute(sql, params, kind, callback || (() => {}));
    };
  }

  return {
    isPostgres: true,
    serialize(callback) {
      callback();
    },
    run: withOptionalParams('run'),
    get: withOptionalParams('get'),
    all: withOptionalParams('all'),
  };
}

module.exports = { createSupabaseDb };
