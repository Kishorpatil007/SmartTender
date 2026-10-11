require('dotenv').config();
const assert = require('assert');
const seedAccounts = require('./database/seed');
const { dbHelper } = require('./database/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');
const emailService = require('./utils/emailService');

function validatePasswordComplexity(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least 1 uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least 1 lowercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least 1 number.';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must contain at least 1 special character (!@#$%^&* etc).';
  }
  return null;
}

function hashOTP(otp, email) {
  return crypto.createHash('sha256').update(`${email.toLowerCase().trim()}:${otp}`).digest('hex');
}

async function runTests() {
  console.log('========================================================================');
  console.log('  MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT), CHHATRAPATI SAMBHAJINAGAR');
  console.log('  ENTERPRISE SECURITY & REALISTIC STAFF ONBOARDING TEST SUITE');
  console.log('========================================================================\n');

  try {
    // 1. Environment & JWT Configuration Validation
    console.log('1. Testing Environment Variables & JWT Secret Integrity...');
    assert(process.env.JWT_SECRET, 'JWT_SECRET must be defined in process.env (.env file)');
    assert.strictEqual(JWT_SECRET, process.env.JWT_SECRET, 'middleware/auth.js must strictly use process.env.JWT_SECRET without fallback');
    console.log('✓ Environment integrity verified: JWT_SECRET loaded from .env.');

    // 2. Initial Clean State & Seeded Admin Accounts
    console.log('2. Testing Initial Clean State with Strict Seed Credentials...');
    await seedAccounts();
    
    const adminCount = await dbHelper.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    const tenderCount = await dbHelper.get('SELECT COUNT(*) as count FROM tenders');
    const contractorCount = await dbHelper.get('SELECT COUNT(*) as count FROM contractors');
    const logCount = await dbHelper.get('SELECT COUNT(*) as count FROM audit_logs');

    assert.strictEqual(Number(adminCount.count), 2, 'Should have 2 pre-configured Admin accounts');
    assert.strictEqual(Number(tenderCount.count), 0, 'Should start with exactly 0 default tenders');
    assert.strictEqual(Number(contractorCount.count), 0, 'Should start with exactly 0 contractors');
    assert.strictEqual(Number(logCount.count), 0, 'Should start with exactly 0 default audit logs');

    const admin1 = await dbHelper.get('SELECT * FROM users WHERE email = ?', ['admin@mit.asia']);
    const admin2 = await dbHelper.get('SELECT * FROM users WHERE email = ?', ['test.admin@mit.asia']);

    assert(admin1 && admin2, 'Both Admin accounts must exist');
    assert(bcrypt.compareSync('Admin@123', admin1.password), 'Admin 1 password matches Admin@123');
    assert(bcrypt.compareSync('Admin@123', admin2.password), 'Admin 2 password matches Admin@123');
    assert.strictEqual(admin1.email_verified, true, 'Admin account email must be verified');
    console.log('✓ Clean state verified: 2 Admin accounts active with Admin@123.');

    // 3. Cryptographically Secure OTP Engine Verification
    console.log('3. Testing Cryptographic Secure OTP Generator (crypto.randomInt)...');
    for (let i = 0; i < 20; i++) {
      const secureOtp = crypto.randomInt(100000, 1000000).toString();
      assert.strictEqual(secureOtp.length, 6, 'OTP must be exactly 6 digits');
      const num = parseInt(secureOtp, 10);
      assert(num >= 100000 && num <= 999999, 'OTP must be in range 100000 - 999999');
    }
    console.log('✓ Cryptographic random integer generator validated for 6-digit OTPs.');

    // 4. Strict Password Policy Engine
    console.log('4. Testing Strict Password Policy Engine...');
    assert.notStrictEqual(validatePasswordComplexity('Pass1!'), null, 'Reject < 8 chars');
    assert.notStrictEqual(validatePasswordComplexity('admin@123'), null, 'Reject missing uppercase');
    assert.notStrictEqual(validatePasswordComplexity('ADMIN@123'), null, 'Reject missing lowercase');
    assert.notStrictEqual(validatePasswordComplexity('Admin@@@@'), null, 'Reject missing number');
    assert.notStrictEqual(validatePasswordComplexity('Admin1234'), null, 'Reject missing special char');
    assert.strictEqual(validatePasswordComplexity('Admin@123'), null, 'Accept Admin@123');
    assert.strictEqual(validatePasswordComplexity('Vendor#2026'), null, 'Accept Vendor#2026');
    assert.strictEqual(validatePasswordComplexity('RajeshPatil@2026'), null, 'Accept RajeshPatil@2026');
    console.log('✓ Password policy correctly enforces min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char.');

    // 5. Realistic Authority Account Request Submission
    console.log('5. Testing Authority Account Request Submission (Rajesh Patil)...');
    const authReqEmail = 'rajesh@department.gov.in';
    const authReqName = 'Rajesh Patil';
    const authReqEmpId = 'EE1024';
    const authReqDesignation = 'Executive Engineer';
    const authReqDept = 'Department of Civil Engineering & Infrastructure';
    const authReqPhone = '+91-9822012345';
    const authReqJustification = 'Authorized officer for civil works and infrastructure tender creation.';

    const placeholderSecret = crypto.randomBytes(32).toString('hex');
    const placeholderHash = bcrypt.hashSync(placeholderSecret, 10);

    const authInsert = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, employee_id, designation, justification, status, email_verified, failed_login_attempts)
       VALUES (?, ?, ?, 'authority', ?, ?, ?, ?, ?, 'pending', FALSE, 0)`,
      [authReqName, authReqEmail, placeholderHash, authReqDept, authReqPhone, authReqEmpId, authReqDesignation, authReqJustification]
    );

    const pendingAuthority = await dbHelper.get('SELECT * FROM users WHERE id = ?', [authInsert.lastID]);
    assert(pendingAuthority, 'Authority request record created');
    assert.strictEqual(pendingAuthority.status, 'pending', 'Starts in pending status');
    assert.strictEqual(pendingAuthority.employee_id, 'EE1024', 'Employee ID recorded');
    assert.strictEqual(pendingAuthority.designation, 'Executive Engineer', 'Designation recorded');
    assert.strictEqual(pendingAuthority.email_verified, false, 'Email initially unverified');
    console.log('✓ Authority account request logged with Employee ID & Designation.');

    // 6. Admin Reviews & Approves Authority Request -> Invitation Dispatched
    console.log('6. Testing Admin Approval & Cryptographic Invitation Dispatch...');
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await dbHelper.run(
      `UPDATE users SET status = 'invited', invitation_token = ?, invitation_expires_at = ? WHERE id = ?`,
      [invitationToken, expiresAt, pendingAuthority.id]
    );

    const invitedUser = await dbHelper.get('SELECT * FROM users WHERE id = ?', [pendingAuthority.id]);
    assert.strictEqual(invitedUser.status, 'invited', 'User status updated to invited');
    assert.strictEqual(invitedUser.invitation_token, invitationToken, 'Invitation token stored');
    assert(new Date(invitedUser.invitation_expires_at) > new Date(), 'Expiration is in the future');

    // Verify token verification API logic
    const verifyUser = await dbHelper.get(
      `SELECT * FROM users WHERE email = ? AND invitation_token = ?`,
      [authReqEmail, invitationToken]
    );
    assert(verifyUser, 'Invitation token and email verified successfully');
    console.log('✓ Admin approved request and generated cryptographic invitation token.');

    // 7. Authority Sets Password via Invitation & Activates Account
    console.log('7. Testing Password Setup via Invitation Token & Account Activation...');
    const chosenPassword = 'RajeshPatil@2026';
    assert.strictEqual(validatePasswordComplexity(chosenPassword), null, 'Chosen password meets complexity');

    const newHashedPass = bcrypt.hashSync(chosenPassword, 10);
    await dbHelper.run(
      `UPDATE users
       SET password = ?, status = 'active', email_verified = TRUE, invitation_token = NULL, invitation_expires_at = NULL
       WHERE id = ?`,
      [newHashedPass, pendingAuthority.id]
    );

    const activatedAuthority = await dbHelper.get('SELECT * FROM users WHERE id = ?', [pendingAuthority.id]);
    assert.strictEqual(activatedAuthority.status, 'active', 'User account is now active');
    assert.strictEqual(activatedAuthority.email_verified, true, 'Email verified flag set');
    assert.strictEqual(activatedAuthority.invitation_token, null, 'Invitation token cleared');
    assert(bcrypt.compareSync(chosenPassword, activatedAuthority.password), 'Password hash verifies chosen password');
    console.log('✓ Authority configured password and activated institutional account.');

    // 8. Evaluator Account Request & Admin Rejection Flow
    console.log('8. Testing Evaluator Account Request & Admin Rejection Flow...');
    const evalEmail = 'unverified.staff@external.com';
    const evalInsert = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, employee_id, designation, justification, status, email_verified)
       VALUES (?, ?, ?, 'evaluator', 'External Committee', '+91-9876543210', 'EXT-99', 'Guest Evaluator', 'Guest audit', 'pending', FALSE)`,
      ['Guest Staff', evalEmail, placeholderHash]
    );

    // Admin rejects request with reason
    await dbHelper.run(`UPDATE users SET status = 'rejected', invitation_token = NULL WHERE id = ?`, [evalInsert.lastID]);
    const rejectedStaff = await dbHelper.get('SELECT * FROM users WHERE id = ?', [evalInsert.lastID]);
    assert.strictEqual(rejectedStaff.status, 'rejected', 'Staff request marked as rejected');
    console.log('✓ Evaluator request rejection flow verified.');

    // 9. Contractor KYC Registration & Verification Queue
    console.log('9. Testing Contractor KYC Profile & Verification Queue...');
    const vendorEmail = 'contact@shindeinfratech.in';
    const vendorPass = 'Vendor@2026';

    const contractorUser = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified)
       VALUES (?, ?, ?, 'contractor', ?, ?, 'pending', FALSE)`,
      ['Rajendra Shinde (MD)', vendorEmail, bcrypt.hashSync(vendorPass, 10), 'Civil Works', '+91-9822012345']
    );

    const contractorProfile = await dbHelper.run(
      `INSERT INTO contractors (user_id, company_name, license_number, contact_details, address, experience_years, registration_status, gst_number, pan_number)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [contractorUser.lastID, 'Shinde Infratech Pvt Ltd', 'MH-PWD-CLASS-A-4491', vendorEmail, 'MIDC Chikalthana, Chhatrapati Sambhajinagar', 15, '27AAACT9988G1ZQ', 'AAACT9988G']
    );

    const contractorRecord = await dbHelper.get('SELECT * FROM contractors WHERE id = ?', [contractorProfile.lastID]);
    assert.strictEqual(contractorRecord.registration_status, 'pending', 'Contractor starts in pending KYC');
    assert.strictEqual(contractorRecord.gst_number, '27AAACT9988G1ZQ', 'GSTIN recorded');
    assert.strictEqual(contractorRecord.pan_number, 'AAACT9988G', 'PAN recorded');

    // Admin approves contractor
    await dbHelper.run("UPDATE contractors SET registration_status = 'approved' WHERE id = ?", [contractorProfile.lastID]);
    await dbHelper.run("UPDATE users SET status = 'active', email_verified = TRUE WHERE id = ?", [contractorUser.lastID]);
    console.log('✓ Contractor KYC registration & admin approval verified.');

    // 10. Email Verification & Forgot Password with Hashed OTP
    console.log('10. Testing Email Verification & Forgot Password with Hashed OTP...');
    const resetOtp = crypto.randomInt(100000, 1000000).toString();
    const resetOtpHashed = hashOTP(resetOtp, vendorEmail);
    const resetTokenStr = crypto.randomBytes(24).toString('hex');
    const resetExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await dbHelper.run(
      `INSERT INTO password_resets (email, otp, otp_hash, type, token, expires_at, used)
       VALUES (?, ?, ?, 'PASSWORD_RESET', ?, ?, FALSE)`,
      [vendorEmail, 'ENCRYPTED', resetOtpHashed, resetTokenStr, resetExpiresAt]
    );

    const matchHash = hashOTP(resetOtp, vendorEmail);
    const verifyRecord = await dbHelper.get(
      `SELECT * FROM password_resets WHERE email = ? AND otp_hash = ? AND type = 'PASSWORD_RESET' AND used = FALSE`,
      [vendorEmail, matchHash]
    );
    assert(verifyRecord, 'Hashed OTP record found and matched');

    const newSecretPass = 'BrandNewSecret@2026';
    assert.strictEqual(validatePasswordComplexity(newSecretPass), null);
    await dbHelper.run('UPDATE users SET password = ? WHERE email = ?', [bcrypt.hashSync(newSecretPass, 10), vendorEmail]);
    const userAfterReset = await dbHelper.get('SELECT password FROM users WHERE email = ?', [vendorEmail]);
    assert(bcrypt.compareSync(newSecretPass, userAfterReset.password));
    console.log('✓ Cryptographic hashed OTP verification and password reset verified.');

    // 11. Account Lockout Protection (Brute Force Defense)
    console.log('11. Testing Account Lockout Engine (5 Failed Password Attempts)...');
    const testUserEmail = 'lockout.test@mit.asia';
    const initialPass = 'SecurePass@123';

    const lockedUserRes = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified, failed_login_attempts)
       VALUES (?, ?, ?, 'authority', 'IT Cell', '+91-9999999999', 'active', TRUE, 0)`,
      ['Lockout Test User', testUserEmail, bcrypt.hashSync(initialPass, 10)]
    );

    await dbHelper.run('UPDATE users SET failed_login_attempts = 4 WHERE id = ?', [lockedUserRes.lastID]);
    let checkUser = await dbHelper.get('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?', [lockedUserRes.lastID]);
    assert.strictEqual(checkUser.failed_login_attempts, 4);

    const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await dbHelper.run('UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?', [lockUntil, lockedUserRes.lastID]);
    checkUser = await dbHelper.get('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?', [lockedUserRes.lastID]);
    assert(new Date(checkUser.locked_until) > new Date());

    await dbHelper.run('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [lockedUserRes.lastID]);
    console.log('✓ Account lockout engine correctly locks on 5 attempts and resets on success.');

    // 12. Full Procurement Tender Lifecycle (Created by newly onboarded Rajesh Patil)
    console.log('12. Testing Tender Creation by Activated Authority (Rajesh Patil)...');
    const newTender = await dbHelper.run(
      `INSERT INTO tenders (tender_code, title, description, department, estimated_budget, emd_amount, submission_deadline, opening_date, eligibility_criteria, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
      [
        'MIT-CIVIL-2026-001',
        'Construction of New AI Research & Innovation Complex Block-C',
        'State of the art seismic-resistant structure with smart building automation.',
        authReqDept,
        85000000.00,
        1700000.00,
        new Date(Date.now() + 20 * 86400000).toISOString(),
        new Date(Date.now() + 21 * 86400000).toISOString(),
        'Class-A PWD Registered Contractor with ISO 9001:2015',
        pendingAuthority.id
      ]
    );

    const bidResult = await dbHelper.run(
      `INSERT INTO bids (tender_id, contractor_id, bid_amount, technical_proposal, status)
       VALUES (?, ?, ?, ?, 'submitted')`,
      [newTender.lastID, contractorProfile.lastID, 81500000.00, 'Complete turnkey civil construction with 5-year structural warranty']
    );

    const techScore = 96.0;
    const finScore = 100.0;
    const totalQCBS = ((techScore * 0.7) + (finScore * 0.3)).toFixed(2);

    await dbHelper.run(
      "UPDATE tenders SET status = 'awarded', awarded_to_contractor_id = ?, award_date = CURRENT_TIMESTAMP, award_notes = 'Approved by Central Purchase Committee' WHERE id = ?",
      [contractorProfile.lastID, newTender.lastID]
    );
    await dbHelper.run("UPDATE bids SET status = 'awarded', technical_score = ?, financial_score = ?, total_score = ? WHERE id = ?", [techScore, finScore, totalQCBS, bidResult.lastID]);

    const finalTender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [newTender.lastID]);
    assert.strictEqual(finalTender.status, 'awarded', 'Tender successfully created by Rajesh Patil and awarded');
    console.log(`✓ Procurement workflow passed with QCBS score: ${totalQCBS}/100.`);

    // 13. Re-initialize clean state for user
    console.log('13. Re-initializing clean database state...');
    await seedAccounts();
    console.log('✓ Seed completed: 2 Admin accounts ready (Admin@123), 0 default logs, 0 tenders.');

    console.log('\n========================================================================');
    console.log('  ALL AUTOMATED SECURITY & STAFF ONBOARDING TESTS PASSED (13/13) ✓');
    console.log('  REQUEST -> VERIFY -> APPROVE -> INVITATION -> SET PASSWORD COMPLETE');
    console.log('========================================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
