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
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS profile_photo TEXT`);

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
        sp_location VARCHAR(255),
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
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_location VARCHAR(255)`);
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

const initializeServiceRequestsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_requests (
        request_id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        sp_id INTEGER REFERENCES service_provider(sp_id) ON DELETE SET NULL,
        service_name VARCHAR(255) NOT NULL,
        date_required DATE,
        urgency VARCHAR(50) DEFAULT 'Low',
        description TEXT,
        attachment_url TEXT,
        work_address TEXT,
        work_latitude DECIMAL(10, 7),
        work_longitude DECIMAL(10, 7),
        status VARCHAR(50) DEFAULT 'pending',
        estimated_time TEXT,
        materials_needed TEXT,
        eta TEXT,
        materials_used TEXT,
        hours_worked DECIMAL(10, 2) DEFAULT 0,
        extra_materials_cost DECIMAL(10, 2) DEFAULT 0,
        extra_fee DECIMAL(10, 2) DEFAULT 0,
        base_rate_per_hour DECIMAL(10, 2) DEFAULT 0,
        subtotal DECIMAL(12, 2) DEFAULT 0,
        tax DECIMAL(12, 2) DEFAULT 0,
        commission DECIMAL(12, 2) DEFAULT 0,
        total_amount DECIMAL(12, 2) DEFAULT 0,
        payment_method TEXT,
        payment_method_saved BOOLEAN DEFAULT FALSE,
        customer_rating INTEGER,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS estimated_time TEXT`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS materials_needed TEXT`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS eta TEXT`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS materials_used TEXT`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS extra_materials_cost DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS extra_fee DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS base_rate_per_hour DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS tax DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS commission DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS payment_method TEXT`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS payment_method_saved BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS customer_rating INTEGER`);
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);

    console.log('Service requests table ready.');
  } catch (err) {
    console.error('Failed to initialize service requests table:', err.message || err);
  }
};

const initializeInvoicesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        invoice_id SERIAL PRIMARY KEY,
        request_id INTEGER UNIQUE REFERENCES service_requests(request_id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        sp_id INTEGER REFERENCES service_provider(sp_id) ON DELETE SET NULL,
        request_date DATE,
        request_time TIME,
        completion_date DATE,
        completion_time TIME,
        base_rate_per_hour DECIMAL(10, 2) DEFAULT 0,
        hours_worked DECIMAL(10, 2) DEFAULT 0,
        labor_cost DECIMAL(12, 2) DEFAULT 0,
        extra_materials_cost DECIMAL(12, 2) DEFAULT 0,
        extra_fee DECIMAL(12, 2) DEFAULT 0,
        subtotal DECIMAL(12, 2) DEFAULT 0,
        tax DECIMAL(12, 2) DEFAULT 0,
        commission DECIMAL(12, 2) DEFAULT 0,
        total_amount DECIMAL(12, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS request_date DATE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS request_time TIME`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS completion_date DATE`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS completion_time TIME`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS base_rate_per_hour DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS labor_cost DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS extra_materials_cost DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS extra_fee DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS commission DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12, 2) DEFAULT 0`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoices_request_id_unique_idx ON invoices (request_id)`);

    console.log('Invoices table ready.');
  } catch (err) {
    console.error('Failed to initialize invoices table:', err.message || err);
  }
};

initializeAuthTable();
initializeServiceProviderTable();
initializeServiceRequestsTable();
initializeInvoicesTable();

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
          `INSERT INTO service_provider (user_id, sp_name, sp_email, sp_phone, sp_location, specialization, hourly_charge, experience_years, services, profile_picture_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            user.user_id,
            fullName.trim(),
            normalizedEmail,
            '',  // sp_phone
            '',  // sp_location
            specialization || '',
            parseFloat(hourlyCharge),
            Number(experienceYears || 0),
            services || specialization || '',
            profilePictureUrl || null,
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
      `SELECT
         u.user_id,
         u.full_name,
         u.email,
         u.password_hash,
         u.user_role,
         u.phone,
         u.profile_photo,
         sp.sp_id,
         sp.sp_location,
         sp.specialization,
         sp.experience_years,
         sp.hourly_charge,
         sp.profile_picture_url
       FROM app_users u
       LEFT JOIN service_provider sp ON sp.user_id = u.user_id
       WHERE u.email = $1 AND u.user_role = $2`,
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
        phone: user.phone || '',
        profile_photo: user.profile_photo || user.profile_picture_url || '',
        sp_id: user.sp_id || null,
        location: user.sp_location || '',
        specialization: user.specialization || '',
        experience_years: user.experience_years || 0,
        base_rate: user.hourly_charge || 0,
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

// GET service provider profile by app user ID
app.get('/api/providers/by-user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM service_provider WHERE user_id = $1',
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Provider profile not found.' });
    }

    return res.json(result.rows[0]);
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
      'SELECT user_id, full_name, email, user_role, phone, profile_photo, created_at FROM app_users ORDER BY full_name ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PUT profile updates (customer and service provider)
app.put('/api/users/:user_id/profile', async (req, res) => {
  try {
    const { user_id } = req.params;
    const {
      full_name,
      email,
      phone,
      profile_photo,
      user_role,
      location,
      specialization,
      experience_years,
      base_rate,
    } = req.body;

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;

    const userResult = await pool.query(
      `UPDATE app_users
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           profile_photo = COALESCE($4, profile_photo)
       WHERE user_id = $5
       RETURNING user_id, full_name, email, user_role, phone, profile_photo`,
      [full_name || null, normalizedEmail, phone || null, profile_photo || null, user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if ((user_role || userResult.rows[0].user_role) === 'service_provider') {
      await pool.query(
        `INSERT INTO service_provider (user_id, sp_name, sp_email, sp_phone, sp_location, specialization, hourly_charge, experience_years, profile_picture_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id)
         DO UPDATE SET
           sp_name = EXCLUDED.sp_name,
           sp_email = EXCLUDED.sp_email,
           sp_phone = EXCLUDED.sp_phone,
           sp_location = EXCLUDED.sp_location,
           specialization = EXCLUDED.specialization,
           hourly_charge = EXCLUDED.hourly_charge,
           experience_years = EXCLUDED.experience_years,
           profile_picture_url = EXCLUDED.profile_picture_url`,
        [
          Number(user_id),
          full_name || userResult.rows[0].full_name,
          normalizedEmail || userResult.rows[0].email,
          phone || null,
          location || null,
          specialization || null,
          Number(base_rate || 0),
          Number(experience_years || 0),
          profile_photo || null,
        ]
      );
    }

    const mergedUser = userResult.rows[0];
    return res.json({
      message: 'Profile updated successfully.',
      user: {
        ...mergedUser,
        location: location || '',
        specialization: specialization || '',
        experience_years: Number(experience_years || 0),
        base_rate: Number(base_rate || 0),
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});

const toMoney = (value) => Number(Number(value || 0).toFixed(2));

// POST submit a new service request
app.post('/api/requests', async (req, res) => {
  try {
    const { user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude } = req.body;

    if (!user_id || !sp_id || !service_name) {
      return res.status(400).json({ message: 'user_id, sp_id, and service_name are required.' });
    }

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
      `SELECT
         sr.request_id,
         sr.user_id,
         sr.sp_id,
         sr.service_name,
         sr.date_required,
         sr.urgency,
         sr.description,
         sr.work_address,
         sr.status,
         sr.estimated_time,
         sr.materials_needed,
         sr.eta,
         sr.materials_used,
         sr.hours_worked,
         sr.extra_materials_cost,
         sr.extra_fee,
         sr.base_rate_per_hour,
         sr.subtotal,
         sr.tax,
         sr.commission,
         sr.total_amount,
         sr.payment_method,
         sr.payment_method_saved,
         sr.customer_rating,
         sr.submitted_at,
         sr.completed_at,
         sp.sp_name AS provider_name
       FROM service_requests sr
       LEFT JOIN service_provider sp ON sp.sp_id = sr.sp_id
       WHERE sr.user_id = $1
       ORDER BY sr.submitted_at DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PATCH customer-side request updates (payment method, rating)
app.patch('/api/requests/:id/customer', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method, payment_method_saved, customer_rating } = req.body;

    const result = await pool.query(
      `UPDATE service_requests
       SET payment_method = COALESCE($1, payment_method),
           payment_method_saved = COALESCE($2, payment_method_saved),
           customer_rating = COALESCE($3, customer_rating)
       WHERE request_id = $4
       RETURNING *`,
      [payment_method ?? null, payment_method_saved ?? null, customer_rating ?? null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    res.json(result.rows[0]);
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
      `SELECT
         sr.request_id,
         sr.user_id,
         sr.sp_id,
         sr.service_name,
         sr.date_required,
         sr.urgency,
         sr.description,
         sr.work_address,
         sr.status,
         sr.estimated_time,
         sr.materials_needed,
         sr.eta,
         sr.materials_used,
         sr.hours_worked,
         sr.extra_materials_cost,
         sr.extra_fee,
         sr.base_rate_per_hour,
         sr.subtotal,
         sr.tax,
         sr.commission,
         sr.total_amount,
         sr.submitted_at,
         sr.completed_at,
         au.full_name AS customer_name,
         au.email AS customer_email,
         au.phone AS customer_phone
       FROM service_requests sr
       LEFT JOIN app_users au ON au.user_id = sr.user_id
       WHERE sr.sp_id = $1
       ORDER BY sr.submitted_at DESC`,
      [sp_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PATCH provider lifecycle updates: accept/decline/complete
app.patch('/api/requests/:id/provider', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      action,
      estimated_time,
      materials_needed,
      eta,
      materials_used,
      hours_worked,
      extra_materials_cost,
      extra_fee,
      base_rate_per_hour,
    } = req.body;

    const requestLookup = await pool.query(
      'SELECT request_id, user_id, sp_id, submitted_at FROM service_requests WHERE request_id = $1',
      [id]
    );

    if (requestLookup.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found.' });
    }

    if (action === 'accept') {
      const updated = await pool.query(
        `UPDATE service_requests
         SET status = 'in_progress',
             estimated_time = $1,
             materials_needed = $2,
             eta = $3,
             base_rate_per_hour = COALESCE($4, base_rate_per_hour)
         WHERE request_id = $5
         RETURNING *`,
        [estimated_time || null, materials_needed || null, eta || null, toMoney(base_rate_per_hour), id]
      );

      return res.json(updated.rows[0]);
    }

    if (action === 'decline') {
      const updated = await pool.query(
        `UPDATE service_requests
         SET status = 'rejected',
             total_amount = 0,
             subtotal = 0,
             tax = 0,
             commission = 0
         WHERE request_id = $1
         RETURNING *`,
        [id]
      );

      return res.json(updated.rows[0]);
    }

    if (action === 'complete') {
      const baseRate = toMoney(base_rate_per_hour);
      const workedHours = Number(hours_worked || 0);
      const materialCost = toMoney(extra_materials_cost);
      const urgentFee = toMoney(extra_fee);
      const subtotal = toMoney(baseRate * workedHours + materialCost + urgentFee);
      const tax = toMoney(subtotal * 0.07);
      const commission = toMoney(subtotal * 0.05);
      const total = toMoney(subtotal + tax + commission);
      const completedAt = new Date();

      const updated = await pool.query(
        `UPDATE service_requests
         SET status = 'completed',
             materials_used = $1,
             hours_worked = $2,
             extra_materials_cost = $3,
             extra_fee = $4,
             base_rate_per_hour = $5,
             subtotal = $6,
             tax = $7,
             commission = $8,
             total_amount = $9,
             completed_at = $10
         WHERE request_id = $11
         RETURNING *`,
        [materials_used || null, workedHours, materialCost, urgentFee, baseRate, subtotal, tax, commission, total, completedAt, id]
      );

      const source = requestLookup.rows[0];
      const requestDate = source.submitted_at ? new Date(source.submitted_at) : new Date();

      await pool.query(
        `INSERT INTO invoices (
           request_id, user_id, sp_id, request_date, request_time, completion_date, completion_time,
           base_rate_per_hour, hours_worked, labor_cost, extra_materials_cost, extra_fee,
           subtotal, tax, commission, total_amount
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (request_id)
         DO UPDATE SET
           completion_date = EXCLUDED.completion_date,
           completion_time = EXCLUDED.completion_time,
           base_rate_per_hour = EXCLUDED.base_rate_per_hour,
           hours_worked = EXCLUDED.hours_worked,
           labor_cost = EXCLUDED.labor_cost,
           extra_materials_cost = EXCLUDED.extra_materials_cost,
           extra_fee = EXCLUDED.extra_fee,
           subtotal = EXCLUDED.subtotal,
           tax = EXCLUDED.tax,
           commission = EXCLUDED.commission,
           total_amount = EXCLUDED.total_amount`,
        [
          Number(id),
          source.user_id,
          source.sp_id,
          requestDate,
          requestDate,
          completedAt,
          completedAt,
          baseRate,
          workedHours,
          toMoney(baseRate * workedHours),
          materialCost,
          urgentFee,
          subtotal,
          tax,
          commission,
          total,
        ]
      );

      return res.json(updated.rows[0]);
    }

    return res.status(400).json({ message: 'Invalid action. Use accept, decline, or complete.' });
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
      `SELECT
         i.*, sr.service_name, sr.description, sr.work_address,
         au.full_name AS customer_name, sp.sp_name AS provider_name
       FROM invoices i
       LEFT JOIN service_requests sr ON sr.request_id = i.request_id
       LEFT JOIN app_users au ON au.user_id = sr.user_id
       LEFT JOIN service_provider sp ON sp.sp_id = sr.sp_id
       WHERE i.request_id = $1`,
      [request_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

