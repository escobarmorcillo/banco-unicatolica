const path = require('path');
const express = require('express');
const { createConfiguredDb } = require('./database');
const { createSupabaseTokenVerifier } = require('./auth/verify-token');
const { createSupabaseUserAdmin } = require('./auth/user-admin');
const { ROLES, STAFF, authenticate, requireRole } = require('./auth/middleware');
const { createCustomersRouter } = require('./routes/customers');
const { createAccountsRouter } = require('./routes/accounts');
const { createTransactionsRouter } = require('./routes/transactions');
const { createMeRouter } = require('./routes/me');
const { createUsersRouter } = require('./routes/users');
const { apiNotFound, errorHandler } = require('./errors');

const publicDir = path.join(__dirname, '..', 'public');
const supabaseBrowserBundle = require.resolve('@supabase/supabase-js/dist/umd/supabase.js');

function defaultPublicConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  };
}

function createApp(database = createConfiguredDb(), {
  verifyToken = createSupabaseTokenVerifier(),
  userAdmin = createSupabaseUserAdmin(),
  publicConfig = defaultPublicConfig(),
} = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ---------- Rutas públicas ----------
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, message: 'NovaBank API running' });
  });

  // Datos PÚBLICOS que el navegador necesita para iniciar sesión con Supabase.
  app.get('/api/config', (req, res) => {
    if (!publicConfig.supabaseUrl || !publicConfig.supabasePublishableKey) {
      res.status(503).json({ error: 'El inicio de sesión no está configurado en el servidor.' });
      return;
    }
    res.json(publicConfig);
  });

  // ---------- Desde aquí, toda la API exige sesión ----------
  app.use('/api', authenticate(database, verifyToken));

  app.use('/api/me', createMeRouter(database));
  app.use('/api/customers', requireRole(...STAFF), createCustomersRouter(database));
  app.use('/api/accounts', requireRole(...STAFF), createAccountsRouter(database));
  app.use('/api/transactions', requireRole(...STAFF), createTransactionsRouter(database));
  app.use('/api/users', requireRole(ROLES.ADMIN), createUsersRouter(database, userAdmin));
  app.use('/api', apiNotFound);

  // ---------- Interfaz ----------
  app.get('/vendor/supabase.js', (req, res) => res.sendFile(supabaseBrowserBundle));
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
