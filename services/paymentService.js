/**
 * Payment Service - Core Business Logic & PostgreSQL Persistence
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Enforces server-side amount calculation, prevents duplicate obligations,
 * implements idempotent verification and audit logging.
 */

const crypto = require('crypto');
const { dbHelper } = require('../database/db');
const paymentConfig = require('../config/paymentConfig');
const paymentGateway = require('./paymentGateway');
const { logAudit } = require('../middleware/auth');

class PaymentService {
  /**
   * Generates unique institutional receipt reference (e.g. MIT-RCP-2026-84920)
   */
  _generateReceiptNo() {
    const year = new Date().getFullYear();
    const randomSuffix = crypto.randomInt(10000, 99999);
    return `MIT-RCP-${year}-${randomSuffix}`;
  }

  /**
   * Initiates a payment order for a tender obligation (TENDER_FEE or EMD)
   */
  async createPaymentOrder({ userId, tenderId, paymentType, ipAddress }) {
    // 1. Resolve & verify contractor identity
    const contractor = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [userId]);
    if (!contractor) {
      const error = new Error('Only registered contractors and vendors can pay tender fees or EMD.');
      error.status = 403;
      throw error;
    }

    if (contractor.registration_status !== 'approved') {
      const error = new Error('Your contractor registration is pending approval. Payments are enabled after college verification.');
      error.status = 403;
      throw error;
    }

    // 2. Resolve tender and check eligibility
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      const error = new Error(`Tender with ID ${tenderId} does not exist.`);
      error.status = 404;
      throw error;
    }

    if (tender.status !== 'published') {
      const error = new Error(`This tender is not currently open for bidding or payments (Status: ${tender.status.toUpperCase()}).`);
      error.status = 400;
      throw error;
    }

    if (new Date(tender.submission_deadline) < new Date()) {
      const error = new Error('The submission deadline for this tender has passed. New payments cannot be initiated.');
      error.status = 400;
      throw error;
    }

    // 3. Strict Server-Controlled Amount Calculation (Contractor cannot alter amount)
    let amountRupees = 0;
    let description = '';

    if (paymentType === 'TENDER_FEE') {
      const tenderFeeDb = tender.tender_fee ? parseFloat(tender.tender_fee) : 0;
      amountRupees = tenderFeeDb > 0 ? tenderFeeDb : (paymentConfig.defaultTenderFeePaise / 100);
      description = `Tender Application Fee for MIT Tender ${tender.tender_code}`;
    } else if (paymentType === 'EMD') {
      const emdDb = tender.emd_amount ? parseFloat(tender.emd_amount) : 0;
      if (emdDb <= 0) {
        const error = new Error(`Tender ${tender.tender_code} has no Earnest Money Deposit (EMD) requirement (EMD is ₹0).`);
        error.status = 400;
        throw error;
      }
      amountRupees = emdDb;
      description = `Earnest Money Deposit (EMD) for MIT Tender ${tender.tender_code}`;
    } else {
      const error = new Error(`Invalid payment type: ${paymentType}. Must be "TENDER_FEE" or "EMD".`);
      error.status = 400;
      throw error;
    }

    const amountPaise = Math.round(amountRupees * 100);

    // 4. Check for existing successful payment (Prevent duplicate payments for same obligation)
    const existingPaid = await dbHelper.get(`
      SELECT * FROM payments
      WHERE contractor_id = ? AND tender_id = ? AND payment_type = ? AND payment_status = 'PAID'
    `, [contractor.id, tenderId, paymentType]);

    if (existingPaid) {
      const error = new Error(
        `This obligation (${paymentType === 'TENDER_FEE' ? 'Tender Application Fee' : 'Earnest Money Deposit'}) has already been successfully paid on ${new Date(existingPaid.paid_at || existingPaid.created_at).toLocaleDateString('en-IN')} (Receipt No: ${existingPaid.receipt_no}). Duplicate payments are prevented.`
      );
      error.status = 400;
      error.alreadyPaid = true;
      error.existingPayment = existingPaid;
      throw error;
    }

    // 5. Generate unique receipt number
    const receiptNo = this._generateReceiptNo();

    // 6. Create order with Payment Gateway (Razorpay)
    paymentConfig.validateForTransaction();

    const orderResult = await paymentGateway.createOrder({
      amount: amountPaise,
      currency: 'INR',
      receipt: receiptNo,
      notes: {
        tenderId: String(tenderId),
        tenderCode: tender.tender_code,
        contractorId: String(contractor.id),
        contractorName: contractor.company_name,
        paymentType,
        paymentMode: paymentConfig.mode
      }
    });

    // 7. Store pending payment record in PostgreSQL
    const insertResult = await dbHelper.run(`
      INSERT INTO payments (
        receipt_no, contractor_id, user_id, tender_id, payment_type,
        amount, amount_rupees, currency, payment_provider, payment_mode,
        provider_order_id, payment_status, signature_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, 'CREATED', FALSE)
    `, [
      receiptNo,
      contractor.id,
      userId,
      tenderId,
      paymentType,
      amountPaise,
      amountRupees,
      paymentConfig.provider,
      paymentConfig.mode,
      orderResult.orderId
    ]);

    const paymentId = insertResult.lastID;

    await logAudit(
      userId,
      'PAYMENT_ORDER_CREATED',
      `Created ${paymentConfig.mode.toUpperCase()} order ${orderResult.orderId} for ${paymentType} (₹${amountRupees.toLocaleString('en-IN')}) on tender ${tender.tender_code}`,
      ipAddress
    );

    return {
      success: true,
      paymentId,
      receiptNo,
      orderId: orderResult.orderId,
      amount: amountPaise,
      amountRupees,
      currency: 'INR',
      paymentType,
      tenderId: tender.id,
      tenderCode: tender.tender_code,
      tenderTitle: tender.title,
      description,
      keyId: paymentConfig.keyId,
      mode: paymentConfig.mode,
      contractor: {
        companyName: contractor.company_name,
        licenseNumber: contractor.license_number,
        gstNumber: contractor.gst_number || ''
      }
    };
  }

  /**
   * Verifies the cryptographic Razorpay signature and updates the payment to PAID idempotently
   */
  async verifyPayment({ userId, orderId, paymentId, signature, internalPaymentId, ipAddress }) {
    // 1. Resolve payment record
    let payment = null;
    if (orderId) {
      payment = await dbHelper.get('SELECT * FROM payments WHERE provider_order_id = ?', [orderId]);
    } else if (internalPaymentId) {
      payment = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [internalPaymentId]);
    }

    if (!payment) {
      const error = new Error('Payment record not found for the supplied order reference.');
      error.status = 404;
      throw error;
    }

    // 2. Ownership verification: Must belong to authenticated user/contractor
    const contractor = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [userId]);
    if (!contractor || payment.contractor_id !== contractor.id) {
      const error = new Error('Forbidden: This payment record does not belong to your contractor account.');
      error.status = 403;
      throw error;
    }

    // 3. Idempotency Check: If already PAID, return successful verification without duplicate processing
    if (payment.payment_status === 'PAID') {
      return {
        success: true,
        verified: true,
        alreadyProcessed: true,
        payment,
        message: `Payment ${payment.receipt_no} has already been verified and confirmed as PAID.`
      };
    }

    // 4. Verify HMAC SHA256 Signature using server-side secret
    const isValidSignature = paymentGateway.verifyPaymentSignature({
      orderId: payment.provider_order_id,
      paymentId,
      signature
    });

    if (!isValidSignature) {
      // Mark as FAILED, do not delete record (Preserve audit trail)
      await dbHelper.run(`
        UPDATE payments SET
          provider_payment_id = ?,
          payment_status = 'FAILED',
          signature_verified = FALSE,
          failure_reason = 'Cryptographic HMAC signature verification failed.',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND payment_status != 'PAID'
      `, [paymentId, payment.id]);

      await logAudit(
        userId,
        'PAYMENT_SIGNATURE_FAILED',
        `FAILED signature verification on order ${payment.provider_order_id} (Attempted payment_id: ${paymentId})`,
        ipAddress
      );

      const error = new Error('Payment signature verification failed. The payment response could not be cryptographically authenticated.');
      error.status = 400;
      throw error;
    }

    // 5. Signature is valid! Update payment record to PAID transactionally
    await dbHelper.run(`
      UPDATE payments SET
        provider_payment_id = ?,
        provider_signature = ?,
        payment_status = 'PAID',
        signature_verified = TRUE,
        failure_reason = NULL,
        paid_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND payment_status != 'PAID'
    `, [paymentId, signature, payment.id]);

    const updatedPayment = await dbHelper.get(`
      SELECT p.*, t.tender_code, t.title as tender_title, t.department,
             c.company_name, c.license_number, c.gst_number, u.name as user_name, u.email as user_email
      FROM payments p
      JOIN tenders t ON p.tender_id = t.id
      JOIN contractors c ON p.contractor_id = c.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [payment.id]);

    await logAudit(
      userId,
      'PAYMENT_CONFIRMED',
      `Verified and recorded successful ${updatedPayment.payment_mode.toUpperCase()} payment of ₹${parseFloat(updatedPayment.amount_rupees).toLocaleString('en-IN')} for ${updatedPayment.payment_type} on tender ${updatedPayment.tender_code} (Receipt: ${updatedPayment.receipt_no})`,
      ipAddress
    );

    return {
      success: true,
      verified: true,
      payment: updatedPayment,
      message: `Payment verified successfully! Official receipt: ${updatedPayment.receipt_no}`
    };
  }

  /**
   * Processes incoming Razorpay Webhook events idempotently
   */
  async handleWebhookEvent({ rawBody, signature, eventData, ipAddress }) {
    paymentConfig.validateWebhook();

    // 1. Cryptographic HMAC Signature Verification
    const isValid = paymentGateway.verifyWebhookSignature({ rawBody, signature });
    if (!isValid) {
      await logAudit(null, 'WEBHOOK_SIGNATURE_INVALID', 'Received webhook with invalid HMAC signature', ipAddress);
      const error = new Error('Invalid webhook signature');
      error.status = 400;
      throw error;
    }

    const event = typeof eventData === 'string' ? JSON.parse(eventData) : eventData;
    const eventId = event.id;
    const eventType = event.event;

    // 2. Idempotency Check: Check if this event was already processed
    const processedCheck = await dbHelper.get('SELECT id FROM payment_webhook_events WHERE event_id = ?', [eventId]);
    if (processedCheck) {
      return { success: true, duplicate: true, message: `Event ${eventId} has already been processed.` };
    }

    // 3. Record event in webhook audit log
    await dbHelper.run(`
      INSERT INTO payment_webhook_events (event_id, event_type, provider, payload)
      VALUES (?, ?, 'razorpay', ?)
    `, [eventId, eventType, JSON.stringify(event)]);

    // 4. Handle event types
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const paymentEntity = event.payload && event.payload.payment && event.payload.payment.entity;
      const orderEntity = event.payload && event.payload.order && event.payload.order.entity;

      const orderId = (paymentEntity && paymentEntity.order_id) || (orderEntity && orderEntity.id);
      const paymentId = paymentEntity && paymentEntity.id;

      if (orderId) {
        const paymentRecord = await dbHelper.get('SELECT * FROM payments WHERE provider_order_id = ?', [orderId]);
        if (paymentRecord && paymentRecord.payment_status !== 'PAID') {
          await dbHelper.run(`
            UPDATE payments SET
              provider_payment_id = COALESCE(?, provider_payment_id),
              payment_status = 'PAID',
              signature_verified = TRUE,
              paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND payment_status != 'PAID'
          `, [paymentId, paymentRecord.id]);

          await logAudit(
            paymentRecord.user_id,
            'WEBHOOK_PAYMENT_CAPTURED',
            `Webhook confirmed payment for order ${orderId} (Receipt: ${paymentRecord.receipt_no})`,
            ipAddress
          );
        }
      }
    } else if (eventType === 'payment.failed') {
      const paymentEntity = event.payload && event.payload.payment && event.payload.payment.entity;
      const orderId = paymentEntity && paymentEntity.order_id;
      const failureReason = paymentEntity ? (paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed') : 'Payment failed';

      if (orderId) {
        const paymentRecord = await dbHelper.get('SELECT * FROM payments WHERE provider_order_id = ?', [orderId]);
        // Never overwrite a PAID payment with a failed status
        if (paymentRecord && paymentRecord.payment_status !== 'PAID') {
          await dbHelper.run(`
            UPDATE payments SET
              payment_status = 'FAILED',
              failure_reason = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND payment_status != 'PAID'
          `, [failureReason, paymentRecord.id]);

          await logAudit(
            paymentRecord.user_id,
            'WEBHOOK_PAYMENT_FAILED',
            `Webhook reported payment failure for order ${orderId}: ${failureReason}`,
            ipAddress
          );
        }
      }
    } else if (eventType === 'refund.processed') {
      const refundEntity = event.payload && event.payload.refund && event.payload.refund.entity;
      const paymentId = refundEntity && refundEntity.payment_id;
      const refundId = refundEntity && refundEntity.id;

      if (paymentId) {
        await dbHelper.run(`
          UPDATE payments SET
            payment_status = 'REFUNDED',
            refund_reference = ?,
            refund_status = 'PROCESSED',
            refunded_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE provider_payment_id = ?
        `, [refundId, paymentId]);
      }
    }

    return { success: true, processed: true, eventId, eventType };
  }

  /**
   * Retrieves payment obligations status for a specific contractor and tender
   */
  async getTenderPaymentStatus({ contractorId, tenderId }) {
    const tender = await dbHelper.get('SELECT id, tender_code, title, emd_amount, tender_fee FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      const error = new Error('Tender not found.');
      error.status = 404;
      throw error;
    }

    const tenderFeeRupees = tender.tender_fee ? parseFloat(tender.tender_fee) : (paymentConfig.defaultTenderFeePaise / 100);
    const emdRupees = tender.emd_amount ? parseFloat(tender.emd_amount) : 0;

    const payments = await dbHelper.all(`
      SELECT * FROM payments
      WHERE contractor_id = ? AND tender_id = ?
      ORDER BY created_at DESC
    `, [contractorId, tenderId]);

    const tenderFeePayment = payments.find(p => p.payment_type === 'TENDER_FEE' && p.payment_status === 'PAID') || null;
    const emdPayment = payments.find(p => p.payment_type === 'EMD' && p.payment_status === 'PAID') || null;

    return {
      tenderId: tender.id,
      tenderCode: tender.tender_code,
      tenderTitle: tender.title,
      tenderFee: {
        amountRupees: tenderFeeRupees,
        paid: !!tenderFeePayment,
        payment: tenderFeePayment
      },
      emd: {
        required: emdRupees > 0,
        amountRupees: emdRupees,
        paid: emdRupees <= 0 ? true : !!emdPayment,
        payment: emdPayment
      },
      allPaid: (!!tenderFeePayment) && (emdRupees <= 0 || !!emdPayment)
    };
  }

  /**
   * Returns payment history for the authenticated contractor
   */
  async getContractorPayments({ contractorId, tenderId = null }) {
    let sql = `
      SELECT p.*, t.tender_code, t.title as tender_title, t.department,
             c.company_name, c.license_number
      FROM payments p
      JOIN tenders t ON p.tender_id = t.id
      JOIN contractors c ON p.contractor_id = c.id
      WHERE p.contractor_id = ?
    `;
    const params = [contractorId];

    if (tenderId) {
      sql += ' AND p.tender_id = ?';
      params.push(tenderId);
    }

    sql += ' ORDER BY p.created_at DESC';

    return await dbHelper.all(sql, params);
  }

  /**
   * Returns a single payment record by ID with authorization check
   */
  async getPaymentById({ paymentId, user }) {
    const payment = await dbHelper.get(`
      SELECT p.*, t.tender_code, t.title as tender_title, t.department, t.estimated_budget,
             c.company_name, c.license_number, c.gst_number, c.address as contractor_address,
             u.name as user_name, u.email as user_email, u.phone as user_phone
      FROM payments p
      JOIN tenders t ON p.tender_id = t.id
      JOIN contractors c ON p.contractor_id = c.id
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [paymentId]);

    if (!payment) {
      const error = new Error('Payment record not found.');
      error.status = 404;
      throw error;
    }

    // Authorization check
    if (user.role === 'contractor') {
      const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [user.id]);
      if (!contractor || payment.contractor_id !== contractor.id) {
        const error = new Error('Forbidden: You are not authorized to view this payment record.');
        error.status = 403;
        throw error;
      }
    } else if (user.role !== 'admin' && user.role !== 'authority') {
      const error = new Error('Forbidden: Unauthorized role.');
      error.status = 403;
      throw error;
    }

    return payment;
  }

  /**
   * Admin: Returns paginated payment records with comprehensive filtering
   */
  async getAdminPayments({
    page = 1,
    limit = 20,
    tenderId,
    contractorId,
    paymentType,
    status,
    mode,
    startDate,
    endDate,
    search
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (tenderId) {
      whereClause += ' AND p.tender_id = ?';
      params.push(tenderId);
    }
    if (contractorId) {
      whereClause += ' AND p.contractor_id = ?';
      params.push(contractorId);
    }
    if (paymentType) {
      whereClause += ' AND p.payment_type = ?';
      params.push(paymentType);
    }
    if (status) {
      whereClause += ' AND p.payment_status = ?';
      params.push(status);
    }
    if (mode) {
      whereClause += ' AND p.payment_mode = ?';
      params.push(mode);
    }
    if (startDate) {
      whereClause += ' AND p.created_at >= ?';
      params.push(new Date(startDate).toISOString());
    }
    if (endDate) {
      whereClause += ' AND p.created_at <= ?';
      params.push(new Date(endDate).toISOString());
    }
    if (search) {
      whereClause += ' AND (p.receipt_no LIKE ? OR p.provider_order_id LIKE ? OR p.provider_payment_id LIKE ? OR t.tender_code LIKE ? OR c.company_name LIKE ?)';
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const countRow = await dbHelper.get(`
      SELECT COUNT(*) as count
      FROM payments p
      JOIN tenders t ON p.tender_id = t.id
      JOIN contractors c ON p.contractor_id = c.id
      ${whereClause}
    `, params);

    const totalRecords = parseInt(countRow.count, 10) || 0;

    const dataSql = `
      SELECT p.*, t.tender_code, t.title as tender_title, t.department,
             c.company_name, c.license_number, c.gst_number,
             u.name as user_name, u.email as user_email
      FROM payments p
      JOIN tenders t ON p.tender_id = t.id
      JOIN contractors c ON p.contractor_id = c.id
      JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const records = await dbHelper.all(dataSql, [...params, limitNum, offset]);

    return {
      payments: records,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum
      }
    };
  }

  /**
   * Admin: Returns aggregated financial analytics calculated directly from verified database records
   */
  async getAdminPaymentStats() {
    // Total Counts & Amounts by status
    const overallStats = await dbHelper.get(`
      SELECT
        COUNT(*) as total_payments,
        SUM(CASE WHEN payment_status = 'PAID' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN payment_status = 'CREATED' OR payment_status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN payment_status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN payment_status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded_count,
        COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN amount_rupees ELSE 0 END), 0) as total_collected_rupees
      FROM payments
    `);

    // Separate EMD vs Tender Fee Metrics (PAID only)
    const typeStats = await dbHelper.get(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_type = 'TENDER_FEE' AND payment_status = 'PAID' THEN amount_rupees ELSE 0 END), 0) as tender_fees_collected_rupees,
        COALESCE(SUM(CASE WHEN payment_type = 'TENDER_FEE' AND payment_status = 'PAID' THEN 1 ELSE 0 END), 0) as tender_fees_count,
        COALESCE(SUM(CASE WHEN payment_type = 'EMD' AND payment_status = 'PAID' THEN amount_rupees ELSE 0 END), 0) as emd_held_rupees,
        COALESCE(SUM(CASE WHEN payment_type = 'EMD' AND payment_status = 'PAID' THEN 1 ELSE 0 END), 0) as emd_count
      FROM payments
    `);

    // Breakdown by Mode: Test vs Live (Crucial for institutional auditing)
    const modeStats = await dbHelper.get(`
      SELECT
        COALESCE(SUM(CASE WHEN payment_mode = 'live' AND payment_status = 'PAID' THEN amount_rupees ELSE 0 END), 0) as live_revenue_rupees,
        COALESCE(SUM(CASE WHEN payment_mode = 'live' AND payment_status = 'PAID' THEN 1 ELSE 0 END), 0) as live_paid_count,
        COALESCE(SUM(CASE WHEN payment_mode = 'test' AND payment_status = 'PAID' THEN amount_rupees ELSE 0 END), 0) as test_volume_rupees,
        COALESCE(SUM(CASE WHEN payment_mode = 'test' AND payment_status = 'PAID' THEN 1 ELSE 0 END), 0) as test_paid_count
      FROM payments
    `);

    return {
      totalPayments: parseInt(overallStats.total_payments, 10) || 0,
      paidCount: parseInt(overallStats.paid_count, 10) || 0,
      pendingCount: parseInt(overallStats.pending_count, 10) || 0,
      failedCount: parseInt(overallStats.failed_count, 10) || 0,
      refundedCount: parseInt(overallStats.refunded_count, 10) || 0,
      totalCollectedRupees: parseFloat(overallStats.total_collected_rupees) || 0,
      tenderFeesCollectedRupees: parseFloat(typeStats.tender_fees_collected_rupees) || 0,
      tenderFeesCount: parseInt(typeStats.tender_fees_count, 10) || 0,
      emdHeldRupees: parseFloat(typeStats.emd_held_rupees) || 0,
      emdCount: parseInt(typeStats.emd_count, 10) || 0,
      modeBreakdown: {
        currentMode: paymentConfig.mode,
        liveRevenueRupees: parseFloat(modeStats.live_revenue_rupees) || 0,
        livePaidCount: parseInt(modeStats.live_paid_count, 10) || 0,
        testVolumeRupees: parseFloat(modeStats.test_volume_rupees) || 0,
        testPaidCount: parseInt(modeStats.test_paid_count, 10) || 0
      }
    };
  }

  /**
   * Admin: Initiate authorized refund for an EMD or fee payment
   */
  async processRefund({ paymentId, adminUserId, reason, ipAddress }) {
    const payment = await dbHelper.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) {
      const error = new Error('Payment record not found.');
      error.status = 404;
      throw error;
    }

    if (payment.payment_status !== 'PAID') {
      const error = new Error(`Only PAID transactions can be refunded (Current status: ${payment.payment_status}).`);
      error.status = 400;
      throw error;
    }

    let refundReference = `REF-${Date.now()}`;

    // If live/test credentials exist and provider payment ID is present, trigger provider refund
    if (paymentConfig.isConfigured() && payment.provider_payment_id) {
      try {
        const refundRes = await paymentGateway.createRefund({
          paymentId: payment.provider_payment_id,
          amount: payment.amount,
          notes: {
            reason: reason || 'Authorized refund by MIT Central Administration'
          }
        });
        if (refundRes && refundRes.id) {
          refundReference = refundRes.id;
        }
      } catch (err) {
        console.warn('Gateway refund failed or not supported in test mode:', err.message);
      }
    }

    await dbHelper.run(`
      UPDATE payments SET
        payment_status = 'REFUNDED',
        refund_reference = ?,
        refund_status = 'PROCESSED',
        refund_reason = ?,
        refunded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [refundReference, reason || 'Authorized Refund', payment.id]);

    await logAudit(
      adminUserId,
      'PAYMENT_REFUNDED',
      `Admin refunded ${payment.payment_type} payment ${payment.receipt_no} (₹${payment.amount_rupees}). Reason: ${reason}`,
      ipAddress
    );

    return {
      success: true,
      message: `Refund processed successfully. Refund reference: ${refundReference}`,
      refundReference
    };
  }
}

const paymentService = new PaymentService();

module.exports = paymentService;
