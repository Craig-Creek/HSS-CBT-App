const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { checkDatabase } = require('./db');
const authRoutes = require('./routes/auth');
const questionRoutes = require('./routes/questions');

const app = express();
app.disable('x-powered-by');
app.use(helmet());

const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || origins.length === 0 || origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (req, res) => {
  try {
    await checkDatabase();
    return res.json({ status: 'ok', service: 'Harmonie Spring School CBT API', database: 'connected' });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return res.status(503).json({ status: 'degraded', service: 'Harmonie Spring School CBT API', database: 'unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/questions', questionRoutes);

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'An unexpected server error occurred' });
});

module.exports = app;
