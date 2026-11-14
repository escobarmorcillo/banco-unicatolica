// Base de datos para pruebas: PostgreSQL real en memoria (PGlite) con las
// mismas migraciones que se aplican en Supabase. No toca la base real.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite, types } = require('@electric-sql/pglite');

const migrationsDir = path.join(__dirname, '..', '..', 'supabase', 'migrations');

// Simula lo mínimo de Supabase que usan las migraciones: auth.users, auth.uid() y los roles.
const SUPABASE_STUB = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

function wrapPglite(pg) {
  const query = (text, params = []) => pg.query(text, params).then((result) => result.rows);
  return {
    pg,
    query,
    transaction: (callback) => pg.transaction((tx) => callback({
      query: (text, params = []) => tx.query(text, params).then((result) => result.rows),
    })),
    close: () => pg.close(),
  };
}

async function createTestDatabase({ dataDir } = {}) {
  const pg = new PGlite({
    dataDir,
    parsers: {
      [types.DATE]: (value) => value, // igual que en producción: 'AAAA-MM-DD'
    },
  });
  const isNew = !dataDir || !(await pg.query("select to_regclass('public.clientes') as t")).rows[0].t;
  if (isNew) {
    await pg.exec(SUPABASE_STUB);
    for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
      await pg.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
  }
  return wrapPglite(pg);
}

module.exports = { createTestDatabase };
