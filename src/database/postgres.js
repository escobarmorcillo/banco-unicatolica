const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// BIGINT (saldos y montos en centavos) llega como texto; se convierte a número
// verificando que no pierda precisión.
function parseBigint(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error('Un valor numérico excede el rango seguro.');
  }
  return number;
}

const typeParsers = {
  getTypeParser(oid, format) {
    if (oid === types.builtins.INT8) return parseBigint;
    if (oid === types.builtins.DATE) return (value) => value; // 'AAAA-MM-DD' sin zona horaria
    return types.getTypeParser(oid, format);
  },
};

function readCertificate(certificatePath) {
  if (!certificatePath) {
    throw new Error('Configura SUPABASE_DB_CA_CERT con la ruta al certificado CA descargado desde Supabase.');
  }
  try {
    return fs.readFileSync(path.resolve(certificatePath), 'utf8');
  } catch (error) {
    throw new Error(`No se pudo leer el certificado CA de Supabase: ${error.message}`);
  }
}

// Conexión a Supabase PostgreSQL.
// Interfaz: query(sql, params) -> filas · transaction(fn) · close()
function createSupabaseDb({
  connectionString = process.env.SUPABASE_DB_URL,
  certificatePath = process.env.SUPABASE_DB_CA_CERT,
} = {}) {
  if (!connectionString) {
    throw new Error('Falta SUPABASE_DB_URL. Copia .env.example como .env y define la conexión de Supabase.');
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    ssl: { ca: readCertificate(certificatePath), rejectUnauthorized: true },
    types: typeParsers,
  });
  pool.on('error', (error) => {
    console.error('Supabase database pool error', error.message);
  });

  const query = (text, params = []) => pool.query(text, params).then((result) => result.rows);

  async function transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({
        query: (text, params = []) => client.query(text, params).then((res) => res.rows),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return { query, transaction, close: () => pool.end() };
}

module.exports = { createSupabaseDb };
