const path = require('path');
const { createDb } = require('./sqlite');
const { createSupabaseDb } = require('./postgres');

const defaultSqlitePath = path.join(__dirname, '..', '..', 'db', 'novabank.db');

// Si SUPABASE_DB_URL está definida usa Supabase; si no, SQLite local.
function createConfiguredDb() {
  return process.env.SUPABASE_DB_URL ? createSupabaseDb() : createDb(defaultSqlitePath);
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

module.exports = {
  createDb,
  createSupabaseDb,
  createConfiguredDb,
  promisifyRun,
  promisifyGet,
  promisifyAll,
  runTransaction,
};
