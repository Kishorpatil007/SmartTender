require('dotenv').config();
const assert = require('assert');
const { PassThrough } = require('stream');
const { dbHelper } = require('./database/db');
const seedAccounts = require('./database/seed');
const contractorPaymentService = require('./services/contractorPaymentService');
const emdRefundService = require('./services/emdRefundService');
const { generateContractorPaymentVoucherPdf, generateEmdRefundAdvicePdf } = require('./utils/paymentVoucherGenerator');

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function runFinancialModuleTests() {
  console.log('========================================================================');
  console.log('  MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT), CHHATRAPATI SAMBHAJINAGAR');
  console.log('  ENTERPRISE FINANCIAL MODULE AUTOMATED TEST SUITE');
  console.log('  MODULE 1 (CONTRACTOR PAYMENTS) & MODULE 2 (EMD REFUNDS)');
  console.log('========================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // Setup clean test environment and seed database
    // -------------------------------------------------------------------------
    console.log('Preparing clean database state...');
    await seedAccounts();

    // Fetch seeded admin user
    const adminUser = await dbHelper.get("SELECT id, name, role FROM users WHERE role = 'admin' LIMIT 1");
    assert(adminUser, 'Admin user must exist');

    // Create Authority User
    const authUser = await dbHelper.get(`
      INSERT INTO users (name, email, password, role, employee_id, designation, department, status, email_verified)
      VALUES ('Prof. Nitin Shinde', 'nitin.shinde@mit.asia', 'hash123', 'authority', 'MIT-AUTH-901', 'Dean Infrastructure', 'Civil Works', 'active', true)
      RETURNING id, name, role
    `);

    // Create Evaluator User
    const evalUser = await dbHelper.get(`
      INSERT INTO users (name, email, password, role, employee_id, designation, department, status, email_verified)
      VALUES ('Dr. K. S. Sharma', 'k.sharma@mit.asia', 'hash123', 'evaluator', 'MIT-EVAL-502', 'Head of Purchase', 'Central Stores', 'active', true)
      RETURNING id, name, role
    `);

    // Create Contractor 1 (Winner)
    const contractor1User = await dbHelper.get(`
      INSERT INTO users (name, email, password, role, status, email_verified)
      VALUES ('Aurangabad Civil Infra', 'infra@aurangabad.com', 'hash123', 'contractor', 'active', true)
      RETURNING id
    `);
    const contractor1 = await dbHelper.get(`
      INSERT INTO contractors (user_id, company_name, license_number, pan_number, gst_number, registration_status)
      VALUES (?, 'Aurangabad Civil Infra Pvt Ltd', 'MH-CIVIL-2026-001', 'ABCDE1234F', '27ABCDE1234F1Z5', 'approved')
      RETURNING id, company_name
    `, [contractor1User.id]);

    // Create Contractor 2 (Unsuccessful Bidder)
    const contractor2User = await dbHelper.get(`
      INSERT INTO users (name, email, password, role, status, email_verified)
      VALUES ('Marathwada Builders', 'builders@marathwada.com', 'hash123', 'contractor', 'active', true)
      RETURNING id
    `);
    const contractor2 = await dbHelper.get(`
      INSERT INTO contractors (user_id, company_name, license_number, pan_number, gst_number, registration_status)
      VALUES (?, 'Marathwada Builders & Developers', 'MH-CIVIL-2026-002', 'XYZAB5678C', '27XYZAB5678C1Z9', 'approved')
      RETURNING id, company_name
    `, [contractor2User.id]);

    // Create Published Tender
    const tender1 = await dbHelper.get(`
      INSERT INTO tenders (
        tender_code, title, description, department, estimated_budget,
        tender_fee, emd_amount, submission_deadline, opening_date, status, created_by
      ) VALUES (
        'MIT/CW/2026/088', 'Renovation of High-Tech Research Labs',
        'Turnkey renovation of Civil & Mechanical lab wings with HVAC and ESD flooring',
        'Civil Works', 1000000.00, 2000.00, 20000.00,
        NOW() + INTERVAL '10 days', NOW() + INTERVAL '11 days', 'published', ?
      ) RETURNING id, tender_code, title, emd_amount
    `, [authUser.id]);

    // Insert EMD payment for Contractor 1
    const emdPayment1 = await dbHelper.get(`
      INSERT INTO payments (
        tender_id, user_id, contractor_id, payment_type, payment_mode, amount, amount_rupees,
        payment_status, receipt_no, provider_payment_id, provider_order_id
      ) VALUES (
        ?, ?, ?, 'EMD', 'test', 2000000, 20000.00, 'PAID', 'REC-EMD-001', 'pay_test_rzp_001', 'order_rzp_001'
      ) RETURNING id, amount_rupees, receipt_no
    `, [tender1.id, contractor1User.id, contractor1.id]);

    // Insert EMD payment for Contractor 2
    const emdPayment2 = await dbHelper.get(`
      INSERT INTO payments (
        tender_id, user_id, contractor_id, payment_type, payment_mode, amount, amount_rupees,
        payment_status, receipt_no, provider_payment_id, provider_order_id
      ) VALUES (
        ?, ?, ?, 'EMD', 'test', 2000000, 20000.00, 'PAID', 'REC-EMD-002', 'pay_test_rzp_002', 'order_rzp_002'
      ) RETURNING id, amount_rupees, receipt_no
    `, [tender1.id, contractor2User.id, contractor2.id]);

    // Insert Bids
    const bid1 = await dbHelper.get(`
      INSERT INTO bids (tender_id, contractor_id, bid_amount, technical_proposal, status)
      VALUES (?, ?, 950000.00, 'Comprehensive HVAC & ESD proposal', 'submitted') RETURNING id
    `, [tender1.id, contractor1.id]);

    const bid2 = await dbHelper.get(`
      INSERT INTO bids (tender_id, contractor_id, bid_amount, technical_proposal, status)
      VALUES (?, ?, 980000.00, 'Alternative standard civil proposal', 'submitted') RETURNING id
    `, [tender1.id, contractor2.id]);

    console.log('✓ Initial test fixtures created successfully.\n');

    // -------------------------------------------------------------------------
    // TEST 1: Tender Award & Automatic Contractor Payment Record Initialization
    // -------------------------------------------------------------------------
    console.log('1. Testing Tender Award & Contractor Payment Initialization...');

    // Mark tender as awarded to contractor1
    await dbHelper.run(`
      UPDATE tenders
      SET status = 'awarded', awarded_to_contractor_id = ?, award_date = NOW()
      WHERE id = ?
    `, [contractor1.id, tender1.id]);

    await dbHelper.run(`UPDATE bids SET status = 'awarded' WHERE id = ?`, [bid1.id]);
    await dbHelper.run(`UPDATE bids SET status = 'rejected' WHERE id = ?`, [bid2.id]);

    // Initialize Contractor Payment Record
    const cpInit = await contractorPaymentService.initializeContractPayment({
      tenderId: tender1.id,
      adminUserId: authUser.id,
      ipAddress: '127.0.0.1'
    });

    assert(cpInit.id, 'Contractor payment record must be created');
    assert.strictEqual(parseFloat(cpInit.contract_amount), 950000.00, 'Contract amount must match winning bid');
    assert.strictEqual(parseFloat(cpInit.approved_payable_amount), 950000.00, 'Initial approved payable defaults to contract amount');
    assert.strictEqual(parseFloat(cpInit.remaining_payable_amount), 950000.00, 'Initial remaining balance equals contract amount');
    assert.strictEqual(parseFloat(cpInit.total_paid_amount), 0.00, 'Initial paid amount is 0');
    assert.strictEqual(cpInit.work_status, 'contract_awarded');
    assert.strictEqual(cpInit.claim_status, 'draft');
    assert(cpInit.work_order_ref.includes('MIT-WO'), 'Work order reference must be generated');

    console.log(`✓ Contractor payment milestone record initialized: ${cpInit.work_order_ref}`);

    // -------------------------------------------------------------------------
    // TEST 2: Automated EMD Refund Eligibility on Award
    // -------------------------------------------------------------------------
    console.log('2. Testing Tender Award EMD Refund Assessment...');

    const emdAssess = await emdRefundService.assessEligibilityForTender({
      tenderId: tender1.id,
      userId: evalUser.id,
      ipAddress: '127.0.0.1'
    });
    assert(emdAssess.records && emdAssess.records.length >= 2, 'Must assess both contractor deposits');

    // Contractor 2 (unsuccessful) should be ELIGIBLE
    const c2Refund = await dbHelper.get(`
      SELECT * FROM emd_refund_records WHERE tender_id = ? AND contractor_id = ?
    `, [tender1.id, contractor2.id]);
    assert(c2Refund, 'Contractor 2 must have an EMD refund record');
    assert.strictEqual(c2Refund.refund_status, 'ELIGIBLE', 'Unsuccessful bidder EMD must be ELIGIBLE');
    assert.strictEqual(parseFloat(c2Refund.refund_eligible_amount), 20000.00, '100% of deposit must be eligible');

    // Contractor 1 (winning bidder) should be PENDING_REVIEW (held as performance security)
    const c1Refund = await dbHelper.get(`
      SELECT * FROM emd_refund_records WHERE tender_id = ? AND contractor_id = ?
    `, [tender1.id, contractor1.id]);
    assert(c1Refund, 'Contractor 1 must have an EMD record');
    assert.strictEqual(c1Refund.refund_status, 'PENDING_REVIEW', 'Winning bidder EMD held pending performance conditions');

    console.log('✓ EMD refund eligibility correctly determined for winning and unsuccessful bidders.');

    // -------------------------------------------------------------------------
    // TEST 3: Work Completion & Claim Submission with Validations
    // -------------------------------------------------------------------------
    console.log('3. Testing Contractor Claim Submission & Validation...');

    // Claim exceeding contract value must be rejected
    let overclaimCaught = false;
    try {
      await contractorPaymentService.submitWorkCompletion({
        contractorUserId: contractor1User.id,
        contractorPaymentId: cpInit.id,
        completionDate: '2026-10-15',
        claimedAmount: 1200000.00, // exceeds 950000
        invoiceRef: 'INV-2026-99',
        evidenceFileUrl: '/uploads/evidence.pdf',
        invoiceDocumentUrl: '/uploads/invoice.pdf',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      overclaimCaught = true;
      assert(err.message.includes('cannot exceed'), 'Must validate claimed amount');
    }
    assert.strictEqual(overclaimCaught, true, 'Claim exceeding contract amount was blocked');

    // Valid claim submission
    const submittedClaim = await contractorPaymentService.submitWorkCompletion({
      contractorUserId: contractor1User.id,
      contractorPaymentId: cpInit.id,
      completionDate: '2026-10-15',
      claimedAmount: 950000.00,
      invoiceRef: 'INV-MIT-LAB-01',
      invoiceDate: '2026-10-15',
      evidenceFileUrl: '/uploads/evidence_lab.pdf',
      invoiceDocumentUrl: '/uploads/inv_tax_stamped.pdf',
      remarks: 'HVAC installation and ESD vinyl flooring completed in full',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(submittedClaim.work_status, 'completion_submitted');
    assert.strictEqual(submittedClaim.claim_status, 'claim_submitted');
    assert.strictEqual(submittedClaim.invoice_ref, 'INV-MIT-LAB-01');

    console.log('✓ Contractor claim and work completion evidence submitted successfully.');

    // -------------------------------------------------------------------------
    // TEST 4: Work Inspection & Quality Audit
    // -------------------------------------------------------------------------
    console.log('4. Testing Institutional Work Inspection (Reject then Approve)...');

    // Step 4a: Inspection Rejection flow
    const rejectedInspection = await contractorPaymentService.inspectWork({
      id: cpInit.id,
      approved: false,
      inspectionNotes: 'HVAC air duct seals require pressure re-testing before sign-off',
      userId: authUser.id,
      userRole: 'authority',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(rejectedInspection.work_status, 'inspection_rejected');
    assert.strictEqual(rejectedInspection.claim_status, 'rejected');
    assert(rejectedInspection.rejection_reason.includes('HVAC air duct seals'), 'Rejection remarks saved');

    // Step 4b: Contractor re-submits after rectification
    await contractorPaymentService.submitWorkCompletion({
      contractorUserId: contractor1User.id,
      contractorPaymentId: cpInit.id,
      completionDate: '2026-10-18',
      claimedAmount: 950000.00,
      invoiceRef: 'INV-MIT-LAB-01-REV1',
      evidenceFileUrl: '/uploads/rectification_report.pdf',
      remarks: 'Duct seals re-tested and certified by OEM',
      ipAddress: '127.0.0.1'
    });

    // Step 4c: Inspector Approves Work
    const approvedInspection = await contractorPaymentService.inspectWork({
      id: cpInit.id,
      approved: true,
      inspectionNotes: 'Lab facilities inspected and approved as per CPWD specifications',
      userId: authUser.id,
      userRole: 'authority',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(approvedInspection.work_status, 'inspection_approved');
    assert.strictEqual(approvedInspection.claim_status, 'approval_pending');
    console.log('✓ Inspection rejection, resubmission, and approval workflow verified.');

    // -------------------------------------------------------------------------
    // TEST 5: Claim Approval with Deductions, Taxes, and Retention
    // -------------------------------------------------------------------------
    console.log('5. Testing Claim Approval with Statutory Adjustments...');

    // Contract = 950,000
    // Deductions = 10,000 (penalty for delayed test)
    // Taxes (TDS 2% + GST TDS 2%) = 38,000
    // Retention (5% Security Deposit) = 47,500
    // Net Approved Payable = 950,000 - 10,000 - 38,000 - 47,500 = 854,500.00
    const approvedClaim = await contractorPaymentService.approveClaim({
      id: cpInit.id,
      deductionsAmount: 10000.00,
      taxAmount: 38000.00,
      retentionAmount: 47500.00,
      approvedPayableAmount: 854500.00,
      notes: 'Net payable sanctioned post statutory TDS and 5% defect liability retention',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(approvedClaim.claim_status, 'approved');
    assert.strictEqual(parseFloat(approvedClaim.approved_payable_amount), 854500.00);
    assert.strictEqual(parseFloat(approvedClaim.deductions_amount), 10000.00);
    assert.strictEqual(parseFloat(approvedClaim.tax_amount), 38000.00);
    assert.strictEqual(parseFloat(approvedClaim.retention_amount), 47500.00);
    assert.strictEqual(parseFloat(approvedClaim.remaining_payable_amount), 854500.00);
    assert.strictEqual(parseFloat(approvedClaim.total_paid_amount), 0.00);

    console.log('✓ Claim approved with decimal-safe statutory deductions & retention.');

    // -------------------------------------------------------------------------
    // TEST 6: External Bank Disbursements (Partial, Overpayment Defense & Full Settlement)
    // -------------------------------------------------------------------------
    console.log('6. Testing External Bank Disbursements & Anti-Overpayment Protections...');

    // Disbursement 1: Partial payment of 400,000 via NEFT
    const tx1Res = await contractorPaymentService.recordPaymentTransaction({
      id: cpInit.id,
      amount: 400000.00,
      paymentMethod: 'neft',
      transactionRef: 'NEFT-MIT-SBI-984201',
      paymentDate: '2026-10-19',
      bankName: 'State Bank of India - MIT Branch',
      bankAccountLast4: '4092',
      notes: 'Part payment against Running Bill #1',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(tx1Res.claimStatus, 'partially_paid');
    assert.strictEqual(parseFloat(tx1Res.totalPaid), 400000.00);
    assert.strictEqual(parseFloat(tx1Res.remainingLiability), 454500.00); // 854500 - 400000

    // Test: Overpayment attempt (> 454500) must be rejected
    let overpaymentCaught = false;
    try {
      await contractorPaymentService.recordPaymentTransaction({
        id: cpInit.id,
        amount: 500000.00, // exceeds 454500
        paymentMethod: 'rtgs',
        transactionRef: 'RTGS-EXCEED-TEST',
        paymentDate: '2026-10-20',
        userId: adminUser.id,
        userRole: 'admin',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      overpaymentCaught = true;
      assert(err.message.includes('exceeds the remaining approved liability'), 'Must block overpayment');
    }
    assert.strictEqual(overpaymentCaught, true, 'Disbursement exceeding remaining payable balance blocked');

    // Test: Duplicate transaction reference (UTR) must be rejected
    let duplicateUtrCaught = false;
    try {
      await contractorPaymentService.recordPaymentTransaction({
        id: cpInit.id,
        amount: 50000.00,
        paymentMethod: 'neft',
        transactionRef: 'NEFT-MIT-SBI-984201', // identical to tx1
        paymentDate: '2026-10-20',
        userId: adminUser.id,
        userRole: 'admin',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      duplicateUtrCaught = true;
      assert(err.message.includes('already been recorded'), 'Must enforce unique transaction references');
    }
    assert.strictEqual(duplicateUtrCaught, true, 'Duplicate bank transaction UTR prevented');

    // Disbursement 2: Final settlement of remaining 454,500 via RTGS
    const tx2Res = await contractorPaymentService.recordPaymentTransaction({
      id: cpInit.id,
      amount: 454500.00,
      paymentMethod: 'rtgs',
      transactionRef: 'RTGS-MIT-SBI-772109',
      paymentDate: '2026-10-20',
      bankName: 'State Bank of India - MIT Branch',
      bankAccountLast4: '4092',
      notes: 'Final settlement against certified completion',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(tx2Res.claimStatus, 'fully_paid');
    assert.strictEqual(parseFloat(tx2Res.totalPaid), 854500.00);
    assert.strictEqual(parseFloat(tx2Res.remainingLiability), 0.00);

    // Attempting further payment on a fully paid contract must fail
    let paidContractError = false;
    try {
      await contractorPaymentService.recordPaymentTransaction({
        id: cpInit.id,
        amount: 1000.00,
        paymentMethod: 'cheque',
        transactionRef: 'CHQ-102938',
        paymentDate: '2026-10-21',
        userId: adminUser.id,
        userRole: 'admin',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      paidContractError = true;
    }
    assert.strictEqual(paidContractError, true, 'Cannot disburse further payments on fully settled contract');

    console.log('✓ Partial payment, overpayment defense, unique UTR check, and final settlement verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Payment Disbursement Voucher PDF Generation
    // -------------------------------------------------------------------------
    console.log('7. Testing Institutional Contractor Payment Voucher PDF...');

    const paymentRecord = await contractorPaymentService.getPaymentByIdInternal(cpInit.id);
    const voucherStream = new PassThrough();
    generateContractorPaymentVoucherPdf(paymentRecord, null, voucherStream);
    const voucherBuffer = await streamToBuffer(voucherStream);

    assert(voucherBuffer.length > 1000, 'Voucher PDF buffer must have meaningful size');
    assert(voucherBuffer.toString('utf8', 0, 5) === '%PDF-', 'Must be a valid PDF binary');
    console.log(`✓ Official MIT Payment Disbursement Voucher PDF generated (${voucherBuffer.length} bytes).`);

    // -------------------------------------------------------------------------
    // TEST 8: EMD Refund Review, Over-Refund Defense, and Approval
    // -------------------------------------------------------------------------
    console.log('8. Testing EMD Refund Review & Approval Protections...');

    // Attempting to approve an amount exceeding original EMD must fail
    let overRefundCaught = false;
    try {
      await emdRefundService.approveRefund({
        id: c2Refund.id,
        approvedAmount: 30000.00, // exceeds 20,000 EMD
        notes: 'Excess refund test',
        userId: adminUser.id,
        userRole: 'admin',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      overRefundCaught = true;
      assert(err.message.includes('cannot exceed'), 'Must validate approved refund limit');
    }
    assert.strictEqual(overRefundCaught, true, 'Approved refund exceeding original EMD was blocked');

    // Valid approval
    const approvedRefund = await emdRefundService.approveRefund({
      id: c2Refund.id,
      approvedAmount: 20000.00,
      notes: 'Sanctioned for return to unsuccessful bidder',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(approvedRefund.refund_status, 'APPROVED');
    assert.strictEqual(parseFloat(approvedRefund.refund_amount), 20000.00);

    console.log('✓ EMD refund approved within strict balance limit.');

    // -------------------------------------------------------------------------
    // TEST 9: EMD Forfeiture with Mandatory Reason
    // -------------------------------------------------------------------------
    console.log('9. Testing EMD Deposit Forfeiture with Mandatory Audit Reason...');

    // Forfeiture without reason must fail
    let emptyReasonCaught = false;
    try {
      await emdRefundService.forfeitRefund({
        id: c1Refund.id,
        reason: '   ',
        userId: adminUser.id,
        userRole: 'admin',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      emptyReasonCaught = true;
      assert(err.message.includes('reason is mandatory'), 'Must require forfeiture reason');
    }
    assert.strictEqual(emptyReasonCaught, true, 'Forfeiture without reason blocked');

    // Valid forfeiture
    const forfeitedEmd = await emdRefundService.forfeitRefund({
      id: c1Refund.id,
      reason: 'Contractor failed to sign agreement within 15 calendar days of Letter of Award as per Clause 14.2',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(forfeitedEmd.refund_status, 'FORFEITED');
    assert(forfeitedEmd.forfeiture_reason.includes('Clause 14.2'), 'Forfeiture reason retained');

    console.log('✓ EMD forfeiture executed with immutable statutory reason.');

    // -------------------------------------------------------------------------
    // TEST 10: EMD Settlement Execution (External Bank Transfer & Duplicate Block)
    // -------------------------------------------------------------------------
    console.log('10. Testing EMD Settlement Execution & Idempotency...');

    const settledRefund = await emdRefundService.processRefund({
      id: c2Refund.id,
      executionType: 'BANK_TRANSFER',
      transactionRef: 'NEFT-EMD-RET-2026-0089',
      bankName: 'State Bank of India - MIT Institutional Account',
      notes: 'Returned via RTGS/NEFT to vendor designated bank account',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });

    assert.strictEqual(settledRefund.refundStatus, 'COMPLETED');
    assert.strictEqual(settledRefund.transactionRef, 'NEFT-EMD-RET-2026-0089');

    const dbRefund = await emdRefundService.getRefundByIdInternal(c2Refund.id);
    assert.strictEqual(dbRefund.refund_status, 'COMPLETED');
    assert(dbRefund.processed_at, 'Completion timestamp must be set');

    // Attempting to re-execute completed refund returns alreadyCompleted idempotently
    const secondExec = await emdRefundService.processRefund({
      id: c2Refund.id,
      executionType: 'BANK_TRANSFER',
      transactionRef: 'NEFT-DUP-TRY',
      bankName: 'SBI',
      userId: adminUser.id,
      userRole: 'admin',
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(secondExec.alreadyCompleted, true, 'Second execution returns alreadyCompleted idempotently');

    console.log('✓ EMD refund executed and duplicate settlement strictly prevented.');

    // -------------------------------------------------------------------------
    // TEST 11: EMD Official Advice Slip PDF Generation
    // -------------------------------------------------------------------------
    console.log('11. Testing Official EMD Advice Slip PDF Generation...');

    const refundRecord2 = await emdRefundService.getRefundByIdInternal(c2Refund.id);
    const adviceStream = new PassThrough();
    generateEmdRefundAdvicePdf(refundRecord2, adviceStream);
    const adviceBuffer = await streamToBuffer(adviceStream);

    assert(adviceBuffer.length > 1000, 'Advice slip PDF buffer must have meaningful size');
    assert(adviceBuffer.toString('utf8', 0, 5) === '%PDF-', 'Must be a valid PDF binary');

    // Also test PDF generation for forfeited deposit
    const refundRecord1 = await emdRefundService.getRefundByIdInternal(c1Refund.id);
    const forfStream = new PassThrough();
    generateEmdRefundAdvicePdf(refundRecord1, forfStream);
    const forfBuffer = await streamToBuffer(forfStream);
    assert(forfBuffer.length > 1000, 'Forfeiture advice slip PDF must generate cleanly');

    console.log(`✓ Official EMD Advice Slips generated for settlement (${adviceBuffer.length}b) & forfeiture (${forfBuffer.length}b).`);

    // -------------------------------------------------------------------------
    // TEST 12: Cancelled Tender EMD Assessment Flow
    // -------------------------------------------------------------------------
    console.log('12. Testing Cancelled Tender EMD Mass Assessment...');

    // Create a tender and cancel it
    const tender2 = await dbHelper.get(`
      INSERT INTO tenders (
        tender_code, title, description, department, estimated_budget,
        tender_fee, emd_amount, submission_deadline, opening_date, status, created_by
      ) VALUES (
        'MIT/IT/2026/044', 'Smart Campus Wi-Fi 6 Upgrade', 'Campus-wide enterprise AP rollout',
        'Computer Engineering', 500000.00, 1000.00, 10000.00,
        NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 'cancelled', ?
      ) RETURNING id
    `, [authUser.id]);

    // Pay EMD by Contractor 2
    await dbHelper.run(`
      INSERT INTO payments (
        tender_id, user_id, contractor_id, payment_type, payment_mode, amount, amount_rupees,
        payment_status, receipt_no, provider_payment_id
      ) VALUES (
        ?, ?, ?, 'EMD', 'test', 1000000, 10000.00, 'PAID', 'REC-EMD-003', 'pay_test_rzp_003'
      )
    `, [tender2.id, contractor2User.id, contractor2.id]);

    const cancelAssess = await emdRefundService.assessEligibilityForTender({
      tenderId: tender2.id,
      userId: adminUser.id,
      ipAddress: '127.0.0.1'
    });
    assert.strictEqual(cancelAssess.records.length, 1);

    const cancelledRefundRecord = await dbHelper.get(`
      SELECT * FROM emd_refund_records WHERE tender_id = ? AND contractor_id = ?
    `, [tender2.id, contractor2.id]);
    assert.strictEqual(cancelledRefundRecord.refund_status, 'ELIGIBLE');
    assert.strictEqual(cancelledRefundRecord.eligibility_type, 'TENDER_CANCELLED');

    console.log('✓ Cancelled tender EMD refund eligibility correctly mass-assessed.');

    // -------------------------------------------------------------------------
    // TEST 13: Financial Audit Trail Integrity
    // -------------------------------------------------------------------------
    console.log('13. Testing Append-Only Financial Audit Trail...');

    const auditLogs = await dbHelper.all(`
      SELECT * FROM financial_audit_logs
      WHERE entity_type IN ('CONTRACTOR_PAYMENT', 'CONTRACTOR_PAYMENT_TXN', 'EMD_REFUND')
      ORDER BY id ASC
    `);

    assert(auditLogs.length >= 8, 'Financial actions must produce audit trail entries');

    const actions = auditLogs.map(a => a.action);
    assert(actions.includes('CONTRACT_PAYMENT_INITIALIZED'), 'CONTRACT_PAYMENT_INITIALIZED must be logged');
    assert(actions.includes('WORK_COMPLETION_CLAIM_SUBMITTED'), 'WORK_COMPLETION_CLAIM_SUBMITTED must be logged');
    assert(actions.includes('WORK_INSPECTION_APPROVED'), 'WORK_INSPECTION_APPROVED must be logged');
    assert(actions.includes('PAYMENT_CLAIM_APPROVED'), 'PAYMENT_CLAIM_APPROVED must be logged');
    assert(actions.includes('DISBURSEMENT_RECORDED'), 'DISBURSEMENT_RECORDED must be logged');
    assert(actions.includes('EMD_FORFEITURE_RECORDED'), 'EMD_FORFEITURE_RECORDED must be logged');
    assert(actions.includes('EMD_REFUND_PROCESSED'), 'EMD_REFUND_PROCESSED must be logged');

    console.log(`✓ Financial audit trail verified: ${auditLogs.length} immutable records logged.`);

    // -------------------------------------------------------------------------
    // TEST 14: Contractor IDOR Isolation & Unauthorized Access Defense
    // -------------------------------------------------------------------------
    console.log('14. Testing Contractor IDOR Security & Cross-Vendor Isolation...');

    // Contractor 2 attempting to view Contractor 1's payment record
    let c2ViewC1PaymentBlocked = false;
    try {
      await contractorPaymentService.getPaymentById({
        id: cpInit.id,
        user: { id: contractor2User.id, role: 'contractor' }
      });
    } catch (err) {
      c2ViewC1PaymentBlocked = true;
      assert.strictEqual(err.status, 403, 'Must return 403 Forbidden for cross-vendor access');
    }
    assert.strictEqual(c2ViewC1PaymentBlocked, true, 'Contractor A cannot view Contractor B payment data');

    // Contractor 2 attempting to submit a claim for Contractor 1's contract
    let c2ClaimC1Blocked = false;
    try {
      await contractorPaymentService.submitWorkCompletion({
        contractorUserId: contractor2User.id, // Contractor 2
        contractorPaymentId: cpInit.id,       // Awarded to Contractor 1
        completionDate: '2026-10-21',
        claimedAmount: 50000.00,
        invoiceRef: 'INV-HACK-01',
        ipAddress: '127.0.0.1'
      });
    } catch (err) {
      c2ClaimC1Blocked = true;
      assert.strictEqual(err.status, 403, 'Must return 403 Forbidden for unauthorized claim');
    }
    assert.strictEqual(c2ClaimC1Blocked, true, 'Contractor A cannot submit claim on Contractor B contract');

    // Contractor 1 attempting to view Contractor 2's EMD refund record
    let c1ViewC2RefundBlocked = false;
    try {
      await emdRefundService.getRefundById({
        id: c2Refund.id,
        user: { id: contractor1User.id, role: 'contractor' }
      });
    } catch (err) {
      c1ViewC2RefundBlocked = true;
      assert.strictEqual(err.status, 403, 'Must return 403 Forbidden for cross-vendor refund view');
    }
    assert.strictEqual(c1ViewC2RefundBlocked, true, 'Contractor A cannot view Contractor B EMD refund advice');

    console.log('✓ Strict IDOR isolation verified across all payment and refund endpoints.');

    // -------------------------------------------------------------------------
    // TEST 15: Financial Liabilities & Procurement Report Calculations
    // -------------------------------------------------------------------------
    console.log('15. Testing Financial Reports Liability Calculations & Reconciliations...');

    const cpStats = await contractorPaymentService.getAdminPaymentStats();
    assert.strictEqual(cpStats.totalAwardedContracts, 1);
    assert.strictEqual(parseFloat(cpStats.totalApprovedPayable), 854500.00);
    assert.strictEqual(parseFloat(cpStats.totalPaidToDate), 854500.00);
    assert.strictEqual(parseFloat(cpStats.remainingLiability), 0.00);
    assert.strictEqual(cpStats.fullyPaidContracts, 1);

    const emdStats = await emdRefundService.getAdminRefundStats();
    // 3 deposits: 20k + 20k + 10k = 50,000
    assert.strictEqual(parseFloat(emdStats.totalEmdCollectedRupees), 50000.00);
    assert.strictEqual(parseFloat(emdStats.totalRefundedRupees), 20000.00);
    assert.strictEqual(parseFloat(emdStats.totalForfeitedRupees), 20000.00);
    assert.strictEqual(emdStats.refundsCompletedCount, 1);
    assert.strictEqual(emdStats.forfeituresCount, 1);

    console.log('✓ Financial ledger metrics reconciled with 100% decimal precision.');

    // -------------------------------------------------------------------------
    // Restore pristine seed state
    // -------------------------------------------------------------------------
    console.log('\nRestoring clean seed state...');
    await seedAccounts();
    console.log('✓ Seed completed: Database clean.');

    console.log('\n========================================================================');
    console.log('  ALL FINANCIAL MODULE TESTS PASSED (15/15) ✓');
    console.log('  CONTRACTOR DISBURSEMENTS & EMD REFUNDS FULLY VALIDATED');
    console.log('========================================================================\n');

  } catch (err) {
    console.error('\n❌ Financial Module Test Failed:', err);
    process.exit(1);
  }
}

runFinancialModuleTests().then(() => {
  process.exit(0);
});
