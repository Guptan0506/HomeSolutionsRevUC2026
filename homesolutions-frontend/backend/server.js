const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const SALT_ROUNDS = 10;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Connected to HomeServices database!');
  }
});

const initializeAuthTable = async () => {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_users (
        user_id SERIAL PRIMARY KEY,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );
    console.log('Auth table ready (app_users).');
  } catch (err) {
    console.error('Failed to initialize auth table:', err.message);
  }
};

initializeAuthTable();

// POST create a user account
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'fullName, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await pool.query('SELECT user_id FROM app_users WHERE email = $1', [normalizedEmail]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO app_users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id, full_name, email, created_at`,
      [fullName.trim(), normalizedEmail, passwordHash]
    );

    return res.status(201).json({
      message: 'Account created successfully.',
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ message: 'Server Error' });
  }
});

// POST login with email/password
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await pool.query(
      'SELECT user_id, full_name, email, password_hash FROM app_users WHERE email = $1',
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    return res.json({
      message: 'Login successful.',
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ message: 'Server Error' });
  }
});

// GET all service providers
app.get('/api/providers', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM service_provider ORDER BY sp_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET single service provider by ID
app.get('/api/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM service_provider WHERE sp_id = $1', [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM users ORDER BY user_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST submit a new service request
app.post('/api/requests', async (req, res) => {
  try {
    const { user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude } = req.body;
    const newRequest = await pool.query(
      `INSERT INTO service_requests 
      (user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING *`,
      [user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude]
    );
    res.json(newRequest.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET all requests for a specific user
app.get('/api/requests/user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM service_requests WHERE user_id = $1 ORDER BY submitted_at DESC', [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET all requests for a specific service provider
app.get('/api/requests/provider/:sp_id', async (req, res) => {
  try {
    const { sp_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM service_requests WHERE sp_id = $1 ORDER BY submitted_at DESC', [sp_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST provider accepts or rejects a request
app.post('/api/requests/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { sp_id, decision, estimated_time, materials_needed, materials_notes } = req.body;
    
    // Save the response
    const response = await pool.query(
      `INSERT INTO request_response 
      (request_id, sp_id, decision, estimated_time, materials_needed, materials_notes) 
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, sp_id, decision, estimated_time, materials_needed, materials_notes]
    );

    // Update status on the request
    await pool.query(
      'UPDATE service_requests SET status = $1 WHERE request_id = $2',
      [decision, id]
    );

    res.json(response.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST send a message
app.post('/api/messages', async (req, res) => {
  try {
    const { request_id, sender_id, sender_type, message_text } = req.body;
    const message = await pool.query(
      `INSERT INTO messages (request_id, sender_id, sender_type, message_text) 
      VALUES ($1, $2, $3, $4) RETURNING *`,
      [request_id, sender_id, sender_type, message_text]
    );
    res.json(message.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET all messages for a request
app.get('/api/messages/:request_id', async (req, res) => {
  try {
    const { request_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM messages WHERE request_id = $1 ORDER BY sent_at ASC', [request_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST generate invoice
app.post('/api/invoices', async (req, res) => {
  try {
    const { request_id, user_id, sp_id, service_name, description, base_amount, urgency_charge, extra_charges, service_tax } = req.body;
    const total = parseFloat(base_amount) + parseFloat(urgency_charge) + parseFloat(extra_charges) + parseFloat(service_tax);
    const commission = total * 0.15;

    const invoice = await pool.query(
      `INSERT INTO invoices 
      (request_id, user_id, sp_id, service_name, description, base_amount, urgency_charge, extra_charges, service_tax, commission, total_amount) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [request_id, user_id, sp_id, service_name, description, base_amount, urgency_charge, extra_charges, service_tax, commission, total]
    );

    // Mark request as completed
    await pool.query(
      'UPDATE service_requests SET status = $1 WHERE request_id = $2',
      ['completed', request_id]
    );

    res.json(invoice.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET invoice by request ID
app.get('/api/invoices/:request_id', async (req, res) => {
  try {
    const { request_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM invoices WHERE request_id = $1', [request_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

