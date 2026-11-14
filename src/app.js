const path = require('path');
const express = require('express');
const { createConfiguredDb } = require('./database');
const { createCustomersRouter } = require('./routes/customers');
const { createAccountsRouter } = require('./routes/accounts');
const { createTransactionsRouter } = require('./routes/transactions');
const { apiNotFound, errorHandler } = require('./errors');

const publicDir = path.join(__dirname, '..', 'public');

function createApp(database = createConfiguredDb()) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // CORS abierto: se restringirá cuando exista autenticación (Fase 3).
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

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, message: 'NovaBank API running' });
  });

  app.use('/api/customers', createCustomersRouter(database));
  app.use('/api/accounts', createAccountsRouter(database));
  app.use('/api/transactions', createTransactionsRouter(database));
  app.use('/api', apiNotFound);

  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
