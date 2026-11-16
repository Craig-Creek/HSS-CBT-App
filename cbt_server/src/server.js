require('dotenv').config();

const app = require('./app');
const { pool } = require('./db');
const { expireOverdueAttempts } = require('./services/attempts');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const server = app.listen(port,host,() => {
  console.log(`Harmonie Spring School CBT API listening on http://${host}:${port}`);
});
const expiryWorker = setInterval(() => {
  expireOverdueAttempts().catch(error => console.error('Attempt expiry worker failed:',error.message));
},15000);
expiryWorker.unref();

async function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  clearInterval(expiryWorker);
  server.close(async () => {
    try { await pool.end(); }
    catch(error) { console.error('Database shutdown error:',error.message); }
    process.exit(0);
  });
}
process.on('SIGINT',() => shutdown('SIGINT'));
process.on('SIGTERM',() => shutdown('SIGTERM'));
