const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  notifyRequestAccepted,
  notifyRequestAcceptedToCustomer,
  notifyRequestDeclined,
  notifyServiceCompleted,
  notifyNewMessage,
} = require('./notificationService');
const {
  generateToken,
  verifyToken,
  sanitizeInput,
  extractTokenFromHeader,
  isValidEmail,
} = require('./securityUtils');
const { createRateLimiter } = require('./rateLimiter');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;

const app = express();
const PORT = process.env.PORT || 5001;
const SALT_ROUNDS = 10;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CHAT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CHAT_RATE_LIMIT_MAX_REQUESTS = 12;
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const REQUEST_ID_HEADER = 'x-request-id';

const ensureStripeConfigured = (res) => {
  if (!stripe) {
    res.status(503).json({ message: 'Payments are not configured. Set STRIPE_SECRET_KEY on backend.' });
    return false;
  }

  return true;
};

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

// Security Middleware
app.use(helmet()); // Add security headers

// CORS Configuration
const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (configuredCorsOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
};
app.use(cors(corsOptions));

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl === '/api/webhooks/stripe') {
      req.rawBody = buf;
    }
  },
})); // Limit JSON payload size

app.use((req, res, next) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId = typeof incoming === 'string' && incoming.trim()
    ? incoming.trim()
    : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startMs = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startMs;
    console.log(JSON.stringify({
      level: 'info',
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    }));
  });

  next();
});

// Rate Limiters for critical endpoints
const authRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5, // 5 requests per window
  keyPrefix: 'auth_',
});

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
pool.connect()
  .then((client) => {
    console.log('Connected to HomeServices database!');
    client.release();
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message || err);
  });

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', db: 'ok', uptimeSec: process.uptime() });
  } catch (err) {
    return res.status(503).json({ status: 'degraded', db: 'down', error: err.message || String(err) });
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
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS location VARCHAR(255)`);
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
    throw err;
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
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS acceptance_rate DECIMAL(5, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS suspension_reason TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS warning_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) DEFAULT 'unverified'`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS verification_notes TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMP`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS verified_by_admin_id INTEGER`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS trust_score DECIMAL(5, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS badge_level VARCHAR(30) DEFAULT 'new'`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS id_document_url TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS license_document_url TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS insurance_document_url TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS background_check_status VARCHAR(30) DEFAULT 'not_submitted'`);
    
    // Location columns for geolocation features
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8)`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS address_full TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS service_provider_location_idx ON service_provider (latitude, longitude)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS service_provider_verification_status_idx ON service_provider (verification_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS service_provider_trust_score_idx ON service_provider (trust_score)`);
    
    await pool.query(`ALTER TABLE service_provider ALTER COLUMN sp_services DROP NOT NULL`);
    await pool.query(`ALTER TABLE service_provider ALTER COLUMN profile_picture_url DROP NOT NULL`);

    console.log('Service Provider table ready.');
  } catch (err) {
    console.error('Failed to initialize service provider table:', err.message || err);
    throw err;
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
    await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS all_provider_ids TEXT`);

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
    throw err;
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
        payment_status TEXT DEFAULT 'pending',
        stripe_payment_intent_id TEXT,
        stripe_charge_id TEXT,
        paid_at TIMESTAMP,
        payout_status TEXT DEFAULT 'pending',
        payout_date TIMESTAMP,
        provider_payout_amount DECIMAL(12, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add payment-related columns if they don't exist
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payout_status TEXT DEFAULT 'pending'`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payout_date TIMESTAMP`);
    await pool.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider_payout_amount DECIMAL(12, 2) DEFAULT 0`);
    
    // Existing columns
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
    
    // Create indexes for payment tracking
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_payment_status_idx ON invoices (payment_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_stripe_payment_intent_idx ON invoices (stripe_payment_intent_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS invoices_payout_status_idx ON invoices (payout_status)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS invoices_request_id_unique_idx ON invoices (request_id)`);

    await pool.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_user_id_fkey`);
    await pool.query(`ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_sp_id_fkey`);

    console.log('Invoices table ready with payment tracking.');
  } catch (err) {
    console.error('Failed to initialize invoices table:', err.message || err);
    throw err;
  }
};

const initializeMessagesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES service_requests(request_id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        sender_role VARCHAR(50),
        recipient_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        message_text TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES service_requests(request_id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_role VARCHAR(50)`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await pool.query(`CREATE INDEX IF NOT EXISTS messages_request_id_idx ON messages (request_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON messages (sender_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS messages_recipient_id_idx ON messages (recipient_id)`);

    console.log('Messages table ready.');
  } catch (err) {
    console.error('Failed to initialize messages table:', err.message || err);
    throw err;
  }
};

// Phase 6: Moderation Tables
const initializeModerationTables = async () => {
  try {
    // Add moderation columns to app_users
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspension_reason TEXT`);
    await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS warning_count INTEGER DEFAULT 0`);

    // Add moderation columns to service_provider
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS suspension_reason TEXT`);
    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS warning_count INTEGER DEFAULT 0`);

    // Create moderation logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moderation_logs (
        log_id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        target_user_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        target_provider_id INTEGER REFERENCES service_provider(sp_id) ON DELETE SET NULL,
        action_type VARCHAR(50) NOT NULL,
        reason TEXT,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS moderation_logs_admin_id_idx ON moderation_logs (admin_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS moderation_logs_target_user_id_idx ON moderation_logs (target_user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS moderation_logs_target_provider_id_idx ON moderation_logs (target_provider_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS moderation_logs_created_at_idx ON moderation_logs (created_at)`);

    console.log('Moderation tables ready.');
  } catch (err) {
    console.error('Failed to initialize moderation tables:', err.message || err);
    throw err;
  }
};

initializeModerationTables();

const initializeOperationsTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type VARCHAR(120) NOT NULL,
        processed BOOLEAN DEFAULT FALSE,
        processed_at TIMESTAMP,
        payload JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payout_attempts (
        attempt_id SERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(invoice_id) ON DELETE CASCADE,
        sp_id INTEGER REFERENCES service_provider(sp_id) ON DELETE SET NULL,
        amount DECIMAL(12, 2) NOT NULL,
        stripe_transfer_id TEXT,
        status VARCHAR(30) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_events (
        notification_id SERIAL PRIMARY KEY,
        event_type VARCHAR(120) NOT NULL,
        recipient_user_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        recipient_email TEXT,
        status VARCHAR(20) DEFAULT 'queued',
        provider VARCHAR(20) DEFAULT 'email',
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS verification_audit_logs (
        audit_id SERIAL PRIMARY KEY,
        sp_id INTEGER REFERENCES service_provider(sp_id) ON DELETE CASCADE,
        actor_user_id INTEGER REFERENCES app_users(user_id) ON DELETE SET NULL,
        action_type VARCHAR(50) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE service_provider ADD COLUMN IF NOT EXISTS connected_account_id TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS webhook_events_processed_idx ON webhook_events (processed)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS payout_attempts_invoice_idx ON payout_attempts (invoice_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS notification_events_created_idx ON notification_events (created_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS verification_audit_logs_sp_idx ON verification_audit_logs (sp_id)`);

    console.log('Operations tables ready.');
  } catch (err) {
    console.error('Failed to initialize operations tables:', err.message || err);
  }
};

initializeOperationsTables();

const logNotificationEvent = async ({ eventType, recipientUserId, recipientEmail, status = 'queued', provider = 'email', metadata = {} }) => {
  try {
    await pool.query(
      `INSERT INTO notification_events (event_type, recipient_user_id, recipient_email, status, provider, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventType, recipientUserId || null, recipientEmail || null, status, provider, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.error('Notification log error:', err.message || err);
  }
};

const calculateBadgeLevel = (trustScore, verificationStatus) => {
  if (verificationStatus !== 'verified') {
    return 'new';
  }

  const score = Number(trustScore || 0);
  if (score >= 90) {
    return 'elite';
  }
  if (score >= 75) {
    return 'verified_pro';
  }
  return 'verified';
};

const recalculateProviderTrustScore = async (providerId) => {
  const metricsResult = await pool.query(
    `SELECT
       sp.verification_status,
       sp.background_check_status,
       COALESCE(AVG(CASE WHEN sr.customer_rating > 0 THEN sr.customer_rating END), 0) as avg_rating,
       COUNT(CASE WHEN sr.status = 'completed' THEN 1 END) as completed_count
     FROM service_provider sp
     LEFT JOIN service_requests sr ON sr.sp_id = sp.sp_id
     WHERE sp.sp_id = $1
     GROUP BY sp.sp_id`,
    [providerId]
  );

  if (metricsResult.rows.length === 0) {
    return null;
  }

  const row = metricsResult.rows[0];
  const avgRating = Number(row.avg_rating || 0);
  const completedCount = Number(row.completed_count || 0);

  const ratingScore = Math.min(50, avgRating * 10);
  const completionScore = Math.min(20, completedCount);
  const verificationScore = row.verification_status === 'verified' ? 20 : 0;
  const backgroundScore = row.background_check_status === 'approved' ? 10 : 0;

  const trustScore = Number((ratingScore + completionScore + verificationScore + backgroundScore).toFixed(2));
  const badgeLevel = calculateBadgeLevel(trustScore, row.verification_status);

  await pool.query(
    `UPDATE service_provider
     SET trust_score = $1,
         badge_level = $2
     WHERE sp_id = $3`,
    [trustScore, badgeLevel, providerId]
  );

  return { trustScore, badgeLevel };
};

async function resolveServiceRequestUserColumn() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'service_requests'
       AND column_name IN ('user_id', 'customer_id')`
  );

  const names = new Set(result.rows.map((row) => row.column_name));

  if (names.has('user_id')) {
    return 'user_id';
  }

  if (names.has('customer_id')) {
    return 'customer_id';
  }

  return null;
}

// Auth middleware: requires a user identifier in params, body, or x-user-id header
function requireAuth(req, res, next) {
  // Accept token from:
  // 1. Authorization header: "Bearer <token>"
  // 2. x-auth-token header
  // 3. Query parameter (for GET requests only - not recommended)
  
  let token = extractTokenFromHeader(req.headers.authorization);
  token = token || req.headers['x-auth-token'];
  token = token || (req.method === 'GET' ? req.query.token : null);

  if (!token) {
    return res.status(401).json({ message: 'Authentication token required. Use Authorization: Bearer <token> header.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ message: 'Invalid or expired authentication token.' });
  }

  // Attach decoded token info to request for use in route handlers
  req.user = decoded;
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
app.post('/api/auth/signup', authRateLimiter.middleware(), async (req, res) => {
  const client = await pool.connect();

  try {
    const { 
      fullName, 
      email, 
      password, 
      userRole,
      location,
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

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email address.' });
    }

    const validRoles = ['customer', 'service_provider', 'admin'];
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ message: 'userRole must be "customer", "service_provider", or "admin".' });
    }

    // For service providers, require profile information
    if (userRole === 'service_provider') {
      if (!specialization || !hourlyCharge) {
        return res.status(400).json({ message: 'Service providers must provide specialization and base charge.' });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedLocation = typeof location === 'string' ? location.trim() : '';
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
      `INSERT INTO app_users (full_name, email, password_hash, user_role, location, profile_photo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id, full_name, email, user_role, location, profile_photo, created_at`,
      [fullName.trim(), normalizedEmail, passwordHash, userRole, normalizedLocation || null, normalizedProfilePhoto]
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
             sp_location = $5,
             hourly_charge = $6,
             experience_years = $7,
             services = $8,
             profile_picture_url = $9,
             sp_services = $10,
             sp_base_price_per_hr = $11
         WHERE user_id = $1`,
        [
          user.user_id,
          fullName.trim(),
          normalizedEmail,
          specialization || '',
          normalizedLocation || '',
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
              normalizedLocation || '',
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
              normalizedLocation || '',
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

    // Generate JWT token for newly created user
    const { token, expiresAt, expiresInSeconds } = generateToken(user.user_id, user.email, user.user_role);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      expiresAt,
      expiresInSeconds,
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
// POST login endpoint with JWT token generation
app.post('/api/auth/login', authRateLimiter.middleware(), async (req, res) => {
  try {
    const { email, password, userRole } = req.body;

    if (!email || !password || !userRole) {
      return res.status(400).json({ message: 'email, password, and userRole are required.' });
    }

    const validRoles = ['customer', 'service_provider', 'admin'];
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ message: 'userRole must be "customer", "service_provider", or "admin".' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const accountLookup = await pool.query(
      `SELECT user_role FROM app_users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (accountLookup.rows.length > 0 && accountLookup.rows[0].user_role !== userRole) {
      const existingRole = accountLookup.rows[0].user_role;
      const formattedRole = existingRole === 'service_provider'
        ? 'Service Provider'
        : existingRole === 'admin'
          ? 'Admin'
          : 'Customer';

      return res.status(401).json({
        message: `This email is registered as ${formattedRole}. Switch account type and try again.`,
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
         u.location AS user_location,
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

    // Generate JWT token
    const { token, expiresAt, expiresInSeconds } = generateToken(user.user_id, user.email, user.user_role);

    return res.json({
      message: 'Login successful.',
      token,
      expiresAt,
      expiresInSeconds,
      user: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        user_role: user.user_role,
        phone: user.phone || '',
        profile_photo: user.profile_photo || user.profile_picture_url || '',
        sp_id: user.sp_id || null,
        location: user.user_role === 'service_provider' ? (user.sp_location || '') : (user.user_location || ''),
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
    const normalizedLocation = typeof req.query.location === 'string' ? req.query.location.trim() : '';
    const normalizedServiceType = typeof req.query.serviceType === 'string' ? req.query.serviceType.trim() : '';
    const params = [];
    const filters = [];

    if (normalizedLocation) {
      params.push(`%${normalizedLocation.toLowerCase()}%`);
      filters.push(`LOWER(COALESCE(sp.sp_location, '')) LIKE $${params.length}`);
    }

    const serviceSearchTerms = getServiceSearchTerms(normalizedServiceType);
    if (serviceSearchTerms.length > 0) {
      const serviceConditions = serviceSearchTerms
        .map((term, index) => {
          const paramIndex = params.length + index + 1;
          return `(
            LOWER(COALESCE(sp.specialization, '')) LIKE LOWER($${paramIndex}) OR
            LOWER(COALESCE(sp.services, '')) LIKE LOWER($${paramIndex}) OR
            LOWER(COALESCE(sp.sp_services, '')) LIKE LOWER($${paramIndex})
          )`;
        })
        .join(' OR ');

      filters.push(`(${serviceConditions})`);
      params.push(...serviceSearchTerms.map((term) => `%${term}%`));
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         sp.*,
         COALESCE(NULLIF(sp.profile_picture_url, ''), au.profile_photo) AS provider_photo,
         COALESCE(
           ROUND(AVG(CASE WHEN sr.customer_rating > 0 THEN sr.customer_rating END)::numeric, 1),
           0
         ) AS average_rating,
         COALESCE(
           ROUND((CAST(COUNT(CASE WHEN sr.status IN ('accepted', 'in_progress', 'completed') THEN 1 END) AS NUMERIC) / 
           NULLIF(COUNT(CASE WHEN sr.status != 'pending' THEN 1 END), 0) * 100)::numeric, 0),
           0
         ) AS acceptance_rate
       FROM service_provider sp
       LEFT JOIN app_users au
         ON au.user_id = sp.user_id
         OR LOWER(COALESCE(au.email, '')) = LOWER(COALESCE(sp.sp_email, ''))
       LEFT JOIN service_requests sr ON sr.sp_id = sp.sp_id
       ${whereClause}
       GROUP BY sp.sp_id, au.user_id, au.profile_photo, sp.profile_picture_url
       ORDER BY sp.sp_name ASC`,
      params
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

// ==================== LOCATION-BASED DISCOVERY ENDPOINTS ====================

const SERVICE_ALIASES = {
  painting: ['painting', 'painter', 'paint'],
  plumbing: ['plumbing', 'plumber'],
  electrical: ['electrical', 'electric', 'electrician'],
  electric: ['electrical', 'electric', 'electrician'],
  landscaping: ['landscaping', 'landscape', 'gardening', 'gardener'],
  cleaning: ['cleaning', 'cleaner'],
  carpentry: ['carpentry', 'carpenter', 'woodwork'],
  roofing: ['roofing', 'roofer'],
  flooring: ['flooring', 'floor installer'],
  hvac: ['hvac', 'heating', 'cooling', 'ac'],
};

function normalizeServiceText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getServiceSearchTerms(serviceLabel) {
  const normalized = normalizeServiceText(serviceLabel);

  if (!normalized) {
    return [];
  }

  const aliases = SERVICE_ALIASES[normalized] || [];
  return Array.from(new Set([normalized, ...aliases.map(normalizeServiceText)]));
}

// Search providers near a location with distance calculation
app.get('/api/providers/search/near', async (req, res) => {
  try {
    const { latitude, longitude, distance = 50, serviceType } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'latitude and longitude required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const maxDistance = parseFloat(distance) || 50; // Default 50 miles

    // Haversine distance formula in SQL (results in miles)
    let query = `
      SELECT *
      FROM (
        SELECT 
          sp.*,
          ROUND(
            ( 3959 * acos( 
              cos( radians($1) ) * cos( radians( latitude ) ) * 
              cos( radians( longitude ) - radians($2) ) + 
              sin( radians($1) ) * sin( radians( latitude ) ) 
            ) )::NUMERIC,
            2
          ) AS distance_miles,
          (
            (100 - LEAST(100, (3959 * acos( 
              cos( radians($1) ) * cos( radians( latitude ) ) * 
              cos( radians( longitude ) - radians($2) ) + 
              sin( radians($1) ) * sin( radians( latitude ) )
            )) * 2)) * 0.40 +
            COALESCE(sp.trust_score, 0) * 0.30 +
            COALESCE(sp.average_rating, 0) * 10 * 0.20 +
            COALESCE(sp.acceptance_rate, 0) * 0.10
          ) AS discovery_score
        FROM service_provider sp
        WHERE sp.latitude IS NOT NULL
          AND sp.longitude IS NOT NULL
          AND sp.is_suspended = FALSE
      ) ranked
      WHERE ranked.distance_miles < $3
    `;

    const params = [lat, lng, maxDistance];

    // Filter by service type if provided
    const serviceSearchTerms = getServiceSearchTerms(serviceType);
    if (serviceSearchTerms.length > 0) {
      const serviceConditions = serviceSearchTerms
        .map((term, index) => {
          const paramIndex = params.length + index + 1;
          return `(
            LOWER(COALESCE(ranked.specialization, '')) LIKE LOWER($${paramIndex}) OR
            LOWER(COALESCE(ranked.services, '')) LIKE LOWER($${paramIndex}) OR
            LOWER(COALESCE(ranked.sp_services, '')) LIKE LOWER($${paramIndex})
          )`;
        })
        .join(' OR ');

      query += ` AND (${serviceConditions})`;
      params.push(...serviceSearchTerms.map((term) => `%${term}%`));
    }

    query += `
      ORDER BY ranked.discovery_score DESC, ranked.distance_miles ASC
      LIMIT 100
    `;

    const result = await pool.query(query, params);
    res.json({
      count: result.rows.length,
      providers: result.rows,
      searchLocation: { latitude: lat, longitude: lng, radiusMiles: maxDistance },
    });
  } catch (err) {
    console.error('Location search error:', err);
    res.status(500).json({ message: 'Failed to search providers by location' });
  }
});

// Update provider location (latitude/longitude)
app.put('/api/providers/:spId/location', requireAuth, async (req, res) => {
  try {
    const { spId } = req.params;
    const { latitude, longitude, address_full } = req.body;
    const userId = req.user.user_id;

    // Verify provider owns this account
    const providerResult = await pool.query(
      'SELECT user_id FROM service_provider WHERE sp_id = $1',
      [spId]
    );

    if (providerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    if (Number(providerResult.rows[0].user_id) !== Number(userId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Validate coordinates
    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'Invalid coordinates' });
      }

      const result = await pool.query(
        `UPDATE service_provider 
         SET latitude = $1, longitude = $2, address_full = $3 
         WHERE sp_id = $4 
         RETURNING *`,
        [lat, lng, address_full || null, spId]
      );

      res.json({
        message: 'Location updated successfully',
        provider: result.rows[0],
      });
    } else {
      res.status(400).json({ message: 'latitude and longitude required' });
    }
  } catch (err) {
    console.error('Update location error:', err);
    res.status(500).json({ message: 'Failed to update provider location' });
  }
});

// Get provider location for map display
app.get('/api/providers/:spId/location', async (req, res) => {
  try {
    const { spId } = req.params;

    const result = await pool.query(
      `SELECT sp_id, sp_name, sp_phone, latitude, longitude, address_full, 
              hourly_charge, specialization, average_rating
       FROM service_provider 
       WHERE sp_id = $1 AND is_suspended = FALSE`,
      [spId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    const provider = result.rows[0];

    if (!provider.latitude || !provider.longitude) {
      return res.status(404).json({ 
        message: 'Provider location not yet set',
        provider: provider,
      });
    }

    res.json({
      provider: provider,
      coordinates: {
        latitude: provider.latitude,
        longitude: provider.longitude,
      },
    });
  } catch (err) {
    console.error('Get location error:', err);
    res.status(500).json({ message: 'Failed to get provider location' });
  }
});

app.post('/api/providers/:spId/verification/submit', requireAuth, async (req, res) => {
  try {
    const { spId } = req.params;
    const {
      id_document_url,
      license_document_url,
      insurance_document_url,
      background_check_status,
      verification_notes,
    } = req.body || {};

    const providerResult = await pool.query(
      'SELECT sp_id, user_id FROM service_provider WHERE sp_id = $1',
      [spId]
    );

    if (providerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    if (Number(providerResult.rows[0].user_id) !== Number(req.user.user_id)) {
      return res.status(403).json({ message: 'You can only submit verification for your own profile' });
    }

    const result = await pool.query(
      `UPDATE service_provider
       SET id_document_url = COALESCE($1, id_document_url),
           license_document_url = COALESCE($2, license_document_url),
           insurance_document_url = COALESCE($3, insurance_document_url),
           background_check_status = COALESCE($4, background_check_status),
           verification_notes = COALESCE($5, verification_notes),
           verification_status = 'pending',
           verification_submitted_at = CURRENT_TIMESTAMP
       WHERE sp_id = $6
       RETURNING sp_id, verification_status, verification_submitted_at, background_check_status`,
      [
        id_document_url || null,
        license_document_url || null,
        insurance_document_url || null,
        background_check_status || 'submitted',
        verification_notes || null,
        spId,
      ]
    );

    await recalculateProviderTrustScore(Number(spId));

    return res.json({
      message: 'Verification submitted successfully and is pending admin review.',
      verification: result.rows[0],
    });
  } catch (err) {
    console.error('Submit verification error:', err);
    return res.status(500).json({ message: 'Failed to submit verification' });
  }
});

app.get('/api/providers/:spId/trust', async (req, res) => {
  try {
    const { spId } = req.params;
    const result = await pool.query(
      `SELECT
         sp.sp_id,
         sp.sp_name,
         sp.verification_status,
         sp.verified_at,
         sp.trust_score,
         sp.badge_level,
         sp.background_check_status,
         COALESCE(AVG(CASE WHEN sr.customer_rating > 0 THEN sr.customer_rating END), 0) AS average_rating,
         COUNT(CASE WHEN sr.status = 'completed' THEN 1 END) AS completed_jobs
       FROM service_provider sp
       LEFT JOIN service_requests sr ON sr.sp_id = sp.sp_id
       WHERE sp.sp_id = $1
       GROUP BY sp.sp_id`,
      [spId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Provider trust error:', err);
    return res.status(500).json({ message: 'Failed to fetch trust details' });
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
      location,
      profile_photo,
      user_role,
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
           location = COALESCE($4, location),
           profile_photo = COALESCE($5, profile_photo)
         WHERE user_id = $6
         RETURNING user_id, full_name, email, user_role, phone, location, profile_photo`,
        [full_name || null, normalizedEmail, phone || null, location || null, profile_photo || null, user_id]
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

// POST submit a service request to multiple providers (up to 3)
app.post('/api/requests-multi', requireAuth, async (req, res) => {
  try {
    const { user_id, sp_ids, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude } = req.body;
    const normalizedUrgency = String(urgency || 'low').trim().toLowerCase();

    const safeUrgency = ['low', 'medium', 'high'].includes(normalizedUrgency)
      ? normalizedUrgency
      : 'low';

    if (!user_id || !sp_ids || !Array.isArray(sp_ids) || sp_ids.length === 0) {
      return res.status(400).json({ message: 'user_id and sp_ids array (at least 1 provider) are required.' });
    }

    if (sp_ids.length > 3) {
      return res.status(400).json({ message: 'Maximum 3 providers allowed per request.' });
    }

    if (!service_name) {
      return res.status(400).json({ message: 'service_name is required.' });
    }

    // Store provider IDs as comma-separated string for later lookup
    const allProviderIdsStr = sp_ids.map(id => Number(id)).join(',');

    // Create one request for each provider
    const createdRequests = [];
    for (const sp_id of sp_ids) {
      const numericSpId = Number(sp_id);
      const newRequest = await pool.query(
        `INSERT INTO service_requests 
        (user_id, sp_id, service_name, date_required, urgency, description, attachment_url, work_address, work_latitude, work_longitude, status, all_provider_ids) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11) RETURNING *`,
        [user_id, numericSpId, service_name, date_required, safeUrgency, description, attachment_url, work_address, work_latitude, work_longitude, allProviderIdsStr]
      );
      createdRequests.push(newRequest.rows[0]);
    }

    res.json({
      message: 'Service request sent to multiple providers',
      requests: createdRequests,
      count: createdRequests.length,
    });
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
      // Fetch the request details to get all_provider_ids
      const requestDetails = await pool.query(
        `SELECT sr.request_id, sr.all_provider_ids, sr.service_name, sr.user_id,
                au.email as customer_email, au.full_name as customer_name,
                sp.sp_email as provider_email, sp.sp_name as provider_name
         FROM service_requests sr
         LEFT JOIN app_users au ON sr.user_id = au.user_id
         LEFT JOIN service_provider sp ON sr.sp_id = sp.sp_id
         WHERE sr.request_id = $1`,
        [id]
      );

      if (requestDetails.rows.length > 0) {
        const { all_provider_ids, service_name, customer_email, customer_name, provider_email, provider_name } = requestDetails.rows[0];
        
        // If this was a multi-provider request, reject for other providers
        if (all_provider_ids) {
          const providerIds = all_provider_ids.split(',').map(p => Number(p.trim()));
          
          // Reject this request for all other providers
          await pool.query(
            `UPDATE service_requests
             SET status = 'rejected'
             WHERE request_id = $1 AND sp_id != $2 AND sp_id = ANY($3::integer[])`,
            [id, requestLookup.rows[0].sp_id, providerIds]
          );
        }

        // Send notifications
        notifyRequestAccepted(provider_email, provider_name, service_name);
        notifyRequestAcceptedToCustomer(customer_email, customer_name, provider_name, service_name);
      }

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
      // Fetch customer info for notification
      const customerInfo = await pool.query(
        `SELECT sr.user_id, sr.service_name, au.email as customer_email, au.full_name as customer_name
         FROM service_requests sr
         LEFT JOIN app_users au ON sr.user_id = au.user_id
         WHERE sr.request_id = $1`,
        [id]
      );

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

      // Send notification to customer
      if (customerInfo.rows.length > 0) {
        const { customer_email, customer_name, service_name } = customerInfo.rows[0];
        notifyRequestDeclined(customer_email, customer_name, service_name);
      }

      return res.json(updated.rows[0]);
    }

    if (action === 'complete') {
      // Fetch customer info for notification
      const customerInfo = await pool.query(
        `SELECT sr.user_id, sr.service_name, au.email as customer_email, au.full_name as customer_name,
                sp.sp_name as provider_name
         FROM service_requests sr
         LEFT JOIN app_users au ON sr.user_id = au.user_id
         LEFT JOIN service_provider sp ON sr.sp_id = sp.sp_id
         WHERE sr.request_id = $1`,
        [id]
      );

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
      const completedRequestInfo = customerInfo.rows[0] || {};
      const requestDate = source.submitted_at ? new Date(source.submitted_at) : new Date();
      const requestDateOnly = requestDate.toISOString().slice(0, 10);
      const requestTimeOnly = requestDate.toTimeString().slice(0, 8);
      const completedDateOnly = completedAt.toISOString().slice(0, 10);
      const completedTimeOnly = completedAt.toTimeString().slice(0, 8);
      const resolvedServiceName = completedRequestInfo.service_name || source.service_name || 'General Service';

      await pool.query(
        `INSERT INTO invoices (
           request_id, user_id, sp_id, request_date, request_time, completion_date, completion_time,
           service_name, base_amount, base_rate_per_hour, hours_worked, labor_cost, extra_materials_cost, extra_fee,
           subtotal, tax, commission, total_amount
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (request_id)
         DO UPDATE SET
           completion_date = EXCLUDED.completion_date,
           completion_time = EXCLUDED.completion_time,
           service_name = EXCLUDED.service_name,
           base_amount = EXCLUDED.base_amount,
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
          resolvedServiceName,
          subtotal,
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

      // Send notification to customer
      if (customerInfo.rows.length > 0) {
        const { customer_email, customer_name, service_name, provider_name } = customerInfo.rows[0];
        notifyServiceCompleted(customer_email, customer_name, provider_name, service_name);
      }

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

// POST send a message
app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const { request_id, sender_id, sender_role, recipient_id, message_text } = req.body;

    if (!request_id || !sender_id || !recipient_id || !message_text?.trim()) {
      return res.status(400).json({ message: 'request_id, sender_id, recipient_id, and message_text are required.' });
    }

    const trimmedMessage = message_text.trim();
    
    // Ensure IDs are integers
    const rid = Number(request_id);
    const sid = Number(sender_id);
    const recid = Number(recipient_id);

    if (!Number.isInteger(rid) || !Number.isInteger(sid) || !Number.isInteger(recid)) {
      return res.status(400).json({ message: 'request_id, sender_id, and recipient_id must be valid integers.' });
    }

    const result = await pool.query(
      `INSERT INTO messages (request_id, sender_id, sender_role, recipient_id, message_text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [rid, sid, sender_role || 'customer', recid, trimmedMessage]
    );

    // Fetch recipient and sender info to send notification
    const recipientInfo = await pool.query(
      `SELECT au.email, au.full_name FROM app_users au WHERE au.user_id = $1`,
      [recid]
    );

    const senderInfo = await pool.query(
      `SELECT au.full_name FROM app_users au WHERE au.user_id = $1`,
      [sid]
    );

    // Send notification to recipient (async, don't await to keep response fast)
    if (recipientInfo.rows.length > 0 && senderInfo.rows.length > 0) {
      const { email: recipient_email, full_name: recipient_name } = recipientInfo.rows[0];
      const { full_name: sender_name } = senderInfo.rows[0];
      notifyNewMessage(recipient_email, recipient_name, sender_name).catch(err => {
        console.warn('Failed to send message notification:', err.message);
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Message API Error:', {
      message: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack.split('\n')[0],
    });
    res.status(500).json({ message: 'Server Error. Failed to send message.' });
  }
});

// GET messages for a request (conversation history)
app.get('/api/messages/:request_id', requireAuth, async (req, res) => {
  try {
    const { request_id } = req.params;

    const result = await pool.query(
      `SELECT
         m.*,
         au.full_name AS sender_name,
         au.profile_photo AS sender_photo
       FROM messages m
       LEFT JOIN app_users au ON au.user_id = m.sender_id
       WHERE m.request_id = $1
       ORDER BY m.created_at ASC`,
      [request_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET unread message count for a user
app.get('/api/messages/unread-count/:user_id', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT request_id, COUNT(*) as unread_count
       FROM messages
       WHERE recipient_id = $1 AND is_read = FALSE
       GROUP BY request_id`,
      [user_id]
    );

    // Convert to map: { request_id: unread_count }
    const unreadMap = {};
    result.rows.forEach(row => {
      unreadMap[row.request_id] = parseInt(row.unread_count, 10);
    });

    res.json(unreadMap);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PATCH mark message as read
app.patch('/api/messages/:message_id/read', requireAuth, async (req, res) => {
  try {
    const { message_id } = req.params;

    const result = await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE message_id = $1
       RETURNING *`,
      [message_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Message not found.' });
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
    } catch {
      // Try to extract JSON if Gemini added extra text
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
          console.log('Extracted JSON from Gemini response');
        } catch {
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

// ============================================================================
// Phase 5: ADMIN DASHBOARD ENDPOINTS
// ============================================================================

// Middleware to verify admin access by role.
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  if (req.user.user_role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  next();
};

// GET /api/admin/stats - Platform overview statistics
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get overall stats
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM app_users WHERE user_role = 'customer') as total_customers,
        (SELECT COUNT(*) FROM service_provider) as total_providers,
        (SELECT COUNT(*) FROM service_requests WHERE status IN ('pending', 'in_progress')) as active_requests,
        (SELECT COUNT(*) FROM service_requests WHERE status = 'completed') as completed_requests,
        (SELECT COUNT(*) FROM service_requests) as total_requests,
        (SELECT COUNT(*) FROM service_requests WHERE status = 'pending') as pending_requests,
        (SELECT COUNT(*) FROM service_requests WHERE status = 'in_progress') as in_progress_requests,
        (SELECT COUNT(*) FROM service_requests WHERE status = 'rejected') as rejected_requests,
        (SELECT AVG(CAST(customer_rating as NUMERIC)) FROM service_requests WHERE customer_rating IS NOT NULL AND customer_rating > 0) as avg_provider_rating
    `;

    const result = await pool.query(statsQuery);
    const stats = result.rows[0];

    return res.json({
      total_customers: parseInt(stats.total_customers) || 0,
      total_providers: parseInt(stats.total_providers) || 0,
      active_requests: parseInt(stats.active_requests) || 0,
      completed_requests: parseInt(stats.completed_requests) || 0,
      total_requests: parseInt(stats.total_requests) || 0,
      pending_requests: parseInt(stats.pending_requests) || 0,
      in_progress_requests: parseInt(stats.in_progress_requests) || 0,
      rejected_requests: parseInt(stats.rejected_requests) || 0,
      avg_provider_rating: parseFloat(stats.avg_provider_rating) || 0,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ message: 'Unable to fetch admin statistics' });
  }
});

// GET /api/admin/users - List of customers
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestUserColumn = await resolveServiceRequestUserColumn();
    const userJoinClause = requestUserColumn
      ? `LEFT JOIN service_requests sr ON u.user_id = sr.${requestUserColumn}`
      : 'LEFT JOIN service_requests sr ON FALSE';

    const query = `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.phone,
        u.location,
        u.is_suspended,
        u.warning_count,
        COUNT(sr.request_id) as request_count
      FROM app_users u
      ${userJoinClause}
      WHERE u.user_role = 'customer'
      GROUP BY u.user_id, u.full_name, u.email, u.phone, u.location, u.is_suspended, u.warning_count
      ORDER BY u.user_id DESC
      LIMIT 100
    `;

    const result = await pool.query(query);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin users error:', err);
    return res.status(500).json({ message: 'Unable to fetch users' });
  }
});

// GET /api/admin/providers - List of service providers
app.get('/api/admin/providers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT
        sp.sp_id,
        sp.sp_name,
        sp.specialization,
        COALESCE(ROUND(AVG(CASE WHEN sr.customer_rating > 0 THEN sr.customer_rating END)::numeric, 1), 0) as avg_rating,
        sp.hourly_charge,
        sp.availability,
        sp.is_suspended,
        sp.warning_count,
        sp.verification_status,
        sp.verification_submitted_at,
        sp.verified_at,
        sp.trust_score,
        sp.badge_level,
        sp.background_check_status,
        COUNT(sr.request_id) as completed_requests
      FROM service_provider sp
      LEFT JOIN service_requests sr ON sp.sp_id = sr.sp_id AND sr.status = 'completed'
      GROUP BY sp.sp_id, sp.sp_name, sp.specialization, sp.hourly_charge, sp.availability,
               sp.is_suspended, sp.warning_count, sp.verification_status, sp.verification_submitted_at,
               sp.verified_at, sp.trust_score, sp.badge_level, sp.background_check_status
      ORDER BY sp.sp_id DESC
      LIMIT 100
    `;

    const result = await pool.query(query);
    return res.json(result.rows || []);
  } catch (err) {
    console.error('Admin providers error:', err);
    return res.status(500).json({ message: 'Unable to fetch providers' });
  }
});

app.get('/api/admin/verification-pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         sp.sp_id,
         sp.sp_name,
         sp.sp_email,
         sp.specialization,
         sp.verification_status,
         sp.verification_submitted_at,
         sp.id_document_url,
         sp.license_document_url,
         sp.insurance_document_url,
         sp.background_check_status,
         sp.verification_notes,
         sp.trust_score,
         sp.badge_level
       FROM service_provider sp
       WHERE sp.verification_status = 'pending'
       ORDER BY sp.verification_submitted_at DESC NULLS LAST
       LIMIT 100`
    );

    return res.json(result.rows || []);
  } catch (err) {
    console.error('Admin verification pending error:', err);
    return res.status(500).json({ message: 'Unable to fetch pending verification requests' });
  }
});

app.post('/api/admin/providers/:spId/verification', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { spId } = req.params;
    const { action, review_note } = req.body || {};

    if (!['approve', 'reject'].includes(String(action || '').toLowerCase())) {
      return res.status(400).json({ message: 'action must be approve or reject' });
    }

    const status = action.toLowerCase() === 'approve' ? 'verified' : 'rejected';
    const verifiedAt = status === 'verified' ? 'CURRENT_TIMESTAMP' : 'NULL';

    const query = `
      UPDATE service_provider
      SET verification_status = $1,
          verification_notes = $2,
          verified_by_admin_id = $3,
          verified_at = ${verifiedAt}
      WHERE sp_id = $4
      RETURNING sp_id, sp_name, verification_status, verification_notes, verified_at
    `;

    const result = await pool.query(query, [
      status,
      review_note || null,
      req.user.user_id,
      spId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Provider not found' });
    }

    const trustResult = await recalculateProviderTrustScore(Number(spId));

    return res.json({
      message: status === 'verified' ? 'Provider verified successfully' : 'Provider verification rejected',
      provider: {
        ...result.rows[0],
        trust_score: trustResult?.trustScore ?? 0,
        badge_level: trustResult?.badgeLevel ?? 'new',
      },
    });
  } catch (err) {
    console.error('Admin provider verification error:', err);
    return res.status(500).json({ message: 'Unable to process verification decision' });
  }
});

// GET /api/admin/requests - List of all service requests
app.get('/api/admin/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const requestUserColumn = await resolveServiceRequestUserColumn();
    const customerJoinClause = requestUserColumn
      ? `LEFT JOIN app_users u ON sr.${requestUserColumn} = u.user_id`
      : 'LEFT JOIN app_users u ON FALSE';

    const query = `
      SELECT
        sr.request_id,
        sr.service_name,
        u.full_name as customer_name,
        sp.sp_name as provider_name,
        sr.status,
        (SELECT SUM(total_amount) FROM invoices WHERE request_id = sr.request_id) as total_amount,
        sr.submitted_at
      FROM service_requests sr
      ${customerJoinClause}
      LEFT JOIN service_provider sp ON sr.sp_id = sp.sp_id
      ORDER BY sr.submitted_at DESC
      LIMIT 100
    `;

    const result = await pool.query(query);
    return res.json(result.rows || []);
  } catch (err) {
    console.error('Admin requests error:', err);
    return res.status(500).json({ message: 'Unable to fetch requests' });
  }
});

// GET /api/admin/revenue - Revenue and payment analytics
app.get('/api/admin/revenue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalQuery = `
      SELECT
        SUM(total_amount) as total_revenue,
        COUNT(*) as completed_invoices,
        AVG(total_amount) as avg_transaction
      FROM invoices
      WHERE payment_status = 'completed'
    `;

    const commissionQuery = `
      SELECT
        SUM(commission) as total_commission,
        SUM(provider_payout_amount) as total_payouts
      FROM invoices
      WHERE payment_status = 'completed'
    `;

    const serviceQuery = `
      SELECT
        sr.service_name,
        SUM(i.total_amount) as revenue
      FROM invoices i
      LEFT JOIN service_requests sr ON i.request_id = sr.request_id
      WHERE sr.service_name IS NOT NULL
        AND i.payment_status = 'completed'
      GROUP BY sr.service_name
      ORDER BY revenue DESC
    `;

    const [totalResult, commissionResult, serviceResult] = await Promise.all([
      pool.query(totalQuery),
      pool.query(commissionQuery),
      pool.query(serviceQuery),
    ]);

    const totalData = totalResult.rows[0] || {};
    const commissionData = commissionResult.rows[0] || {};
    const serviceData = serviceResult.rows || [];

    // Build response
    const byService = {};
    serviceData.forEach((row) => {
      byService[row.service_name] = parseFloat(row.revenue) || 0;
    });

    return res.json({
      total_revenue: parseFloat(totalData.total_revenue) || 0,
      completed_invoices: parseInt(totalData.completed_invoices) || 0,
      avg_transaction: parseFloat(totalData.avg_transaction) || 0,
      total_commission: parseFloat(commissionData.total_commission) || 0,
      total_payouts: parseFloat(commissionData.total_payouts) || 0,
      by_service: byService,
    });
  } catch (err) {
    console.error('Admin revenue error:', err);
    return res.status(500).json({ message: 'Unable to fetch revenue data' });
  }
});

// GET /api/admin/analytics - Advanced analytics insights
app.get('/api/admin/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [overviewResult, monthlyResult, serviceResult, locationResult, providerResult] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') as pending_requests,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_requests,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_requests,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected_requests,
          ROUND(
            (COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0)) * 100,
            2
          ) as completion_rate,
          ROUND(AVG(CASE WHEN customer_rating > 0 THEN customer_rating END)::NUMERIC, 2) as avg_customer_rating
        FROM service_requests
      `),
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', sr.submitted_at), 'YYYY-MM') as month,
          COUNT(*) as requests_created,
          COUNT(*) FILTER (WHERE sr.status = 'completed') as requests_completed,
          COALESCE(SUM(i.total_amount), 0) as revenue
        FROM service_requests sr
        LEFT JOIN invoices i ON i.request_id = sr.request_id AND i.payment_status = 'completed'
        WHERE sr.submitted_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', sr.submitted_at)
        ORDER BY DATE_TRUNC('month', sr.submitted_at)
      `),
      pool.query(`
        SELECT
          sr.service_name,
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE sr.status = 'completed') as completed_requests,
          ROUND(
            (COUNT(*) FILTER (WHERE sr.status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0)) * 100,
            2
          ) as completion_rate,
          COALESCE(SUM(i.total_amount), 0) as revenue
        FROM service_requests sr
        LEFT JOIN invoices i ON i.request_id = sr.request_id AND i.payment_status = 'completed'
        WHERE sr.service_name IS NOT NULL
        GROUP BY sr.service_name
        ORDER BY total_requests DESC, revenue DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(sr.work_address), ''), 'Unknown') as area,
          COUNT(*) as request_count,
          COUNT(*) FILTER (WHERE sr.status = 'completed') as completed_count,
          COALESCE(SUM(i.total_amount), 0) as revenue
        FROM service_requests sr
        LEFT JOIN invoices i ON i.request_id = sr.request_id AND i.payment_status = 'completed'
        GROUP BY COALESCE(NULLIF(TRIM(sr.work_address), ''), 'Unknown')
        ORDER BY request_count DESC
        LIMIT 12
      `),
      pool.query(`
        SELECT
          sp.sp_id,
          sp.sp_name,
          sp.specialization,
          COUNT(sr.request_id) FILTER (WHERE sr.status = 'completed') as completed_jobs,
          ROUND(AVG(CASE WHEN sr.customer_rating > 0 THEN sr.customer_rating END)::NUMERIC, 2) as avg_rating,
          ROUND(
            (COUNT(sr.request_id) FILTER (WHERE sr.status IN ('accepted', 'in_progress', 'completed'))::NUMERIC /
            NULLIF(COUNT(sr.request_id) FILTER (WHERE sr.status <> 'pending'), 0)) * 100,
            2
          ) as acceptance_rate,
          COALESCE(SUM(i.provider_payout_amount), 0) as payout_earned
        FROM service_provider sp
        LEFT JOIN service_requests sr ON sr.sp_id = sp.sp_id
        LEFT JOIN invoices i ON i.request_id = sr.request_id AND i.payment_status = 'completed'
        GROUP BY sp.sp_id, sp.sp_name, sp.specialization
        ORDER BY completed_jobs DESC, avg_rating DESC NULLS LAST
        LIMIT 10
      `),
    ]);

    return res.json({
      overview: overviewResult.rows[0] || {},
      monthly_trends: monthlyResult.rows || [],
      service_demand: serviceResult.rows || [],
      location_heatmap: locationResult.rows || [],
      top_providers: providerResult.rows || [],
    });
  } catch (err) {
    console.error('Admin analytics error:', err);
    return res.status(500).json({ message: 'Unable to fetch advanced analytics' });
  }
});

// ============================================================================
// Phase 6: ADMIN MODERATION ENDPOINTS
// ============================================================================

// POST /api/admin/users/:userId/suspend - Suspend a customer
app.post('/api/admin/users/:userId/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

    // Suspend the user
    await pool.query(
      `UPDATE app_users SET is_suspended = TRUE, suspension_reason = $1 WHERE user_id = $2`,
      [sanitizeInput(reason || 'No reason provided'), userId],
    );

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_user_id, action_type, reason)
       VALUES ($1, $2, $3, $4)`,
      [req.user.user_id, userId, 'USER_SUSPENDED', sanitizeInput(reason || 'No reason provided')],
    );

    return res.json({ message: 'User suspended successfully' });
  } catch (err) {
    console.error('Suspend user error:', err);
    return res.status(500).json({ message: 'Unable to suspend user' });
  }
});

// POST /api/admin/users/:userId/unsuspend - Unsuspend a customer
app.post('/api/admin/users/:userId/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

    // Unsuspend the user
    await pool.query(
      `UPDATE app_users SET is_suspended = FALSE, suspension_reason = NULL WHERE user_id = $1`,
      [userId],
    );

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_user_id, action_type)
       VALUES ($1, $2, $3)`,
      [req.user.user_id, userId, 'USER_UNSUSPENDED'],
    );

    return res.json({ message: 'User unsuspended successfully' });
  } catch (err) {
    console.error('Unsuspend user error:', err);
    return res.status(500).json({ message: 'Unable to unsuspend user' });
  }
});

// POST /api/admin/providers/:spId/suspend - Suspend a service provider
app.post('/api/admin/providers/:spId/suspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const spId = parseInt(req.params.spId);
    const { reason } = req.body;

    if (!spId) {
      return res.status(400).json({ message: 'Provider ID required' });
    }

    // Suspend the provider
    await pool.query(
      `UPDATE service_provider SET is_suspended = TRUE, suspension_reason = $1 WHERE sp_id = $2`,
      [sanitizeInput(reason || 'No reason provided'), spId],
    );

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_provider_id, action_type, reason)
       VALUES ($1, $2, $3, $4)`,
      [req.user.user_id, spId, 'PROVIDER_SUSPENDED', sanitizeInput(reason || 'No reason provided')],
    );

    return res.json({ message: 'Provider suspended successfully' });
  } catch (err) {
    console.error('Suspend provider error:', err);
    return res.status(500).json({ message: 'Unable to suspend provider' });
  }
});

// POST /api/admin/providers/:spId/unsuspend - Unsuspend a service provider
app.post('/api/admin/providers/:spId/unsuspend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const spId = parseInt(req.params.spId);

    if (!spId) {
      return res.status(400).json({ message: 'Provider ID required' });
    }

    // Unsuspend the provider
    await pool.query(
      `UPDATE service_provider SET is_suspended = FALSE, suspension_reason = NULL WHERE sp_id = $1`,
      [spId],
    );

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_provider_id, action_type)
       VALUES ($1, $2, $3)`,
      [req.user.user_id, spId, 'PROVIDER_UNSUSPENDED'],
    );

    return res.json({ message: 'Provider unsuspended successfully' });
  } catch (err) {
    console.error('Unsuspend provider error:', err);
    return res.status(500).json({ message: 'Unable to unsuspend provider' });
  }
});

// POST /api/admin/users/:userId/warn - Issue a warning to a user
app.post('/api/admin/users/:userId/warn', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

    // Increment warning count
    const updateResult = await pool.query(
      `UPDATE app_users SET warning_count = warning_count + 1 WHERE user_id = $1 RETURNING warning_count`,
      [userId],
    );

    const warningCount = updateResult.rows[0]?.warning_count || 0;

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_user_id, action_type, reason, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.user_id, userId, 'USER_WARNED', sanitizeInput(reason || 'No reason provided'), `Warning count: ${warningCount}`],
    );

    return res.json({ message: 'Warning issued successfully', warning_count: warningCount });
  } catch (err) {
    console.error('Warn user error:', err);
    return res.status(500).json({ message: 'Unable to issue warning' });
  }
});

// POST /api/admin/providers/:spId/warn - Issue a warning to a provider
app.post('/api/admin/providers/:spId/warn', requireAuth, requireAdmin, async (req, res) => {
  try {
    const spId = parseInt(req.params.spId);
    const { reason } = req.body;

    if (!spId) {
      return res.status(400).json({ message: 'Provider ID required' });
    }

    // Increment warning count
    const updateResult = await pool.query(
      `UPDATE service_provider SET warning_count = warning_count + 1 WHERE sp_id = $1 RETURNING warning_count`,
      [spId],
    );

    const warningCount = updateResult.rows[0]?.warning_count || 0;

    // Log the action
    await pool.query(
      `INSERT INTO moderation_logs (admin_id, target_provider_id, action_type, reason, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.user_id, spId, 'PROVIDER_WARNED', sanitizeInput(reason || 'No reason provided'), `Warning count: ${warningCount}`],
    );

    return res.json({ message: 'Warning issued successfully', warning_count: warningCount });
  } catch (err) {
    console.error('Warn provider error:', err);
    return res.status(500).json({ message: 'Unable to issue warning' });
  }
});

// GET /api/admin/moderation-logs - View all moderation actions
app.get('/api/admin/moderation-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT
        ml.log_id,
        ml.admin_id,
        admin.full_name as admin_name,
        ml.target_user_id,
        target_u.full_name as target_user_name,
        ml.target_provider_id,
        target_sp.sp_name as target_provider_name,
        ml.action_type,
        ml.reason,
        ml.details,
        ml.created_at
      FROM moderation_logs ml
      LEFT JOIN app_users admin ON ml.admin_id = admin.user_id
      LEFT JOIN app_users target_u ON ml.target_user_id = target_u.user_id
      LEFT JOIN service_provider target_sp ON ml.target_provider_id = target_sp.sp_id
      ORDER BY ml.created_at DESC
      LIMIT 200
    `;

    const result = await pool.query(query);
    return res.json(result.rows || []);
  } catch (err) {
    console.error('Admin moderation logs error:', err);
    return res.status(500).json({ message: 'Unable to fetch moderation logs' });
  }
});

// ==================== PAYMENT PROCESSING ENDPOINTS ====================

// Create payment intent for invoice
app.post('/api/invoices/:invoiceId/create-payment-intent', requireAuth, async (req, res) => {
  try {
    if (!ensureStripeConfigured(res)) {
      return;
    }

    const { invoiceId } = req.params;
    const userId = req.user.user_id;

    // Get invoice details
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Verify user owns this invoice
    if (Number(invoice.user_id) !== Number(userId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Check if already paid
    if (invoice.payment_status === 'completed') {
      return res.status(400).json({ message: 'Invoice already paid' });
    }

    // Create or get existing payment intent
    let paymentIntentId = invoice.stripe_payment_intent_id;
    let clientSecret;

    if (!paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(invoice.total_amount * 100), // Stripe uses cents
        currency: 'usd',
        description: `Invoice #${invoiceId} - HomeSolutions`,
        metadata: {
          invoiceId: invoiceId.toString(),
          userId: userId.toString(),
        },
      });

      paymentIntentId = paymentIntent.id;
      clientSecret = paymentIntent.client_secret;

      // Update invoice with payment intent ID
      await pool.query(
        'UPDATE invoices SET stripe_payment_intent_id = $1 WHERE invoice_id = $2',
        [paymentIntentId, invoiceId]
      );
    } else {
      // Retrieve existing payment intent to get client secret
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      clientSecret = paymentIntent.client_secret;
    }

    res.json({
      clientSecret,
      paymentIntentId,
      amount: invoice.total_amount,
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({ message: 'Failed to create payment intent' });
  }
});

// Confirm payment and update invoice status
app.post('/api/invoices/:invoiceId/confirm-payment', requireAuth, async (req, res) => {
  try {
    if (!ensureStripeConfigured(res)) {
      return;
    }

    const { invoiceId } = req.params;
    const { paymentIntentId } = req.body;
    const userId = req.user.user_id;

    // Get invoice details
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Verify user owns this invoice
    if (Number(invoice.user_id) !== Number(userId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Verify payment intent
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === 'succeeded') {
      // Calculate provider payout (total minus 5% commission)
      const providerPayoutAmount = invoice.total_amount * 0.95;

      // Update invoice as paid
      await pool.query(
        `UPDATE invoices 
         SET payment_status = $1, 
             stripe_charge_id = COALESCE($2, stripe_charge_id),
             paid_at = CURRENT_TIMESTAMP,
             provider_payout_amount = $3,
             payout_status = 'pending'
         WHERE invoice_id = $4`,
        ['completed', paymentIntent.latest_charge || null, providerPayoutAmount, invoiceId]
      );

      await logNotificationEvent({
        eventType: 'payment_completed',
        recipientUserId: userId,
        status: 'sent',
        metadata: { invoiceId: Number(invoiceId), paymentIntentId },
      });

      res.json({
        success: true,
        message: 'Payment confirmed successfully',
        paymentStatus: 'completed',
      });
    } else {
      res.status(400).json({ message: 'Payment not completed' });
    }
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).json({ message: 'Failed to confirm payment' });
  }
});

// Get payment status for invoice
app.get('/api/invoices/:invoiceId/payment-status', requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.user.user_id;

    const result = await pool.query(
      'SELECT invoice_id, payment_status, paid_at, total_amount FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = result.rows[0];

    // Verify user owns this invoice
    const ownerCheck = await pool.query(
      'SELECT user_id FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (Number(ownerCheck.rows[0].user_id) !== Number(userId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    res.json({
      invoiceId: invoice.invoice_id,
      paymentStatus: invoice.payment_status,
      paidAt: invoice.paid_at,
      amount: invoice.total_amount,
    });
  } catch (err) {
    console.error('Get payment status error:', err);
    res.status(500).json({ message: 'Failed to get payment status' });
  }
});

// Stripe webhook handler
app.post('/api/webhooks/stripe', async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    if (endpointSecret) {
      if (!ensureStripeConfigured(res)) {
        return;
      }

      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } else {
      event = req.body;
    }

    const existingEvent = await pool.query('SELECT event_id FROM webhook_events WHERE event_id = $1', [event.id]);
    if (existingEvent.rows.length > 0) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await pool.query(
      'INSERT INTO webhook_events (event_id, event_type, processed, payload) VALUES ($1, $2, $3, $4)',
      [event.id, event.type, false, JSON.stringify(event)]
    );

    // Handle webhook events
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const { invoiceId } = paymentIntent.metadata;

      if (invoiceId) {
        // Calculate provider payout
        const invoiceResult = await pool.query(
          'SELECT total_amount FROM invoices WHERE invoice_id = $1',
          [invoiceId]
        );

        if (invoiceResult.rows.length > 0) {
          const providerPayoutAmount = invoiceResult.rows[0].total_amount * 0.95;

          await pool.query(
            `UPDATE invoices 
             SET payment_status = $1, 
                 stripe_charge_id = COALESCE($2, stripe_charge_id),
                 paid_at = CURRENT_TIMESTAMP,
                 provider_payout_amount = $3,
                 payout_status = 'pending'
             WHERE invoice_id = $4`,
            ['completed', paymentIntent.latest_charge || null, providerPayoutAmount, invoiceId]
          );

          await logNotificationEvent({
            eventType: 'payment_completed_webhook',
            status: 'sent',
            metadata: { invoiceId: Number(invoiceId), eventId: event.id },
          });
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      const { invoiceId } = paymentIntent.metadata;

      if (invoiceId) {
        await pool.query(
          'UPDATE invoices SET payment_status = $1 WHERE invoice_id = $2',
          ['failed', invoiceId]
        );

        await logNotificationEvent({
          eventType: 'payment_failed_webhook',
          status: 'sent',
          metadata: { invoiceId: Number(invoiceId), eventId: event.id },
        });
      }
    }

    await pool.query(
      'UPDATE webhook_events SET processed = TRUE, processed_at = CURRENT_TIMESTAMP WHERE event_id = $1',
      [event.id]
    );

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Admin: Get pending payouts
app.get('/api/admin/pending-payouts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.invoice_id,
        i.request_id,
        i.sp_id,
        sp.sp_name as business_name,
        sp.sp_email as primary_contact_email,
        sp.connected_account_id,
        i.total_amount,
        i.provider_payout_amount,
        i.payment_status,
        i.payout_status,
        i.paid_at,
        i.payout_date,
        u.full_name as customer_name
      FROM invoices i
      JOIN service_provider sp ON i.sp_id = sp.sp_id
      LEFT JOIN app_users u ON i.user_id = u.user_id
      WHERE i.payment_status = 'completed' AND i.payout_status = 'pending'
      ORDER BY i.paid_at DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Pending payouts error:', err);
    res.status(500).json({ message: 'Failed to fetch pending payouts' });
  }
});

// Admin: Process payout to provider
app.post('/api/admin/process-payout', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { invoiceId } = req.body;

    if (!invoiceId) {
      return res.status(400).json({ message: 'Invoice ID required' });
    }

    // Get invoice details
    const invoiceResult = await pool.query(
      `SELECT i.*, sp.connected_account_id
       FROM invoices i
       LEFT JOIN service_provider sp ON sp.sp_id = i.sp_id
       WHERE i.invoice_id = $1`,
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.payment_status !== 'completed' || invoice.payout_status !== 'pending') {
      return res.status(400).json({ message: 'Invoice not eligible for payout' });
    }

    let transferId = null;
    let payoutStatus = 'processed';
    let payoutError = null;

    if (invoice.connected_account_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(Number(invoice.provider_payout_amount || 0) * 100),
          currency: 'usd',
          destination: invoice.connected_account_id,
          metadata: {
            invoiceId: String(invoiceId),
            spId: String(invoice.sp_id || ''),
          },
        });

        transferId = transfer.id;
      } catch (transferErr) {
        payoutStatus = 'failed';
        payoutError = transferErr.message || 'Stripe transfer failed';
      }
    }

    const result = await pool.query(
      `UPDATE invoices
       SET payout_status = $1,
           payout_date = CURRENT_TIMESTAMP
       WHERE invoice_id = $2
       RETURNING *`,
      [payoutStatus, invoiceId]
    );

    await pool.query(
      `INSERT INTO payout_attempts (invoice_id, sp_id, amount, stripe_transfer_id, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [invoice.invoice_id, invoice.sp_id, invoice.provider_payout_amount, transferId, payoutStatus, payoutError]
    );

    await logNotificationEvent({
      eventType: 'payout_processed',
      status: payoutStatus === 'processed' ? 'sent' : 'failed',
      metadata: {
        invoiceId: Number(invoiceId),
        spId: Number(invoice.sp_id || 0),
        stripeTransferId: transferId,
        error: payoutError,
      },
    });

    res.json({
      message: payoutStatus === 'processed' ? 'Payout processed successfully' : 'Payout failed. Retry after fixing provider Stripe account.',
      invoice: result.rows[0],
      stripeTransferId: transferId,
      error: payoutError,
    });
  } catch (err) {
    console.error('Process payout error:', err);
    res.status(500).json({ message: 'Failed to process payout' });
  }
});

// Admin: Get payment transactions for dashboard
app.get('/api/admin/payments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.invoice_id,
        i.request_id,
        i.total_amount,
        i.payment_status,
        i.paid_at,
        u.full_name as customer_name,
        sp.business_name as provider_name,
        i.provider_payout_amount,
        i.payout_status
      FROM invoices i
      LEFT JOIN app_users u ON i.user_id = u.user_id
      LEFT JOIN service_provider sp ON i.sp_id = sp.sp_id
      WHERE i.payment_status IS NOT NULL
      ORDER BY i.created_at DESC
      LIMIT 100
    `);

    // Calculate payment summary
    const completedResult = await pool.query(
      `SELECT SUM(total_amount) as total_revenue, 
              SUM(commission) as total_commissions,
              COUNT(*) as completed_payments
       FROM invoices 
       WHERE payment_status = 'completed'`
    );

    const summary = completedResult.rows[0] || {
      total_revenue: 0,
      total_commissions: 0,
      completed_payments: 0,
    };

    res.json({
      transactions: result.rows,
      summary: {
        totalRevenue: summary.total_revenue,
        totalCommissions: summary.total_commissions,
        completedPayments: summary.completed_payments,
      },
    });
  } catch (err) {
    console.error('Admin payments error:', err);
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

async function initializeDatabase() {
  // Order matters due to FK relationships.
  await initializeAuthTable();
  await initializeServiceProviderTable();
  await initializeServiceRequestsTable();
  await initializeInvoicesTable();
  await initializeMessagesTable();
  await initializeModerationTables();
}

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed during initialization:', err.message || err);
    process.exit(1);
  }
}

startServer();

