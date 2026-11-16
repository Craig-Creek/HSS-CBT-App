require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
const ask = (label) => new Promise(resolve => rl.question(label,resolve));

(async () => {
  try {
    const username = (await ask('Admin username: ')).trim();
    const fullName = (await ask('Administrator full name: ')).trim();
    const password = await ask('Admin password (minimum 10 characters): ');
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new Error('Username must be 3–80 letters, numbers, dots, underscores or hyphens');
    if (!fullName || fullName.length > 160) throw new Error('Enter a valid full name');
    if (password.length < 10) throw new Error('Password must be at least 10 characters');
    const hash = await bcrypt.hash(password,12);
    await pool.execute("INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,'admin')",[username,hash,fullName]);
    console.log('Administrator account created successfully.');
  } catch (error) {
    console.error(error.code === 'ER_DUP_ENTRY' ? 'That username already exists.' : error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    rl.close();
  }
})();
