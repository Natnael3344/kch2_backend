const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Database connection pool.
// The connection string should be set as an environment variable (e.g., DB_URL).
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: {
    rejectUnauthorized: false // This is often required for cloud-based PostgreSQL instances
  }
});

// Endpoint to handle the form submission for a household and all its members
app.post('/submit-form', async (req, res) => {
  const { householdLocation, familyMembers } = req.body;

  // --- Input Validation ---
  if (!householdLocation || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(householdLocation)) {
    return res.status(400).json({ error: 'Missing or invalid householdLocation. Expected format: "latitude,longitude"' });
  }

  if (!familyMembers || !Array.isArray(familyMembers) || familyMembers.length === 0) {
    return res.status(400).json({ error: 'Missing or empty familyMembers array.' });
  }
  
  // Get a client from the connection pool
  const client = await pool.connect();

  try {
    // --- Start Database Transaction ---
    await client.query('BEGIN');

    // --- 1. Insert Household Location ---
    const [latitude, longitude] = householdLocation.split(',');
    const householdQuery = 'INSERT INTO Households (latitude, longitude) VALUES ($1, $2) RETURNING household_id';
    const householdResult = await client.query(householdQuery, [parseFloat(latitude), parseFloat(longitude)]);
    const householdId = householdResult.rows[0].household_id;
    
    if (!householdId) {
        throw new Error("Failed to create a new household record.");
    }

    // --- 2. Insert All Family Members ---
    // Note: The provided SQL schema uses camelCase names (e.g., "birthDate"). In PostgreSQL,
    // unquoted identifiers are automatically converted to lowercase (e.g., "birthdate").
    // This query uses the lowercase versions to match standard PostgreSQL behavior.
    const memberInsertQuery = `
      INSERT INTO FamilyMembers (
        household_id, name, phone, birthdate, gender, serveinchurch, maritalstatus,
        community, jobtype, hasdisability, educationlevel, schoolname, studytype,
        studyyear, disabilitytype, otherdisability
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

    // Loop through each family member and insert them into the database
    for (const member of familyMembers) {
      // Basic validation for each member object
      if (!member.name || !member.birthDate || !member.gender) {
        throw new Error(`A family member is missing required fields (name, birthDate, gender).`);
      }

      const memberValues = [
        householdId,
        member.name,
        member.phone,
        member.birthDate,
        member.gender,
        member.serveInChurch,
        member.maritalStatus,
        member.community,
        member.jobType,
        member.hasDisability,
        member.educationLevel || null,
        member.schoolName || null,
        member.studyType || null,
        member.studyYear || null,
        member.disabilityType || null,
        member.otherDisability || null
      ];

      await client.query(memberInsertQuery, memberValues);
    }
    
    // --- Commit Transaction ---
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, message: 'Household and members registered successfully.' });

  } catch (error) {
    // If any error occurs, rollback the entire transaction
    await client.query('ROLLBACK');
    console.error('Database transaction error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    // Release the client back to the pool
    client.release();
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
