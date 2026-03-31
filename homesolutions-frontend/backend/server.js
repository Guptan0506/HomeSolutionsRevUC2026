const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5001;
const SALT_ROUNDS = 10;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CHAT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CHAT_RATE_LIMIT_MAX_REQUESTS = 12;
const MAX_CHAT_MESSAGE_LENGTH = 1000;

const troubleshootRateLimitStore = new Map();
let geminiModel = null;

const TROUBLESHOOT_SYSTEM_PROMPT = `You are FixMate's home troubleshooting assistant. You are kind, patient, and helpful.

CRITICAL: You must ALWAYS respond with ONLY a valid JSON object, no other text. Nothing before or after the JSON.

Response structure (must be valid JSON):
{
  "troubleshootingSteps": "1. Step one here\\n2. Step two here\\n3. Step three here",
  "complexity": "simple",
  "recommendedServiceType": null,
  "safetyReminder": "Safety message here"
}

For complex problems requiring professional help, set "complexity": "complex" and include the appropriate service type:
- "Electric" for electrical problems
- "Plumbing" for water/pipes  
- "HVAC" for heating/cooling
- "Appliance" for major appliances
- "Carpentry" for wood/structural

RULES:
1. Always return valid JSON, nothing else
2. Simple issues: complexity="simple", recommendedServiceType=null
3. Complex/dangerous issues: complexity="complex", include service type
4. Be kind and reassuring
5. Provide 3-7 numbered steps when possible
6. Always include a safety reminder
7. For dangerous issues, recommend professional help strongly`;

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
        availability TEXT,
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
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_services TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS sp_base_price_per_hr DECIMAL(10, 2)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS specialization VARCHAR(255)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS availability TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS hourly_charge DECIMAL(10, 2)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS services TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS profile_picture_url TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await pool.query(`ALTER TABLE service_provider ALTER COLUMN sp_services DROP NOT NULL`);
    await pool.query(`ALTER TABLE service_provider ALTER COLUMN profile_picture_url DROP NOT NULL`);

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

    // Legacy databases may have FKs targeting old tables; drop blocking constraints for compatibility.
    await pool.query(`ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_user_id_fkey`);
    await pool.query(`ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_sp_id_fkey`);

    await pool.query(`ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_status_check`);
    await pool.query(`ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_urgency_check`);

    await pool.query(`
      ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_status_check
      CHECK (status IN ('pending', 'accepted', 'in_progress', 'rejected', 'completed'))
    `);

    await pool.query(`
      ALTER TABLE service_requests
      ADD CONSTRAINT service_requests_urgency_check
      CHECK (LOWER(urgency) IN ('low', 'medium', 'high', 'urgent', 'important', 'anytime'))
    `);

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

    await pool.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_user_id_fkey`);
    await pool.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_sp_id_fkey`);

    console.log('Invoices table ready.');
  } catch (err) {
    console.error('Failed to initialize invoices table:', err.message || err);
  }
};

initializeAuthTable();
initializeServiceProviderTable();
initializeServiceRequestsTable();
initializeInvoicesTable();

// Auth middleware: requires a user identifier in params, body, or x-user-id header
function requireAuth(req, res, next) {
  const userId =
    req.params?.user_id ||
    req.params?.sp_id ||
    req.body?.user_id ||
    req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  next();
}

function hitChatRateLimit(clientKey) {
  const now = Date.now();
  const existing = troubleshootRateLimitStore.get(clientKey) || [];
  const recent = existing.filter((ts) => now - ts < CHAT_RATE_LIMIT_WINDOW_MS);

  if (recent.length >= CHAT_RATE_LIMIT_MAX_REQUESTS) {
    troubleshootRateLimitStore.set(clientKey, recent);
    return true;
  }

  recent.push(now);
  troubleshootRateLimitStore.set(clientKey, recent);
  return false;
}

function sanitizeConversationHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-8)
    .map((entry) => {
      const role = entry?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof entry?.content === 'string' ? entry.content.trim() : '';
      return { role, content: content.slice(0, 500) };
    })
    .filter((entry) => entry.content.length > 0);
}

function getGeminiModel() {
  if (geminiModel) {
    return geminiModel;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const client = new GoogleGenerativeAI(apiKey);
  geminiModel = client.getGenerativeModel({ model: GEMINI_MODEL });
  return geminiModel;
}

// POST create a user account
app.post('/api/auth/signup', async (req, res) => {
  const client = await pool.connect();

  try {
    const { 
      fullName, 
      email, 
      password, 
      userRole,
      profilePhoto,
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
    const normalizedProfilePhoto =
      typeof profilePhoto === 'string' && profilePhoto.trim()
        ? profilePhoto.trim()
        : (typeof profilePictureUrl === 'string' && profilePictureUrl.trim() ? profilePictureUrl.trim() : null);

    await client.query('BEGIN');

    const existingUser = await client.query('SELECT user_id FROM app_users WHERE email = $1', [normalizedEmail]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Create user  
    const userResult = await client.query(
      `INSERT INTO app_users (full_name, email, password_hash, user_role, profile_photo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, full_name, email, user_role, profile_photo, created_at`,
      [fullName.trim(), normalizedEmail, passwordHash, userRole, normalizedProfilePhoto]
    );

    const user = userResult.rows[0];

    // If service provider, also create profile in service_provider table
    if (userRole === 'service_provider') {
      const parsedHourlyCharge = Number.parseFloat(hourlyCharge);
      const parsedExperienceYears = Number.parseInt(experienceYears, 10) || 0;
      const normalizedServices = services || specialization || '';

      const updateResult = await client.query(
        `UPDATE service_provider
         SET sp_name = $2,
             sp_email = $3,
             specialization = $4,
             hourly_charge = $5,
             experience_years = $6,
             services = $7,
             profile_picture_url = $8,
             sp_services = $9,
             sp_base_price_per_hr = $10
         WHERE user_id = $1`,
        [
          user.user_id,
          fullName.trim(),
          normalizedEmail,
          specialization || '',
          parsedHourlyCharge,
          parsedExperienceYears,
          normalizedServices,
          normalizedProfilePhoto,
          normalizedServices,
          parsedHourlyCharge,
        ]
      );

      if (updateResult.rowCount === 0) {
        await client.query('SAVEPOINT provider_insert_attempt');

        try {
          await client.query(
            `INSERT INTO service_provider (
               user_id, sp_name, sp_email, sp_phone, sp_location,
               specialization, hourly_charge, experience_years, services,
               profile_picture_url, sp_services, sp_base_price_per_hr
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              user.user_id,
              fullName.trim(),
              normalizedEmail,
              '',
              '',
              specialization || '',
              parsedHourlyCharge,
              parsedExperienceYears,
              normalizedServices,
              normalizedProfilePhoto,
              normalizedServices,
              parsedHourlyCharge,
            ]
          );
        } catch (insertErr) {
          if (!String(insertErr.message || '').includes('service_provider_user_id_fkey')) {
            throw insertErr;
          }

          await client.query('ROLLBACK TO SAVEPOINT provider_insert_attempt');

          // Legacy environments may have mismatched FK metadata; fallback to email-linked row.
          await client.query(
            `INSERT INTO service_provider (
               user_id, sp_name, sp_email, sp_phone, sp_location,
               specialization, hourly_charge, experience_years, services,
               profile_picture_url, sp_services, sp_base_price_per_hr
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              null,
              fullName.trim(),
              normalizedEmail,
              '',
              '',
              specialization || '',
              parsedHourlyCharge,
              parsedExperienceYears,
              normalizedServices,
              normalizedProfilePhoto,
              normalizedServices,
              parsedHourlyCharge,
            ]
          );
        }

        await client.query('RELEASE SAVEPOINT provider_insert_attempt');
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Account created successfully.',
      user,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    return res.status(500).json({ message: 'Server Error' });
  } finally {
    client.release();
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

    const accountLookup = await pool.query(
      `SELECT user_role FROM app_users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (accountLookup.rows.length > 0 && accountLookup.rows[0].user_role !== userRole) {
      const existingRole = accountLookup.rows[0].user_role;
      return res.status(401).json({
        message: `This email is registered as ${existingRole === 'service_provider' ? 'Service Provider' : 'Customer'}. Switch account type and try again.`,
      });
    }

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
         sp.availability,
         sp.services,
         sp.experience_years,
         sp.hourly_charge,
         sp.profile_picture_url
       FROM app_users u
       LEFT JOIN service_provider sp
         ON sp.user_id = u.user_id
         OR LOWER(COALESCE(sp.sp_email, '')) = LOWER(u.email)
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
        availability: user.availability || '',
        services: user.services || '',
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
      `SELECT
         sp.*,
         COALESCE(NULLIF(sp.profile_picture_url, ''), au.profile_photo) AS provider_photo
       FROM service_provider sp
       LEFT JOIN app_users au
         ON au.user_id = sp.user_id
         OR LOWER(COALESCE(au.email, '')) = LOWER(COALESCE(sp.sp_email, ''))
       WHERE TRIM(COALESCE(sp.availability, '')) <> ''
       ORDER BY sp.sp_name ASC`
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
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found.' });
    }
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
    const userResult = await pool.query(
      'SELECT email FROM app_users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userEmail = userResult.rows[0].email;

    const result = await pool.query(
      `SELECT *
       FROM service_provider
       WHERE user_id = $1 OR LOWER(COALESCE(sp_email, '')) = LOWER($2)
       ORDER BY sp_id DESC
       LIMIT 1`,
      [user_id, userEmail]
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
    const usersResult = await pool.query(
      'SELECT user_id, full_name, email, user_role, created_at FROM app_users'
    );
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
      availability,
      services,
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

    const normalizedServices = (services || specialization || null);

    if ((user_role || userResult.rows[0].user_role) === 'service_provider') {
      await pool.query(
        `INSERT INTO service_provider (
           user_id, sp_name, sp_email, sp_phone, sp_location,
           specialization, availability, hourly_charge, experience_years, profile_picture_url,
           services, sp_services, sp_base_price_per_hr
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (user_id)
         DO UPDATE SET
           sp_name = EXCLUDED.sp_name,
           sp_email = EXCLUDED.sp_email,
           sp_phone = EXCLUDED.sp_phone,
           sp_location = EXCLUDED.sp_location,
           specialization = EXCLUDED.specialization,
           availability = EXCLUDED.availability,
           hourly_charge = EXCLUDED.hourly_charge,
           experience_years = EXCLUDED.experience_years,
           services = EXCLUDED.services,
           sp_services = EXCLUDED.sp_services,
           sp_base_price_per_hr = EXCLUDED.sp_base_price_per_hr,
           profile_picture_url = EXCLUDED.profile_picture_url`,
        [
          Number(user_id),
          full_name || userResult.rows[0].full_name,
          normalizedEmail || userResult.rows[0].email,
          phone || null,
          location || null,
          specialization || null,
          availability || null,
          Number(base_rate || 0),
          Number(experience_years || 0),
          profile_photo || null,
          normalizedServices,
          normalizedServices,
          Number(base_rate || 0),
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
app.post('/api/requests', requireAuth, async (req, res) => {
  try {
    const { user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude } = req.body;
    const normalizedUrgency = String(urgency || 'low').trim().toLowerCase();

    const safeUrgency = ['low', 'medium', 'high'].includes(normalizedUrgency)
      ? normalizedUrgency
      : 'low';

    if (!user_id || !sp_id || !service_name) {
      return res.status(400).json({ message: 'user_id, sp_id, and service_name are required.' });
    }

    const newRequest = await pool.query(
      `INSERT INTO service_requests 
      (user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') RETURNING *`,
      [user_id, sp_id, service_name, date_required, safeUrgency, description, attachment_url, work_address, work_latitude, work_longitude]
    );
    res.json(newRequest.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET all requests for a specific user
app.get('/api/requests/user/:user_id', requireAuth, async (req, res) => {
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
app.get('/api/requests/provider/:sp_id', requireAuth, async (req, res) => {
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
         au.phone AS customer_phone,
         au.profile_photo AS customer_photo
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
      const requestDateOnly = requestDate.toISOString().slice(0, 10);
      const requestTimeOnly = requestDate.toTimeString().slice(0, 8);
      const completedDateOnly = completedAt.toISOString().slice(0, 10);
      const completedTimeOnly = completedAt.toTimeString().slice(0, 8);

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
          requestDateOnly,
          requestTimeOnly,
          completedDateOnly,
          completedTimeOnly,
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

app.post('/api/chat/troubleshoot', async (req, res) => {
  try {
    const { userMessage, conversationHistory } = req.body || {};
    const trimmedMessage = typeof userMessage === 'string' ? userMessage.trim() : '';

    if (!trimmedMessage) {
      return res.status(400).json({ message: 'Please enter a troubleshooting question.' });
    }

    if (trimmedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({ message: `Message must be under ${MAX_CHAT_MESSAGE_LENGTH} characters.` });
    }

    const clientKey = String(req.ip || 'unknown');
    if (hitChatRateLimit(clientKey)) {
      return res.status(429).json({ message: 'Too many assistant requests. Please wait a minute and try again.' });
    }

    const model = getGeminiModel();

    if (!model) {
      return res.status(503).json({ message: 'Assistant is not configured yet. Please set GEMINI_API_KEY on the backend.' });
    }

    const safeHistory = sanitizeConversationHistory(conversationHistory);
    const historyBlock = safeHistory.length > 0
      ? safeHistory.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n')
      : 'No previous conversation.';

    const fullPrompt = [
      TROUBLESHOOT_SYSTEM_PROMPT,
      `Conversation so far:\n${historyBlock}`,
      `User issue: ${trimmedMessage}`,
      'Respond with actionable help and clear safety boundaries.',
    ].join('\n\n');

    const geminiResult = await Promise.race([
      model.generateContent(fullPrompt),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Assistant request timed out.')), 20000);
      }),
    ]);

    const rawResponse = geminiResult?.response?.text?.().trim();

    if (!rawResponse) {
      return res.status(502).json({ message: 'Assistant could not generate a response. Please try again.' });
    }

    // Parse the JSON response from Gemini
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(rawResponse);
    } catch (parseErr) {
      // Try to extract JSON if Gemini added extra text
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
          console.log('Extracted JSON from Gemini response');
        } catch (innerErr) {
          console.error('Failed to parse extracted JSON:', jsonMatch[0]);
          parsedResponse = {
            troubleshootingSteps: rawResponse,
            complexity: 'complex',
            recommendedServiceType: 'General',
            safetyReminder: 'This issue may require professional help. Please submit a service request.'
          };
        }
      } else {
        console.error('Failed to parse Gemini JSON response:', rawResponse);
        parsedResponse = {
          troubleshootingSteps: rawResponse,
          complexity: 'complex',
          recommendedServiceType: 'General',
          safetyReminder: 'This issue may require professional help. Please submit a service request.'
        };
      }
    }

    return res.json({
      assistantReply: parsedResponse.troubleshootingSteps,
      complexity: parsedResponse.complexity,
      recommendedServiceType: parsedResponse.recommendedServiceType,
      safetyReminder: parsedResponse.safetyReminder
    });
  } catch (err) {
    console.error('Chat troubleshoot error:', err.message || err);

    if (String(err.message || '').includes('no longer available')) {
      return res.status(503).json({
        message: `Configured Gemini model is unavailable. Set GEMINI_MODEL to a current model (current: ${GEMINI_MODEL}).`,
      });
    }

    return res.status(500).json({ message: 'Unable to get troubleshooting help right now.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

