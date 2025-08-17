const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DB_URL, // DB_URL should be set in deployment environment
  ssl: { rejectUnauthorized: false } // Required for most cloud PostgreSQL connections
});

app.post('/submit-form', async (req, res) => {
  const {
    name, phone, birthDate, gender,
    address, serveInChurch, maritalStatus,
    community, jobType
  } = req.body;

  
  if (!name || !phone || !birthDate || !gender ||
      !address || !serveInChurch || !maritalStatus || !community || !jobType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await pool.query(
      `INSERT INTO halaba_form
        (name, phone, birth_date, gender, address, serve_in_church, marital_status, community, job_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        name, phone, birthDate, gender,
        address, serveInChurch, maritalStatus,
        community, jobType
      ]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Backend running.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
