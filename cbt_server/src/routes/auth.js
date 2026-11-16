const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password || username.length > 80 || password.length > 200) {
      return res.status(400).json({ error: 'Enter a valid username and password' });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password_hash, full_name, role, is_active FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    const user = rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const token = jwt.sign(
      { sub: String(user.id), username: user.username, role: user.role, name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
