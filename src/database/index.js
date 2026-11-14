const { createSupabaseDb } = require('./postgres');

// Punto único para obtener la base de datos de la aplicación.
function createConfiguredDb() {
  return createSupabaseDb();
}

// Devuelve la primera fila de una consulta o undefined.
async function queryOne(database, text, params = []) {
  const rows = await database.query(text, params);
  return rows[0];
}

module.exports = { createConfiguredDb, createSupabaseDb, queryOne };
