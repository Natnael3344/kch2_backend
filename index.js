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
    community, jobType, educationLevel,
    schoolName, studyType, studyYear,
    hasDisability, disabilityType, otherDisability
  } = req.body;

  // Basic validation
  if (!name || !phone || !birthDate || !gender ||
      !address || !serveInChurch || !maritalStatus || 
      !community || !jobType || !hasDisability) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Additional validation for students
  if (jobType === 'ተማሪ' && (!educationLevel || !schoolName)) {
    return res.status(400).json({ error: 'Missing education information' });
  }

  // Additional validation for disabilities
  if (hasDisability === 'አለ' && !disabilityType) {
    return res.status(400).json({ error: 'Missing disability information' });
  }

  try {
    await pool.query(
      `INSERT INTO halaba_form (
        name, phone, birth_date, gender, address, 
        serve_in_church, marital_status, community, 
        job_type, education_level, school_name, 
        study_type, study_year, has_disability, 
        disability_type, other_disability
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        name, phone, birthDate, gender,
        address, serveInChurch, maritalStatus,
        community, jobType, educationLevel,
        schoolName, studyType, studyYear,
        hasDisability, disabilityType, otherDisability
      ]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});