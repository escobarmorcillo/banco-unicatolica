// Punto de entrada de NovaBank: carga la configuración y arranca el servidor HTTP.
require('dotenv').config();

const { createApp } = require('./src/app');
const { createDb, createSupabaseDb } = require('./src/database');

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`NovaBank running on http://localhost:${port}`);
  });
}

module.exports = { createApp, createDb, createSupabaseDb };
