const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5001;
const SALT_ROUNDS = 10;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
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

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.message || err);
  } else {
    console.log('Connected to HomeServices database!');
  }
});

const initializeAuthTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        user_id SERIAL PRIMARY KEY,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        user_role VARCHAR(50) DEFAULT 'customer' NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Backfill any missing columns if the table already existed from an older schema.
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120)`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS user_role VARCHAR(50) DEFAULT 'customer' NOT NULL`);

    // Ensure required columns are not nullable for auth flows.
    await pool.query(`ALTER TABLE app_users ALTER COLUMN full_name SET NOT NULL`);
    await pool.query(`ALTER TABLE app_users ALTER COLUMN email SET NOT NULL`);
    await pool.query(`ALTER TABLE app_users ALTER COLUMN password_hash SET NOT NULL`);
    await pool.query(`ALTER TABLE app_users ALTER COLUMN user_role SET NOT NULL`);

    // Protect against duplicate emails.
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique_idx ON app_users (email)`);

    console.log('Auth table ready (app_users).');
  } catch (err) {
    console.error('Failed to initialize auth table:', err.message || err);
  }
};

const initializeServiceProviderTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_provider (
        sp_id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES app_users(user_id) ON DELETE CASCADE,
        sp_name VARCHAR(120) NOT NULL,
        sp_email VARCHAR(255),
        sp_phone VARCHAR(20),
        specialization VARCHAR(255),
        hourly_charge DECIMAL(10, 2),
        experience_years INTEGER DEFAULT 0,
        services TEXT,
        profile_picture_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Backfill any missing columns if the table already existed
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS user_id INTEGER UNIQUE REFERENCES app_users(user_id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_name VARCHAR(120)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_phone VARCHAR(20)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS specialization VARCHAR(255)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS hourly_charge DECIMAL(10, 2)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS services TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS profile_picture_url TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

    console.log('Service Provider table ready.');
  } catch (err) {
    console.error('Failed to initialize service provider table:', err.message || err);
  }
};

initializeAuthTable();
initializeServiceProviderTable();

// POST create a user account
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { 
      fullName, 
      email, 
      password, 
      userRole,
      // Service provider fields
      specialization,
      hourlyCharge,
      experienceYears,
      services,
      profilePictureUrl
    } = req.body;

    if (!fullName || !email || !password || !userRole) {
      return res.status(400).json({ message: 'fullName, email, password, and userRole are required.' });
    }

    const validRoles = ['customer', 'service_provider'];
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ message: 'userRole must be "customer" or "service_provider".' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    // For service providers, require profile information
    if (userRole === 'service_provider') {
      if (!specialization || !hourlyCharge) {
        return res.status(400).json({ message: 'Service providers must provide specialization and base charge.' });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await pool.query('SELECT user_id FROM app_users WHERE email = $1', [normalizedEmail]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Create user  
    const userResult = await pool.query(
      `INSERT INTO app_users (full_name, email, password_hash, user_role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, full_name, email, user_role, created_at`,
      [fullName.trim(), normalizedEmail, passwordHash, userRole]
    );

    const user = userResult.rows[0];

    // If service provider, also create profile in service_provider table
    if (userRole === 'service_provider') {
      try {
        await pool.query(
          `INSERT INTO service_provider (sp_name, sp_email, sp_phone, sp_location, sp_services, sp_base_price_per_hr)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            fullName.trim(),
            normalizedEmail,
            '',  // sp_phone
            '',  // sp_location
            services || specialization || '',  // sp_services
            parseFloat(hourlyCharge)  // sp_base_price_per_hr
          ]
        );
      } catch (spErr) {
        console.error('Error creating service provider profile:', spErr.message);
        // Profile creation failure doesn't prevent user creation
      }
    }

    return res.status(201).json({
      message: 'Account created successfully.',
      user,
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ message: 'Server Error' });
  }
});

// POST login with email/password
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, userRole } = req.body;

    if (!email || !password || !userRole) {
      return res.status(400).json({ message: 'email, password, and userRole are required.' });
    }

    const validRoles = ['customer', 'service_provider'];
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ message: 'userRole must be "customer" or "service_provider".' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await pool.query(
      'SELECT user_id, full_name, email, password_hash, user_role FROM app_users WHERE email = $1 AND user_role = $2',
      [normalizedEmail, userRole]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email, password, or account type.' });
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
        user_role: user.user_role,
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

// Test endpoint: Check database contents
app.get('/api/test-db', async (req, res) => {
  try {
    const usersResult = await pool.query('SELECT * FROM app_users');
    const providersResult = await pool.query('SELECT * FROM service_provider');
    
    res.json({
      app_users_count: usersResult.rows.length,
      users: usersResult.rows,
      service_provider_count: providersResult.rows.length,
      providers: providersResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

