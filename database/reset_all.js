const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const REMOTE_URL = process.env.REMOTE_DATABASE_URL || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') ? process.env.DATABASE_URL : null);

const LOCAL_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'SmartTender',
  ssl: false
};

const TABLES_TO_TRUNCATE = [
  'financial_audit_logs',
  'contractor_payment_transactions',
  'contractor_payments',
  'emd_refund_records',
  'payment_webhook_events',
  'payments',
  'password_resets',
  'audit_logs',
  'evaluations',
  'bid_documents',
  'bids',
  'tender_documents',
  'tenders',
  'contractors'
];

async function resetDatabase(clientOrPool, name) {
  console.log(`\n==================================================`);
  console.log(`Starting clean reset on: ${name}`);
  console.log(`==================================================`);

  // 1. Truncate all non-user tables with CASCADE
  console.log(`1. Truncating all tenders, bids, documents, requests, payments, and logs...`);
  for (const table of TABLES_TO_TRUNCATE) {
    try {
      await clientOrPool.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      console.log(`   ✓ Truncated table: ${table}`);
    } catch (err) {
      console.warn(`   ! Warning on table ${table}: ${err.message}`);
    }
  }

  // 2. Clean users table, keeping ONLY admin@mit.asia
  console.log(`2. Removing all created non-admin accounts and secondary users...`);
  const deletedUsers = await clientOrPool.query(
    `DELETE FROM users WHERE email != 'admin@mit.asia' RETURNING id, name, email, role`
  );
  console.log(`   ✓ Deleted ${deletedUsers.rowCount} user account(s):`);
  deletedUsers.rows.forEach(u => {
    console.log(`     - [${u.role}] ${u.name} (${u.email})`);
  });

  // 3. Ensure primary admin account exists and is in pristine state
  console.log(`3. Verifying primary admin account (admin@mit.asia)...`);
  const existingAdmin = await clientOrPool.query(
    `SELECT id, name, email, role FROM users WHERE email = 'admin@mit.asia'`
  );

  const adminPassword = bcrypt.hashSync('Admin@123', 10);

  if (existingAdmin.rows.length === 0) {
    await clientOrPool.query(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified, failed_login_attempts, locked_until)
       VALUES ($1, $2, $3, 'admin', $4, $5, 'active', TRUE, 0, NULL)`,
      [
        'Administrator',
        'admin@mit.asia',
        adminPassword,
        'Central Administration Office',
        '+91-240-2375111'
      ]
    );
    console.log(`   ✓ Created fresh primary admin: admin@mit.asia`);
  } else {
    // Reset admin security flags and password to Admin@123
    await clientOrPool.query(
      `UPDATE users
       SET password = $1,
           status = 'active',
           email_verified = TRUE,
           failed_login_attempts = 0,
           locked_until = NULL,
           role = 'admin',
           department = 'Central Administration Office'
       WHERE email = 'admin@mit.asia'`,
      [adminPassword]
    );
    console.log(`   ✓ Re-synchronized primary admin: admin@mit.asia`);
  }

  // 4. Verify post-cleanup state
  const remainingUsers = await clientOrPool.query(`SELECT id, name, email, role, status FROM users`);
  console.log(`4. Final verification for ${name}:`);
  console.log(`   Remaining Users (${remainingUsers.rows.length}):`);
  remainingUsers.rows.forEach(u => {
    console.log(`     * ID ${u.id}: ${u.name} (${u.email}) [Role: ${u.role}, Status: ${u.status}]`);
  });

  for (const table of TABLES_TO_TRUNCATE) {
    try {
      const countRes = await clientOrPool.query(`SELECT COUNT(*) as count FROM "${table}"`);
      console.log(`   * ${table}: ${countRes.rows[0].count} rows`);
    } catch (e) {
      // Table might not exist
    }
  }
}

async function cleanUploadsDirectory() {
  console.log(`\n==================================================`);
  console.log(`Cleaning uploads directory`);
  console.log(`==================================================`);
  const uploadDir = path.resolve(__dirname, '../public/uploads');
  if (fs.existsSync(uploadDir)) {
    const files = fs.readdirSync(uploadDir);
    let removedCount = 0;
    for (const file of files) {
      const fullPath = path.join(uploadDir, file);
      if (fs.statSync(fullPath).isFile() && file !== '.gitkeep') {
        fs.unlinkSync(fullPath);
        removedCount++;
      }
    }
    console.log(`✓ Removed ${removedCount} uploaded file(s) from public/uploads.`);
  } else {
    console.log(`✓ Upload directory is already clean.`);
  }
}

async function run() {
  console.log(`=== SMART TENDER COMPLETE SYSTEM RESET ===`);

  // Reset Remote Database (if configured)
  if (REMOTE_URL) {
    let remotePool;
    try {
      remotePool = new Pool({
        connectionString: REMOTE_URL,
        ssl: { rejectUnauthorized: false }
      });
      await resetDatabase(remotePool, 'Remote Cloud Database (Render / smarttender.tech)');
    } catch (err) {
      console.error(`Failed to reset Remote database:`, err.message);
    } finally {
      if (remotePool) await remotePool.end();
    }
  } else {
    console.log(`\nℹ️ REMOTE_DATABASE_URL not set; skipping remote cloud database reset.`);
  }

  // Reset Local Database
  let localPool;
  try {
    localPool = new Pool(LOCAL_CONFIG);
    await resetDatabase(localPool, 'Local Database (localhost / SmartTender)');
  } catch (err) {
    console.error(`Failed to reset Local database:`, err.message);
  } finally {
    if (localPool) await localPool.end();
  }

  // Clean local upload files
  cleanUploadsDirectory();

  console.log(`\n✅ ALL SYSTEMS RESET SUCCESSFULLY.`);
  console.log(`Only primary Admin account (admin@mit.asia / Admin@123) is preserved.`);
  console.log(`The system is ready for a fresh start!`);
}

run();
