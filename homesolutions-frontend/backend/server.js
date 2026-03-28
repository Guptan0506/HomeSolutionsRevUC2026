const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(cors()); // Allows React to connect
app.use(express.json()); // Allows the server to read JSON from your React forms

// 1. PostgreSQL Connection Configuration
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// 2. API Route: Get all Providers (for your 'Providers' screen)
app.get('/api/providers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM providers ORDER BY full_name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// 3. API Route: Submit a new Service Request (from your 'Form' screen)
app.post('/api/requests', async (req, res) => {
  try {
    const { customer_id, provider_id, description, urgency, address } = req.body;
    const newRequest = await pool.query(
      'INSERT INTO service_requests (customer_id, provider_id, description, urgency, address, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [customer_id, provider_id, description, urgency, address, 'Pending']
    );
    res.json(newRequest.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});