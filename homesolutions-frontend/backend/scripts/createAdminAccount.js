const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function generatePassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = crypto.randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }

  return password;
}

async function main() {
  const email = process.argv[2] || 'navyag0509@gmail.com';
  const fullName = process.argv[3] || 'Navya Gupta';
  const providedPassword = process.argv[4];
  const password = providedPassword || generatePassword();

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number(process.env.DB_PORT || 5432);
  const useSsl = process.env.DB_SSL === 'true' || dbHost.includes('supabase.com');

  const pool = new Pool({
    user: process.env.DB_USER,
    host: dbHost,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: dbPort,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO app_users (full_name, email, password_hash, user_role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       user_role = 'admin'
     RETURNING user_id, full_name, email, user_role`,
    [fullName, email.toLowerCase().trim(), passwordHash]
  );

  const user = result.rows[0];

  console.log('Admin account ready');
  console.log(`user_id: ${user.user_id}`);
  console.log(`name: ${user.full_name}`);
  console.log(`email: ${user.email}`);
  console.log(`role: ${user.user_role}`);
  console.log(`password: ${password}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create admin account:', err.message || err);
  process.exit(1);
});
