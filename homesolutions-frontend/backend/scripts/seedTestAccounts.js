const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CUSTOMER_COUNT = 10;
const PROVIDER_COUNT = 20;
const DEFAULT_PASSWORD = 'TestUser#2026A';

const firstNames = [
  'Avery', 'Jordan', 'Taylor', 'Riley', 'Morgan',
  'Casey', 'Drew', 'Skyler', 'Cameron', 'Quinn',
  'Parker', 'Reese', 'Blake', 'Kendall', 'Rowan',
  'Sage', 'Alex', 'Hayden', 'Kai', 'Harper'
];

const lastNames = [
  'Bennett', 'Carter', 'Diaz', 'Evans', 'Foster',
  'Gray', 'Hayes', 'Irwin', 'James', 'Knight',
  'Lopez', 'Miller', 'Nash', 'Owens', 'Perry',
  'Reed', 'Shaw', 'Turner', 'Vega', 'Walker'
];

const locations = [
  'Downtown', 'North Park', 'Riverside', 'Westside', 'East Ridge',
  'Lakeside', 'Midtown', 'Hillcrest', 'South End', 'Old Town'
];

const providerSpecializations = [
  'Plumbing', 'Electrical', 'HVAC', 'Appliance Repair', 'Carpentry',
  'Painting', 'Landscaping', 'Cleaning', 'Roofing', 'Flooring',
  'Handyman', 'Pest Control', 'Home Security', 'Drywall & Insulation',
  'Window Cleaning', 'Tree Trimming', 'Pool & Spa', 'Locksmith'
];

function pick(arr, index) {
  return arr[index % arr.length];
}

function makeName(index) {
  return `${pick(firstNames, index)} ${pick(lastNames, index + 3)}`;
}

async function upsertUser(client, { fullName, email, passwordHash, role, location }) {
  const existing = await client.query(
    `SELECT user_id FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );

  if (existing.rows.length > 0) {
    const updated = await client.query(
      `UPDATE app_users
       SET full_name = $1,
           password_hash = $2,
           user_role = $3,
           location = $4
       WHERE user_id = $5
       RETURNING user_id, full_name, email, user_role, location`,
      [fullName, passwordHash, role, location, existing.rows[0].user_id]
    );

    return updated.rows[0];
  }

  const inserted = await client.query(
    `INSERT INTO app_users (full_name, email, password_hash, user_role, location)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING user_id, full_name, email, user_role, location`,
    [fullName, email, passwordHash, role, location]
  );

  return inserted.rows[0];
}

async function upsertProviderProfile(client, user, index) {
  const specialization = pick(providerSpecializations, index);
  const location = pick(locations, index + 2);
  const hourlyCharge = 45 + (index % 8) * 10;
  const experienceYears = 2 + (index % 12);
  const services = `${specialization}, General Maintenance`;

  const updateResult = await client.query(
    `UPDATE service_provider
     SET sp_name = $2,
         sp_email = $3,
         sp_phone = $4,
         sp_location = $5,
         specialization = $6,
         availability = $7,
         hourly_charge = $8,
         experience_years = $9,
         services = $10,
         sp_services = $11,
         sp_base_price_per_hr = $12,
         verification_status = 'verified'
       WHERE user_id = $1 OR LOWER(COALESCE(sp_email, '')) = LOWER($3)`,
    [
      user.user_id,
      user.full_name,
      user.email,
      `555-01${String(index + 10).padStart(2, '0')}`,
      location,
      specialization,
      'Mon-Fri 9:00 AM - 6:00 PM',
      hourlyCharge,
      experienceYears,
      services,
      services,
      hourlyCharge,
    ]
  );

  if (updateResult.rowCount === 0) {
    await client.query('SAVEPOINT provider_seed_insert');

    try {
      await client.query(
        `INSERT INTO service_provider (
           user_id, sp_name, sp_email, sp_phone, sp_location,
           specialization, availability, hourly_charge, experience_years,
           services, sp_services, sp_base_price_per_hr, verification_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'verified')`,
        [
          user.user_id,
          user.full_name,
          user.email,
          `555-01${String(index + 10).padStart(2, '0')}`,
          location,
          specialization,
          'Mon-Fri 9:00 AM - 6:00 PM',
          hourlyCharge,
          experienceYears,
          services,
          services,
          hourlyCharge,
        ]
      );
    } catch (err) {
      if (!String(err.message || '').includes('service_provider_user_id_fkey')) {
        throw err;
      }

      await client.query('ROLLBACK TO SAVEPOINT provider_seed_insert');

      // Legacy schemas can have stale FK metadata; keep provider row linked by email in that case.
      await client.query(
        `INSERT INTO service_provider (
           user_id, sp_name, sp_email, sp_phone, sp_location,
           specialization, availability, hourly_charge, experience_years,
           services, sp_services, sp_base_price_per_hr, verification_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'verified')`,
        [
          null,
          user.full_name,
          user.email,
          `555-01${String(index + 10).padStart(2, '0')}`,
          location,
          specialization,
          'Mon-Fri 9:00 AM - 6:00 PM',
          hourlyCharge,
          experienceYears,
          services,
          services,
          hourlyCharge,
        ]
      );
    }

    await client.query('RELEASE SAVEPOINT provider_seed_insert');
  }
}

async function main() {
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

  const client = await pool.connect();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  let customersCreated = 0;
  let providersCreated = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
      const user = await upsertUser(client, {
        fullName: makeName(i),
        email: `test.customer${String(i + 1).padStart(2, '0')}@homesolutions.local`,
        passwordHash,
        role: 'customer',
        location: pick(locations, i),
      });

      if (user) {
        customersCreated += 1;
      }
    }

    for (let i = 0; i < PROVIDER_COUNT; i += 1) {
      const user = await upsertUser(client, {
        fullName: makeName(i + CUSTOMER_COUNT),
        email: `test.provider${String(i + 1).padStart(2, '0')}@homesolutions.local`,
        passwordHash,
        role: 'service_provider',
        location: pick(locations, i + 1),
      });

      await upsertProviderProfile(client, user, i);
      providersCreated += 1;
    }

    await client.query('COMMIT');

    console.log('Seed complete.');
    console.log(`Customers upserted: ${customersCreated}`);
    console.log(`Providers upserted: ${providersCreated}`);
    console.log(`Shared password for all seeded accounts: ${DEFAULT_PASSWORD}`);
    console.log('Customer emails: test.customer01@homesolutions.local ... test.customer10@homesolutions.local');
    console.log('Provider emails: test.provider01@homesolutions.local ... test.provider20@homesolutions.local');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to seed test accounts:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unexpected seeding error:', err.message || err);
  process.exit(1);
});
