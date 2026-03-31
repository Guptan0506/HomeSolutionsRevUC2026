const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_PASSWORD = 'TestUser#2026A';
const REQUESTS_TO_CREATE = 10;

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

  try {
    console.log('\n📊 Checking existing test accounts...\n');

    // Get customers
    const customerResult = await client.query(
      `SELECT user_id, full_name, email FROM app_users WHERE user_role = 'customer' LIMIT 5`
    );

    const customers = customerResult.rows;
    console.log(`✓ Found ${customers.length} customers:`);
    customers.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.full_name} (${c.email})`);
    });

    // Get providers
    const providerResult = await client.query(
      `SELECT sp_id, user_id, sp_name, sp_email, specialization FROM service_provider LIMIT 10`
    );

    const providers = providerResult.rows;
    console.log(`\n✓ Found ${providers.length} providers:`);
    providers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.sp_name || 'Unknown'} - ${p.specialization} (sp_id: ${p.sp_id})`);
    });

    if (customers.length === 0 || providers.length === 0) {
      console.log('\n⚠ Insufficient test data. Running seedTestAccounts.js first...\n');
      // Would need to run seedTestAccounts here but let's just exit for now
      console.log('Please run: node scripts/seedTestAccounts.js');
      process.exit(1);
    }

    console.log('\n📋 Creating service request simulations...\n');

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < REQUESTS_TO_CREATE; i++) {
      const customer = customers[i % customers.length];
      const provider = providers[i % providers.length];

      try {
        // Create request
        const requestResult = await client.query(
          `INSERT INTO service_requests (
             user_id, sp_id, service_name, work_address, date_required, 
             description, status, urgency, submitted_at
           )
           VALUES ($1, $2, $3, $4, CURRENT_DATE + INTERVAL '1 day', $5, 'pending', $6, NOW())
           RETURNING request_id`,
          [
            customer.user_id,
            provider.sp_id,
            provider.specialization || 'General Service',
            `Service Location ${i + 1}`,
            `Request for ${provider.specialization || 'service'} at location ${i + 1}`,
            i % 3 === 0 ? 'High' : 'Low',
          ]
        );

        const requestId = requestResult.rows[0].request_id;

        // Mark as in progress
        await client.query(
          `UPDATE service_requests SET status = 'in_progress' WHERE request_id = $1`,
          [requestId]
        );

        // Complete the request
        await client.query(
          `UPDATE service_requests SET status = 'completed', completed_at = NOW() WHERE request_id = $1`,
          [requestId]
        );

        // Create invoice
        const baseRate = 50 + (i % 5) * 10;
        const hoursWorked = 2 + (i % 4);
        const laborCost = baseRate * hoursWorked;
        const materialsCost = 25 + (i % 100);
        const urgentFee = i % 2 === 0 ? 50 : 0;
        const subtotal = laborCost + materialsCost + urgentFee;
        const tax = Math.round(subtotal * 0.07 * 100) / 100;
        const commission = Math.round(subtotal * 0.05 * 100) / 100;
        const totalAmount = subtotal + tax + commission;

        const invoiceResult = await client.query(
          `INSERT INTO invoices (
             request_id, user_id, sp_id, service_name, base_rate_per_hour, hours_worked,
             labor_cost, extra_materials_cost, extra_fee, subtotal, tax, commission, 
             total_amount, base_amount, payment_status, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', NOW())
           RETURNING invoice_id`,
          [
            requestId, customer.user_id, provider.sp_id, provider.specialization || 'Service',
            baseRate, hoursWorked, laborCost, materialsCost, urgentFee,
            subtotal, tax, commission, totalAmount, subtotal
          ]
        );

        const invoiceId = invoiceResult.rows[0].invoice_id;

        console.log(`  ✓ Request ${requestId}: ${customer.full_name} → ${provider.specialization} (Invoice ${invoiceId})`);
        successCount++;
      } catch (err) {
        console.log(`  ✗ Request ${i + 1}: ${err.message}`);
        failureCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ SIMULATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`  • Customers available: ${customers.length}`);
    console.log(`  • Providers available: ${providers.length}`);
    console.log(`  • Service requests created: ${successCount}`);
    console.log(`  • Failed requests: ${failureCount}`);

    console.log(`\n🔑 Login Credentials (Password: ${DEFAULT_PASSWORD})`);
    console.log(`  Customers: ${customers.map(c => c.email).join(', ')}`);
    console.log(`  Providers: ${providers.map(p => p.sp_email || 'unknown').join(', ')}`);

    if (successCount > 0) {
      console.log('\n✅ Simulation completed successfully!\n');
    } else {
      console.log('\n❌ No requests were created\n');
    }
  } catch (err) {
    console.error('\n❌ Script failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
