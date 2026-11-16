const jwt = require('jsonwebtoken');
const { pool } = require('../db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.execute(
      'SELECT id, role, is_active FROM users WHERE id=? LIMIT 1',
      [decoded.sub]
    );
    const account = rows[0];
    if (!account || !account.is_active || account.role !== decoded.role) {
      return res.status(401).json({ error: 'This account is inactive or its access has changed' });
    }
    req.user = decoded;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Session is invalid or has expired' });
    }
    return next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
