const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config(); 
const twilio = require('twilio');
const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
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
// Get all households
app.get('/households', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM Households');
    client.release();

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching households:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all family members with household info
app.get('/family-members', async (req, res) => {
  try {
    const client = await pool.connect();
    const query = `
      SELECT fm.*, h.latitude, h.longitude
      FROM FamilyMembers fm
      JOIN Households h ON fm.household_id = h.household_id
    `;
    const result = await client.query(query);
    client.release();

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching family members:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New: Endpoint to get KPI counts
app.get('/api/kpis', async (req, res) => {
  const client = await pool.connect();
  try {
    // 1. Total Households
    const householdsRes = await client.query('SELECT COUNT(*) FROM Households');
    const totalHouseholds = parseInt(householdsRes.rows[0].count, 10);

    // 2. Total Members
    const membersRes = await client.query('SELECT COUNT(*) FROM FamilyMembers');
    const totalMembers = parseInt(membersRes.rows[0].count, 10);

    // 3. Active Tithers (Assuming a "tithe_status" column in Households table)
    // NOTE: If your Households table does not have 'tithe_status', this query will fail.
    // I am including it to match the logic from the frontend.
    const tithersRes = await client.query("SELECT COUNT(*) FROM Households WHERE tithe_status = 'paid'");
    const activeTithers = parseInt(tithersRes.rows[0].count, 10);

    // 4. Engaged Servers (Assuming a "serving_status" column in FamilyMembers table)
    // NOTE: If your FamilyMembers table does not have 'serving_status', this query will fail.
    // I am including it to match the logic from the frontend, using the assumed value 'አገልግያ አለው'.
    const serversRes = await client.query("SELECT COUNT(*) FROM FamilyMembers WHERE serveinchurch = TRUE");
    const engagedServers = parseInt(serversRes.rows[0].count, 10);

    res.json({
      totalHouseholds,
      totalMembers,
      activeTithers,
      engagedServers,
    });
  } catch (error) {
    console.error('Error fetching KPI data:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// New: Endpoint for Financial/Tithe Analysis
app.get('/api/tithe-data', async (req, res) => {
    const client = await pool.connect();
    try {
        // NOTE: This assumes a 'tithe_status' column exists in the Households table.
        const query = `
            SELECT tithe_status, COUNT(*) 
            FROM Households 
            GROUP BY tithe_status
        `;
        const result = await client.query(query);
        client.release();

        const data = result.rows.map(row => ({
            name: row.tithe_status === 'paid' ? 'Paid' : (row.tithe_status === 'pending' ? 'Pending' : 'Other'),
            count: parseInt(row.count, 10),
        }));

        // Ensure we explicitly have Paid and Pending even if counts are 0, to match original logic structure
        const paid = data.find(d => d.name === 'Paid') || { name: 'Paid', count: 0 };
        const pending = data.find(d => d.name === 'Pending') || { name: 'Pending', count: 0 };

        res.json([paid, pending]);
    } catch (error) {
        console.error('Error fetching tithe data:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// New: Endpoint for Gender, Age, and Location Data
app.get('/api/dashboard-charts-data', async (req, res) => {
    const client = await pool.connect();
    try {
        // 1. All Family Members (Gender & Age)
        const membersQuery = 'SELECT gender, EXTRACT(YEAR FROM AGE(birthdate)) AS age, household_id FROM FamilyMembers';
        const membersRes = await client.query(membersQuery);
        const members = membersRes.rows;

        // 2. All Households (Community)
        const householdsQuery = 'SELECT household_id, community FROM Households';
        const householdsRes = await client.query(householdsQuery);
        const households = householdsRes.rows;
        const householdMap = new Map(households.map(h => [h.household_id, h.community]));

        // --- Process Gender Data ---
        const maleCount = members.filter(m => m.gender === 'ወንድ').length;
        const femaleCount = members.filter(m => m.gender === 'ሴት').length;
        const genderData = [
            { name: 'ወንድ', value: maleCount },
            { name: 'ሴት', value: femaleCount },
        ];

        // --- Process Age Data ---
        // NOTE: Age grouping logic is simplified here to what was implied in the frontend.
        // In a real-world app, you'd calculate this based on birthDate.
        const calculateAgeGroup = (age) => {
          if (age < 13) return 'children';
          if (age <= 25) return 'youth';
          if (age <= 60) return 'adults';
          return 'seniors';
        };

        const ageStatsMap = new Map([
            ['Children', 0], ['Youth', 0], ['Adults', 0], ['Seniors', 0]
        ]);
        members.forEach(member => {
            const ageGroup = calculateAgeGroup(member.age);
            const name = ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
            ageStatsMap.set(name, ageStatsMap.get(name) + 1);
        });
        const ageData = Array.from(ageStatsMap.entries()).map(([name, count]) => ({ name, count }));

        // --- Process Location Data ---
        const communityMap = new Map();
        households.forEach(h => {
            const community = h.community || 'Unspecified';
            const count = communityMap.get(community) || 0;
            communityMap.set(community, count + 1);
        });
        const locationData = Array.from(communityMap.entries()).map(([community, count]) => ({ community, count }));

        res.json({
            genderData,
            ageData,
            locationData,
        });
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});
app.post('/api/send-sms', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" phone number or "message"' });
  }

  try {
    const sentMessage = await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
      body: message
    });
    console.log(`SMS sent, SID: ${sentMessage.sid}`);
    res.json({ success: true, sid: sentMessage.sid });
  } catch (error) {
    console.error('Error sending SMS:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
