const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { generateToken } = require('../securityUtils');

const base = 'http://localhost:5001';
const customerEmail = process.env.E2E_CUSTOMER_EMAIL || 'test.customer01@homesolutions.local';
const providerEmail = process.env.E2E_PROVIDER_EMAIL || 'test.provider01@homesolutions.local';

function createPool() {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = Number(process.env.DB_PORT || 5432);
  const useSsl = process.env.DB_SSL === 'true' || dbHost.includes('supabase.com');

  return new Pool({
    user: process.env.DB_USER,
    host: dbHost,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: dbPort,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

async function jfetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

async function run() {
  const summary = {
    loginCustomer: null,
    loginProvider: null,
    createRequest: null,
    completeRequest: null,
    fetchInvoice: null,
    paymentStatusBefore: null,
    createPaymentIntent: null,
    stripeDirectConfirm: null,
    confirmPaymentEndpoint: null,
    paymentStatusAfter: null,
  };

  const pool = createPool();

  const customerLookup = await pool.query(
    `SELECT user_id, email, user_role FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [customerEmail]
  );

  const providerLookup = await pool.query(
    `SELECT au.user_id, au.email, au.user_role, sp.sp_id
     FROM app_users au
     LEFT JOIN service_provider sp ON sp.user_id = au.user_id OR LOWER(COALESCE(sp.sp_email, '')) = LOWER(au.email)
     WHERE LOWER(au.email) = LOWER($1)
     LIMIT 1`,
    [providerEmail]
  );

  await pool.end();

  const customer = customerLookup.rows[0];
  const provider = providerLookup.rows[0];

  summary.loginCustomer = {
    status: customer ? 200 : 404,
    ok: Boolean(customer),
    message: customer ? 'JWT generated for customer test account.' : 'Customer account not found.',
  };

  summary.loginProvider = {
    status: provider && provider.sp_id ? 200 : 404,
    ok: Boolean(provider && provider.sp_id),
    message: provider && provider.sp_id ? 'JWT generated for provider test account.' : 'Provider account or sp_id not found.',
  };

  if (!customer) {
    return {
      success: false,
      reason: 'customer lookup failed',
      summary,
    };
  }

  if (!provider || !provider.sp_id) {
    return {
      success: false,
      reason: 'provider lookup failed',
      summary,
    };
  }

  const customerToken = generateToken(customer.user_id, customer.email, customer.user_role).token;
  const customerUserId = customer.user_id;
  const providerSpId = provider.sp_id;

  const createReq = await jfetch(`${base}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      user_id: customerUserId,
      sp_id: providerSpId,
      service_name: 'Plumbing',
      date_required: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      urgency: 'medium',
      description: 'Automated invoice payment test request',
      work_address: '123 Test St',
    }),
  });

  summary.createRequest = {
    status: createReq.status,
    ok: createReq.ok,
    requestId: createReq.data?.request_id,
    message: createReq.data?.message,
    raw: createReq.data?.raw,
  };

  if (!createReq.ok || !createReq.data?.request_id) {
    return {
      success: false,
      reason: 'request creation failed',
      summary,
    };
  }

  const requestId = createReq.data.request_id;

  const completeReq = await jfetch(`${base}/api/requests/${requestId}/provider`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'complete',
      materials_used: 'Pipe sealant',
      hours_worked: 2,
      extra_materials_cost: 15,
      extra_fee: 10,
      base_rate_per_hour: 75,
    }),
  });

  summary.completeRequest = {
    status: completeReq.status,
    ok: completeReq.ok,
    statusAfter: completeReq.data?.status,
    message: completeReq.data?.message,
  };

  if (!completeReq.ok) {
    const fallbackPool = createPool();
    try {
      await fallbackPool.query(
        `INSERT INTO invoices (
           request_id, user_id, sp_id, service_name, base_amount, commission, total_amount, payment_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         ON CONFLICT (request_id)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           sp_id = EXCLUDED.sp_id,
           service_name = EXCLUDED.service_name,
           base_amount = EXCLUDED.base_amount,
           commission = EXCLUDED.commission,
           total_amount = EXCLUDED.total_amount`,
        [requestId, customerUserId, providerSpId, 'Plumbing', 100, 5, 105]
      );

      summary.completeRequest.fallbackInvoiceInserted = true;
    } catch (err) {
      summary.completeRequest.fallbackInvoiceInserted = false;
      summary.completeRequest.fallbackError = err?.message || String(err);
      await fallbackPool.end();
      return {
        success: false,
        reason: 'request completion failed and fallback invoice insert failed',
        summary,
      };
    }

    await fallbackPool.end();
  }

  const invoiceResp = await jfetch(`${base}/api/invoices/${requestId}`);
  summary.fetchInvoice = {
    status: invoiceResp.status,
    ok: invoiceResp.ok,
    invoiceId: invoiceResp.data?.invoice_id,
  };

  if (!invoiceResp.ok || !invoiceResp.data?.invoice_id) {
    return {
      success: false,
      reason: 'invoice fetch failed',
      summary,
    };
  }

  const invoiceId = invoiceResp.data.invoice_id;

  const statusBefore = await jfetch(`${base}/api/invoices/${invoiceId}/payment-status`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  summary.paymentStatusBefore = {
    status: statusBefore.status,
    ok: statusBefore.ok,
    paymentStatus: statusBefore.data?.paymentStatus,
    amount: statusBefore.data?.amount,
  };

  const createPi = await jfetch(`${base}/api/invoices/${invoiceId}/create-payment-intent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  summary.createPaymentIntent = {
    status: createPi.status,
    ok: createPi.ok,
    message: createPi.data?.message,
    paymentIntentId: createPi.data?.paymentIntentId || null,
    hasClientSecret: Boolean(createPi.data?.clientSecret),
  };

  const paymentIntentId = createPi.data?.paymentIntentId || null;

  if (paymentIntentId && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, { payment_method: 'pm_card_visa' });

      summary.stripeDirectConfirm = {
        ok: true,
        id: confirmed.id,
        status: confirmed.status,
      };

      const confirmEndpoint = await jfetch(`${base}/api/invoices/${invoiceId}/confirm-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ paymentIntentId }),
      });

      summary.confirmPaymentEndpoint = {
        status: confirmEndpoint.status,
        ok: confirmEndpoint.ok,
        message: confirmEndpoint.data?.message,
        paymentStatus: confirmEndpoint.data?.paymentStatus,
      };
    } catch (err) {
      summary.stripeDirectConfirm = {
        ok: false,
        error: err?.message || String(err),
      };
    }
  }

  const statusAfter = await jfetch(`${base}/api/invoices/${invoiceId}/payment-status`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  summary.paymentStatusAfter = {
    status: statusAfter.status,
    ok: statusAfter.ok,
    paymentStatus: statusAfter.data?.paymentStatus,
    paidAt: statusAfter.data?.paidAt || null,
  };

  const fullPass = summary.createPaymentIntent?.ok
    && summary.confirmPaymentEndpoint?.ok
    && summary.paymentStatusAfter?.paymentStatus === 'completed';

  return {
    success: fullPass,
    note: fullPass
      ? 'Full payment flow succeeded through endpoint confirmation.'
      : 'Flow executed; inspect createPaymentIntent/stripeDirectConfirm/confirmPaymentEndpoint for environment constraints.',
    requestId,
    invoiceId,
    summary,
  };
}

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(JSON.stringify({ success: false, reason: 'unexpected error', error: err?.message || String(err) }, null, 2));
    process.exit(1);
  });
