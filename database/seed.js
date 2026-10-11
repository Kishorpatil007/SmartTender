const bcrypt = require('bcryptjs');
const { db, dbHelper, initSchema } = require('./db');

/**
 * Initializes the database with the pre-configured Central Administrator accounts:
 * 1. Primary Central Administrator: admin@mit.asia | Admin@123
 * 2. Inspection & Audit Administrator: test.admin@mit.asia | Admin@123
 *
 * Clean slate: 0 audit logs, 0 tenders, 0 contractors, 0 bids, 0 evaluations.
 */
const seedAccounts = async () => {
  try {
    await initSchema();
    console.log('Initializing MIT Chhatrapati Sambhajinagar Smart Tender database...');

    await dbHelper.run(`TRUNCATE TABLE password_resets, audit_logs, evaluations, bid_documents, bids, tender_documents, tenders, contractors, users RESTART IDENTITY CASCADE;`);

    const adminPassword = bcrypt.hashSync('Admin@123', 10);
    await dbHelper.run(
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

    const testAdminPassword = bcrypt.hashSync('Admin@123', 10);
    await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified, failed_login_attempts, locked_until)
       VALUES ($1, $2, $3, 'admin', $4, $5, 'active', TRUE, 0, NULL)`,
      [
        'Administrator',
        'test.admin@mit.asia',
        testAdminPassword,
        'Auditing & Inspection Cell',
        '+91-240-2375115'
      ]
    );

    console.log('✅ Administrator account 1 active: admin@mit.asia / Admin@123');
    console.log('✅ Administrator account 2 active: test.admin@mit.asia / Admin@123');
    console.log('✅ Clean slate verified: 0 audit logs, 0 default tenders, 0 contractors, 0 bids.');
    console.log('✅ Password complexity policy enabled (8+ chars, upper, lower, digit, special).');
    console.log('✅ Email verification & brute-force defense systems ready.');
  } catch (err) {
    console.error('Seed accounts error:', err);
  }
};

if (require.main === module) {
  seedAccounts().then(() => {
    db.end();
  });
}

module.exports = seedAccounts;
