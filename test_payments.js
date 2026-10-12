require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PassThrough } = require('stream');
const { dbHelper } = require('./database/db');
const seedAccounts = require('./database/seed');
const paymentConfig = require('./config/paymentConfig');
const paymentGateway = require('./services/paymentGateway');
const paymentService = require('./services/paymentService');
const { generatePaymentReceiptPdf } = require('./utils/receiptGenerator');

async function runPaymentTests() {
  console.log('========================================================================');
  console.log('  MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT), CHHATRAPATI SAMBHAJINAGAR');
  console.log('  ENTERPRISE PAYMENT MODULE AUTOMATED TEST SUITE (15/15 SCENARIOS)');
  console.log('========================================================================\n');

  // Save original environment
  const originalEnv = {
    PAYMENT_MODE: process.env.PAYMENT_MODE,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET
  };
  const originalCreateOrder = paymentGateway.createOrder;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Test Mode & Live Mode Configuration Separation
    // -------------------------------------------------------------------------
    console.log('1. Testing Test Mode vs Live Mode Configuration Separation...');
    
    // Live mode strictly requires rzp_live_
    process.env.PAYMENT_MODE = 'live';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_invalid_mode_key';
    process.env.RAZORPAY_KEY_SECRET = 'some_secret_12345';
    paymentConfig.refresh();

    let liveErrorCaught = false;
    try {
      paymentConfig.validateForTransaction();
    } catch (err) {
      liveErrorCaught = true;
      assert(err.message.includes('rzp_live_'), 'Live mode must reject test key IDs');
    }
    assert.strictEqual(liveErrorCaught, true, 'Live mode must reject rzp_test_ keys');

    // Public config must NEVER leak secrets
    process.env.PAYMENT_MODE = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_sample123';
    process.env.RAZORPAY_KEY_SECRET = 'super_secret_that_must_not_leak';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret_that_must_not_leak';
    paymentConfig.refresh();

    const publicConfig = paymentConfig.getPublicConfig();
    assert.strictEqual(publicConfig.keyId, 'rzp_test_sample123');
    assert.strictEqual(publicConfig.keySecret, undefined, 'Public config must not leak keySecret');
    assert.strictEqual(publicConfig.webhookSecret, undefined, 'Public config must not leak webhookSecret');
    console.log('✓ Mode separation and secret leak prevention verified.');

    // -------------------------------------------------------------------------
    // TEST 2: Missing Razorpay Credentials Safety (Fails Safely, No Fake Payments)
    // -------------------------------------------------------------------------
    console.log('2. Testing Missing Razorpay Credentials Safety...');
    process.env.RAZORPAY_KEY_ID = '';
    process.env.RAZORPAY_KEY_SECRET = '';
    paymentConfig.refresh();

    assert.strictEqual(paymentConfig.isConfigured(), false, 'isConfigured must be false when keys are empty');

    let missingCredErrorCaught = false;
    try {
      paymentConfig.validateForTransaction();
    } catch (err) {
      missingCredErrorCaught = true;
      assert.strictEqual(err.statusCode || err.status, 503, 'Must return HTTP 503 status when gateway is unconfigured');
    }
    assert.strictEqual(missingCredErrorCaught, true, 'validateForTransaction must throw 503 when unconfigured');
    console.log('✓ Missing credentials safety verified (returns 503 without fake success).');

    // -------------------------------------------------------------------------
    // Setup Mock Environment & Seed Database for Functional Testing
    // -------------------------------------------------------------------------
    console.log('\nSetting up test database fixtures (Contractors & Published Tenders)...');
    await seedAccounts();

    // Configure controlled test credentials for HMAC signature testing
    const TEST_KEY_SECRET = 'mit_test_key_secret_84920';
    const TEST_WEBHOOK_SECRET = 'mit_test_webhook_secret_10492';
    process.env.PAYMENT_MODE = 'test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mit_demo';
    process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    paymentConfig.refresh();

    // Create 2 test contractors
    const contractor1User = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified)
       VALUES (?, ?, ?, 'contractor', 'Civil', '+91-9800000001', 'active', TRUE)`,
      ['Contractor Alpha', 'alpha@buildcon.in', bcrypt.hashSync('Pass@123', 10)]
    );
    const contractor1 = await dbHelper.run(
      `INSERT INTO contractors (user_id, company_name, license_number, contact_details, registration_status, gst_number, pan_number)
       VALUES (?, 'Alpha Buildcon Pvt Ltd', 'LIC-001', 'alpha@buildcon.in', 'approved', '27AAAAA0000A1Z5', 'AAAAA0000A')`,
      [contractor1User.lastID]
    );

    const contractor2User = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified)
       VALUES (?, ?, ?, 'contractor', 'Electrical', '+91-9800000002', 'active', TRUE)`,
      ['Contractor Beta', 'beta@electro.in', bcrypt.hashSync('Pass@123', 10)]
    );
    const contractor2 = await dbHelper.run(
      `INSERT INTO contractors (user_id, company_name, license_number, contact_details, registration_status, gst_number, pan_number)
       VALUES (?, 'Beta Electro Pvt Ltd', 'LIC-002', 'beta@electro.in', 'approved', '27BBBBB0000B1Z5', 'BBBBB0000B')`,
      [contractor2User.lastID]
    );

    // Create a pending KYC contractor
    const pendingContractorUser = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified)
       VALUES (?, ?, ?, 'contractor', 'Civil', '+91-9800000003', 'pending', FALSE)`,
      ['Contractor Gamma', 'gamma@pending.in', bcrypt.hashSync('Pass@123', 10)]
    );
    const pendingContractor = await dbHelper.run(
      `INSERT INTO contractors (user_id, company_name, license_number, contact_details, registration_status)
       VALUES (?, 'Gamma Pending Ltd', 'LIC-003', 'gamma@pending.in', 'pending')`,
      [pendingContractorUser.lastID]
    );

    // Create an authority and evaluator user
    const authorityUser = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, status, email_verified)
       VALUES ('Authority Officer', 'auth@mit.asia', 'dummy', 'authority', 'Civil', 'active', TRUE)`
    );

    // Create published test tenders
    const deadlineFuture = new Date(Date.now() + 10 * 86400000).toISOString();
    const deadlinePast = new Date(Date.now() - 2 * 86400000).toISOString();

    const activeTender = await dbHelper.run(
      `INSERT INTO tenders (tender_code, title, description, department, estimated_budget, emd_amount, tender_fee, submission_deadline, opening_date, status, created_by)
       VALUES ('MIT-TND-TEST-001', 'Smart Campus Solar Grid', 'Turnkey 500kW Solar Installation', 'Electrical', 5000000, 100000, 2500, ?, ?, 'published', ?)`,
      [deadlineFuture, deadlineFuture, authorityUser.lastID]
    );

    const expiredTender = await dbHelper.run(
      `INSERT INTO tenders (tender_code, title, description, department, estimated_budget, emd_amount, tender_fee, submission_deadline, opening_date, status, created_by)
       VALUES ('MIT-TND-TEST-002', 'Expired Tender', 'Past Deadline Tender', 'Civil', 1000000, 50000, 1000, ?, ?, 'published', ?)`,
      [deadlinePast, deadlineFuture, authorityUser.lastID]
    );

    const draftTender = await dbHelper.run(
      `INSERT INTO tenders (tender_code, title, description, department, estimated_budget, emd_amount, tender_fee, submission_deadline, opening_date, status, created_by)
       VALUES ('MIT-TND-TEST-003', 'Draft Tender', 'Under Preparation', 'Civil', 2000000, 75000, 1500, ?, ?, 'draft', ?)`,
      [deadlineFuture, deadlineFuture, authorityUser.lastID]
    );

    // Setup Mock for Razorpay Orders API
    let mockOrderCounter = 1000;
    paymentGateway.createOrder = async ({ amount, currency, receipt, notes }) => {
      mockOrderCounter++;
      return {
        orderId: `order_mock_${mockOrderCounter}`,
        amount,
        currency,
        receipt,
        status: 'created'
      };
    };

    // -------------------------------------------------------------------------
    // TEST 3: Unauthorized Payment Attempts
    // -------------------------------------------------------------------------
    console.log('3. Testing Unauthorized Payment Attempts...');
    // A. Authority user attempts to pay
    let authPayError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: authorityUser.lastID,
        tenderId: activeTender.lastID,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      authPayError = true;
      assert.strictEqual(err.status, 403, 'Authority user cannot make contractor payments');
    }
    assert.strictEqual(authPayError, true, 'Non-contractor payment must be rejected');

    // B. Unapproved KYC contractor attempts to pay
    let pendingKycError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: pendingContractorUser.lastID,
        tenderId: activeTender.lastID,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      pendingKycError = true;
      assert.strictEqual(err.status, 403, 'Unapproved contractor cannot make payments');
    }
    assert.strictEqual(pendingKycError, true, 'Pending KYC contractor payment must be rejected');
    console.log('✓ Unauthorized roles & pending KYC rejected with 403 Forbidden.');

    // -------------------------------------------------------------------------
    // TEST 4: Invalid Payment Types
    // -------------------------------------------------------------------------
    console.log('4. Testing Invalid Payment Types...');
    let invalidTypeError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: contractor1User.lastID,
        tenderId: activeTender.lastID,
        paymentType: 'BRIBE_OR_CUSTOM',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      invalidTypeError = true;
      assert.strictEqual(err.status, 400, 'Invalid payment type must return 400');
    }
    assert.strictEqual(invalidTypeError, true, 'Invalid payment type must be rejected');
    console.log('✓ Invalid payment types rejected with 400 Bad Request.');

    // -------------------------------------------------------------------------
    // TEST 5: Invalid Tender IDs & Ineligible Tenders
    // -------------------------------------------------------------------------
    console.log('5. Testing Invalid Tender IDs & Ineligible Tenders...');
    // A. Non-existent tender ID
    let notFoundError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: contractor1User.lastID,
        tenderId: 999999,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      notFoundError = true;
      assert.strictEqual(err.status, 404, 'Non-existent tender must return 404');
    }
    assert.strictEqual(notFoundError, true, 'Non-existent tender must be rejected');

    // B. Draft tender
    let draftError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: contractor1User.lastID,
        tenderId: draftTender.lastID,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      draftError = true;
      assert.strictEqual(err.status, 400, 'Draft tender cannot accept payments');
    }
    assert.strictEqual(draftError, true, 'Draft tender rejected');

    // C. Expired submission deadline
    let expiredError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: contractor1User.lastID,
        tenderId: expiredTender.lastID,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      expiredError = true;
      assert.strictEqual(err.status, 400, 'Expired tender cannot accept payments');
    }
    assert.strictEqual(expiredError, true, 'Expired tender rejected');
    console.log('✓ Invalid tender IDs, draft tenders, and expired deadlines correctly rejected.');

    // -------------------------------------------------------------------------
    // TEST 6: Strict Server-Side Amount Calculation (Client Tampering Defense)
    // -------------------------------------------------------------------------
    console.log('6. Testing Server-Controlled Amount Computation...');
    // Active tender: tender_fee = 2500 INR (250,000 paise), emd_amount = 100,000 INR (10,000,000 paise)
    const tenderFeeOrder = await paymentService.createPaymentOrder({
      userId: contractor1User.lastID,
      tenderId: activeTender.lastID,
      paymentType: 'TENDER_FEE',
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(tenderFeeOrder.amount, 250000, 'Tender fee amount must be strictly 250,000 paise');
    assert.strictEqual(tenderFeeOrder.amountRupees, 2500, 'Tender fee in rupees must be 2500');

    const emdOrder = await paymentService.createPaymentOrder({
      userId: contractor1User.lastID,
      tenderId: activeTender.lastID,
      paymentType: 'EMD',
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(emdOrder.amount, 10000000, 'EMD amount must be strictly 10,000,000 paise');
    assert.strictEqual(emdOrder.amountRupees, 100000, 'EMD in rupees must be 100000');
    console.log('✓ Server-side amount computation verified; client cannot alter payable amount.');

    // -------------------------------------------------------------------------
    // TEST 7: Payment Record Persistence & Initial Status Lifecycle (CREATED)
    // -------------------------------------------------------------------------
    console.log('7. Testing Initial Payment Record Lifecycle (CREATED status)...');
    const dbOrderRecord = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [tenderFeeOrder.paymentId]);
    assert(dbOrderRecord, 'Payment record must be stored in PostgreSQL');
    assert.strictEqual(dbOrderRecord.payment_status, 'CREATED', 'Initial status must be CREATED');
    assert.strictEqual(dbOrderRecord.payment_type, 'TENDER_FEE');
    assert.strictEqual(Number(dbOrderRecord.amount), 250000);
    assert.strictEqual(dbOrderRecord.payment_provider, 'razorpay');
    assert.strictEqual(dbOrderRecord.payment_mode, 'test');
    assert.strictEqual(dbOrderRecord.provider_order_id, tenderFeeOrder.orderId);
    console.log('✓ Payment record created in PostgreSQL with status CREATED.');

    // -------------------------------------------------------------------------
    // TEST 8: Payment Ownership Violations
    // -------------------------------------------------------------------------
    console.log('8. Testing Payment Ownership Violation Protections...');
    // Contractor 2 attempts to verify or view Contractor 1's payment order
    let ownershipError = false;
    try {
      await paymentService.verifyPayment({
        userId: contractor2User.lastID,
        orderId: tenderFeeOrder.orderId,
        paymentId: 'pay_test_tampered',
        signature: 'invalid_sig'
      });
    } catch (err) {
      ownershipError = true;
      assert.strictEqual(err.status, 403, 'Cross-contractor verification must return 403');
    }
    assert.strictEqual(ownershipError, true, 'Cross-contractor verification forbidden');

    let historyOwnershipTest = await paymentService.getContractorPayments({ contractorId: contractor2.lastID });
    assert.strictEqual(historyOwnershipTest.length, 0, 'Contractor 2 must not see Contractor 1 payments');
    console.log('✓ Payment ownership isolation strictly enforced.');

    // -------------------------------------------------------------------------
    // TEST 9: Invalid Payment Signature Rejection & Audit Trail
    // -------------------------------------------------------------------------
    console.log('9. Testing Invalid Payment Signature Rejection...');
    let sigErrorCaught = false;
    try {
      await paymentService.verifyPayment({
        userId: contractor1User.lastID,
        orderId: tenderFeeOrder.orderId,
        paymentId: 'pay_fake_attack_123',
        signature: 'bad_signature_hex_value_ffffffff'
      });
    } catch (err) {
      sigErrorCaught = true;
      assert.strictEqual(err.status, 400, 'Tampered signature must return 400');
    }
    assert.strictEqual(sigErrorCaught, true, 'Tampered signature must be rejected');

    const paymentAfterBadSig = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [tenderFeeOrder.paymentId]);
    assert.strictEqual(paymentAfterBadSig.payment_status, 'FAILED', 'Failed signature must mark payment as FAILED');
    assert(paymentAfterBadSig.failure_reason.includes('signature'), 'Failure reason recorded');
    console.log('✓ Invalid HMAC signature rejected and recorded as FAILED.');

    // -------------------------------------------------------------------------
    // TEST 10: Successful Payment Verification with Cryptographic HMAC SHA-256
    // -------------------------------------------------------------------------
    console.log('10. Testing Successful Payment Verification (HMAC SHA-256)...');
    // Create fresh order for successful verification test
    const validTenderFeeOrder = await paymentService.createPaymentOrder({
      userId: contractor1User.lastID,
      tenderId: activeTender.lastID,
      paymentType: 'TENDER_FEE',
      ipAddress: '127.0.0.1'
    });

    const testPaymentId = 'pay_real_mock_94820';
    // Calculate valid HMAC SHA-256 signature using test secret: HMAC(order_id + '|' + payment_id, secret)
    const validSignature = crypto
      .createHmac('sha256', TEST_KEY_SECRET)
      .update(`${validTenderFeeOrder.orderId}|${testPaymentId}`)
      .digest('hex');

    const verificationResult = await paymentService.verifyPayment({
      userId: contractor1User.lastID,
      orderId: validTenderFeeOrder.orderId,
      paymentId: testPaymentId,
      signature: validSignature
    });

    assert.strictEqual(verificationResult.success, true);
    assert.strictEqual(verificationResult.verified, true);
    assert.strictEqual(verificationResult.payment.payment_status, 'PAID');

    const paidRecord = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [validTenderFeeOrder.paymentId]);
    assert.strictEqual(paidRecord.payment_status, 'PAID', 'Database status updated to PAID');
    assert.strictEqual(paidRecord.signature_verified, true, 'signature_verified flag set');
    assert.strictEqual(paidRecord.provider_payment_id, testPaymentId);
    assert(paidRecord.paid_at, 'paid_at timestamp populated');
    console.log('✓ Valid cryptographic signature verified; payment marked PAID in PostgreSQL.');

    // -------------------------------------------------------------------------
    // TEST 11: Idempotent Verification Requests
    // -------------------------------------------------------------------------
    console.log('11. Testing Verification Idempotency (Repeated Calls)...');
    const repeatedVerification = await paymentService.verifyPayment({
      userId: contractor1User.lastID,
      orderId: validTenderFeeOrder.orderId,
      paymentId: testPaymentId,
      signature: validSignature
    });

    assert.strictEqual(repeatedVerification.success, true);
    assert.strictEqual(repeatedVerification.alreadyProcessed, true, 'Repeated call detected as already verified');
    assert.strictEqual(repeatedVerification.payment.payment_status, 'PAID');
    console.log('✓ Repeated verification calls handled idempotently without error.');

    // -------------------------------------------------------------------------
    // TEST 12: Duplicate Successful Payment Prevention (Application & DB Level)
    // -------------------------------------------------------------------------
    console.log('12. Testing Duplicate Successful Payment Prevention...');
    // Contractor 1 already paid TENDER_FEE for activeTender. Try creating another order for TENDER_FEE:
    let duplicateOrderError = false;
    try {
      await paymentService.createPaymentOrder({
        userId: contractor1User.lastID,
        tenderId: activeTender.lastID,
        paymentType: 'TENDER_FEE',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      duplicateOrderError = true;
      assert.strictEqual(err.alreadyPaid, true, 'Service must reject duplicate order creation');
    }
    assert.strictEqual(duplicateOrderError, true, 'Duplicate order creation blocked by service');

    // Also test database level partial unique index enforcement:
    let dbDuplicateBlocked = false;
    try {
      await dbHelper.run(
        `INSERT INTO payments (receipt_no, contractor_id, user_id, tender_id, payment_type, amount, amount_rupees, payment_status)
         VALUES ('MIT-DUP-TEST', ?, ?, ?, 'TENDER_FEE', 250000, 2500.00, 'PAID')`,
        [contractor1.lastID, contractor1User.lastID, activeTender.lastID]
      );
    } catch (dbErr) {
      dbDuplicateBlocked = true;
      assert(dbErr.message.includes('unique') || dbErr.message.includes('idx_payments_unique_paid_obligation'), 'PostgreSQL unique constraint triggered');
    }
    assert.strictEqual(dbDuplicateBlocked, true, 'PostgreSQL partial unique constraint prevents duplicate PAID obligations');
    console.log('✓ Duplicate payments prevented at both application layer and PostgreSQL partial unique constraint.');

    // -------------------------------------------------------------------------
    // TEST 13: Webhook HMAC Signature Verification & Event Idempotency
    // -------------------------------------------------------------------------
    console.log('13. Testing Webhook HMAC Signature & Event Idempotency...');
    // A. Webhook with tampered signature
    const sampleEventPayload = JSON.stringify({
      id: 'evt_test_unique_99881',
      entity: 'event',
      account_id: 'acc_mit_test',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_test_100',
            order_id: emdOrder.orderId,
            amount: 10000000,
            currency: 'INR',
            status: 'captured'
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    });

    const badWebhookSignature = 'invalid_webhook_sig';
    let webhookBadSigError = false;
    try {
      await paymentService.handleWebhookEvent({
        rawBody: Buffer.from(sampleEventPayload),
        signature: badWebhookSignature,
        eventData: JSON.parse(sampleEventPayload),
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      webhookBadSigError = true;
      assert.strictEqual(err.status, 400);
    }
    assert.strictEqual(webhookBadSigError, true, 'Webhook with bad signature must throw 400 error');

    // B. Webhook with valid signature
    const finalPayloadBuf = Buffer.from(sampleEventPayload);
    const finalWebhookSig = crypto
      .createHmac('sha256', TEST_WEBHOOK_SECRET)
      .update(finalPayloadBuf)
      .digest('hex');

    const goodWebhookResult = await paymentService.handleWebhookEvent({
      rawBody: finalPayloadBuf,
      signature: finalWebhookSig,
      eventData: JSON.parse(sampleEventPayload),
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(goodWebhookResult.success, true);

    // Verify payment was marked PAID via webhook
    const emdDbRecord = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [emdOrder.paymentId]);
    assert.strictEqual(emdDbRecord.payment_status, 'PAID', 'EMD payment marked PAID via webhook');

    // C. Duplicate Webhook Delivery (Idempotency)
    const duplicateWebhookResult = await paymentService.handleWebhookEvent({
      rawBody: finalPayloadBuf,
      signature: finalWebhookSig,
      eventData: JSON.parse(sampleEventPayload),
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(duplicateWebhookResult.success, true);
    assert.strictEqual(duplicateWebhookResult.duplicate, true, 'Duplicate webhook event safely flagged as duplicate');
    console.log('✓ Webhook HMAC signature verified and duplicate event delivery handled idempotently.');

    // -------------------------------------------------------------------------
    // TEST 14: PDF Receipt Generation for Verified Payments
    // -------------------------------------------------------------------------
    console.log('14. Testing Institutional PDF Receipt Generation...');
    const fullPaidRecord = await paymentService.getPaymentById({
      paymentId: validTenderFeeOrder.paymentId,
      user: { id: contractor1User.lastID, role: 'contractor' }
    });
    
    const stream = new PassThrough();
    stream.setHeader = () => {};
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    const pdfPromise = new Promise(resolve => stream.on('end', () => resolve(Buffer.concat(chunks))));

    generatePaymentReceiptPdf(fullPaidRecord, stream);
    const pdfBuffer = await pdfPromise;

    assert(Buffer.isBuffer(pdfBuffer), 'Receipt generator must output binary Buffer');
    assert(pdfBuffer.length > 500, 'PDF buffer must contain binary document content');
    assert.strictEqual(pdfBuffer.subarray(0, 4).toString('ascii'), '%PDF', 'Buffer must be valid PDF (%PDF header)');
    console.log(`✓ Institutional PDF receipt generated successfully (${pdfBuffer.length} bytes).`);

    // -------------------------------------------------------------------------
    // TEST 15: Admin Financial Aggregations & Reports
    // -------------------------------------------------------------------------
    console.log('15. Testing Admin Financial Aggregations & Reports...');
    const adminStats = await paymentService.getAdminPaymentStats();
    const adminRecords = await paymentService.getAdminPayments({ page: 1, limit: 10 });

    assert(adminStats, 'Stats must be returned');
    assert(Number(adminStats.paidCount) >= 2, 'Must count at least 2 successful payments');
    assert(Number(adminStats.tenderFeesCount) >= 1, 'Tender fee payments counted');
    assert(Number(adminStats.emdCount) >= 1, 'EMD payments counted');
    assert(Number(adminStats.totalCollectedRupees) > 0, 'Total revenue calculated from database');
    assert(adminRecords.payments.length >= 2, 'Admin payments list populated');
    // -------------------------------------------------------------------------
    // TEST 16: Mandatory Payment Enforcement Before Bid Submission
    // -------------------------------------------------------------------------
    console.log('16. Testing Mandatory Payment Enforcement Before Bid Submission...');
    const http = require('http');
    const jwt = require('jsonwebtoken');
    const app = require('./server');

    const testServer = http.createServer(app);
    await new Promise(resolve => testServer.listen(0, resolve));
    const testPort = testServer.address().port;

    const requestJson = (options, postData) => new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: data ? JSON.parse(data) : {} });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (postData) req.write(JSON.stringify(postData));
      req.end();
    });

    try {
      const tokenUnpaid = jwt.sign({ id: contractor2User.lastID, role: 'contractor', email: 'beta@electro.in' }, process.env.JWT_SECRET);
      const tokenPaid = jwt.sign({ id: contractor1User.lastID, role: 'contractor', email: 'alpha@buildcon.in' }, process.env.JWT_SECRET);

      // A. Unpaid contractor attempts to submit bid -> MUST be rejected with 403
      const unpaidBidRes = await requestJson({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/contractor/bids',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenUnpaid}`,
          'Content-Type': 'application/json'
        }
      }, {
        tender_id: activeTender.lastID,
        bid_amount: 4800000,
        technical_proposal: 'Attempt without payment'
      });

      assert.strictEqual(unpaidBidRes.statusCode, 403, 'Unpaid contractor bid attempt must return 403 Forbidden');
      assert.strictEqual(unpaidBidRes.data.paymentRequired, true, 'Response must flag paymentRequired');
      assert(unpaidBidRes.data.message.includes('Payment Required'), 'Rejection message informs contractor that payment is required');

      // B. Paid contractor (Contractor 1 has paid Tender Fee and EMD) -> MUST succeed with 201
      const paidBidRes = await requestJson({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/contractor/bids',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenPaid}`,
          'Content-Type': 'application/json'
        }
      }, {
        tender_id: activeTender.lastID,
        bid_amount: 4850000,
        technical_proposal: 'Legitimate sealed bid after verified payments'
      });

      assert.strictEqual(paidBidRes.statusCode, 201, 'Paid contractor bid attempt must succeed with 201 Created');
      assert.strictEqual(paidBidRes.data.success, true);
      assert(paidBidRes.data.bidId, 'Bid record must be created in PostgreSQL');
      console.log('✓ Mandatory payment enforcement verified: Unpaid bids rejected (403), paid bids accepted (201).');
    } finally {
      await new Promise(resolve => testServer.close(resolve));
    }

    // 17. Re-initialize clean state for application
    console.log('17. Re-initializing clean database state...');
    await seedAccounts();
    console.log('✓ Seed completed: Database restored to pristine clean state.');

    console.log('\n========================================================================');
    console.log('  ALL PAYMENT MODULE TESTS PASSED (16/16) ✓');
    console.log('  SECURE, MODULAR, IDEMPOTENT RAZORPAY INTEGRATION CONFIRMED');
    console.log('========================================================================\n');
  } finally {
    // Restore original environment
    process.env.PAYMENT_MODE = originalEnv.PAYMENT_MODE;
    process.env.PAYMENT_PROVIDER = originalEnv.PAYMENT_PROVIDER;
    process.env.RAZORPAY_KEY_ID = originalEnv.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = originalEnv.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = originalEnv.RAZORPAY_WEBHOOK_SECRET;
    paymentConfig.refresh();
    paymentGateway.createOrder = originalCreateOrder;
  }
}

if (require.main === module) {
  runPaymentTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Payment test failure:', err);
      process.exit(1);
    });
}

module.exports = runPaymentTests;
