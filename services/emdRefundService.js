/**
 * EMD Refund Management Service
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Payment Direction: Institution -> Eligible Contractor
 * Enforces refund eligibility rules, forfeiture recording,
 * automated Razorpay gateway refunds or safe manual external bank transfer records,
 * and immutable financial audit trails.
 */

const { dbHelper, logFinancialAudit } = require('../database/db');
const paymentConfig = require('../config/paymentConfig');
const paymentGateway = require('./paymentGateway');

class EmdRefundService {
  /**
   * Internal helper to fetch refund record with all joined details
   */
  async getRefundByIdInternal(id) {
    return await dbHelper.get(`
      SELECT err.*,
             p.receipt_no, p.amount as payment_paise, p.amount_rupees as paid_rupees,
             p.provider_order_id, p.provider_payment_id, p.payment_mode, p.paid_at as payment_date,
             t.tender_code, t.title as tender_title, t.department, t.status as tender_status,
             c.company_name, c.license_number, c.gst_number, c.user_id as contractor_user_id,
             u.name as contractor_rep_name, u.email as contractor_email, u.phone as contractor_phone,
             appr.name as approved_by_name,
             proc.name as processed_by_name
      FROM emd_refund_records err
      JOIN payments p ON err.original_payment_id = p.id
      JOIN tenders t ON err.tender_id = t.id
      JOIN contractors c ON err.contractor_id = c.id
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users appr ON err.approved_by = appr.id
      LEFT JOIN users proc ON err.processed_by = proc.id
      WHERE err.id = ?
    `, [id]);
  }

  /**
   * Assesses and creates EMD refund eligibility records for all bidders on a tender
   * Handles:
   * 1. Unsuccessful bidders on awarded tenders (status -> ELIGIBLE)
   * 2. Bidders on cancelled tenders (status -> ELIGIBLE)
   * 3. Successful bidder on awarded tender (status -> PENDING_REVIEW, release conditions apply)
   */
  async assessEligibilityForTender({ tenderId, userId, ipAddress }) {
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      const error = new Error(`Tender #${tenderId} does not exist.`);
      error.status = 404;
      throw error;
    }

    // Find all paid EMD payments for this tender
    const emdPayments = await dbHelper.all(`
      SELECT p.*, c.company_name, b.status as bid_status
      FROM payments p
      JOIN contractors c ON p.contractor_id = c.id
      LEFT JOIN bids b ON b.tender_id = p.tender_id AND b.contractor_id = p.contractor_id
      WHERE p.tender_id = ? AND p.payment_type = 'EMD' AND p.payment_status = 'PAID'
    `, [tenderId]);

    if (emdPayments.length === 0) {
      return {
        success: true,
        message: `No verified EMD payments found for Tender ${tender.tender_code}.`,
        assessedCount: 0,
        records: []
      };
    }

    const createdRecords = [];

    for (const emd of emdPayments) {
      // Check if refund record already exists
      const existing = await dbHelper.get(
        'SELECT * FROM emd_refund_records WHERE original_payment_id = ?',
        [emd.id]
      );

      if (existing) {
        createdRecords.push(existing);
        continue;
      }

      let eligibilityType = 'OTHER';
      let refundStatus = 'PENDING_REVIEW';
      let eligibilityNotes = '';
      const emdAmount = parseFloat(emd.amount_rupees);

      const isWinner = tender.status === 'awarded' && Number(tender.awarded_to_contractor_id) === Number(emd.contractor_id);

      if (tender.status === 'cancelled') {
        eligibilityType = 'TENDER_CANCELLED';
        refundStatus = 'ELIGIBLE';
        eligibilityNotes = `Tender ${tender.tender_code} was officially cancelled by MIT Administration. Full EMD refund is eligible.`;
      } else if (isWinner) {
        eligibilityType = 'SUCCESSFUL_BIDDER_RELEASE';
        refundStatus = 'PENDING_REVIEW';
        eligibilityNotes = `Winning contractor EMD is held as initial security deposit; eligible for release upon submission of Performance Bank Guarantee (PBG) or work contract completion.`;
      } else if (tender.status === 'awarded') {
        eligibilityType = 'UNSUCCESSFUL_BIDDER';
        refundStatus = 'ELIGIBLE';
        eligibilityNotes = `Commercial bid not awarded for tender ${tender.tender_code}. Unsuccessful bidder is eligible for 100% EMD refund as per tender guidelines.`;
      } else {
        eligibilityType = 'OTHER';
        refundStatus = 'PENDING_REVIEW';
        eligibilityNotes = `Tender status is ${tender.status.toUpperCase()}. EMD eligibility subject to committee evaluation.`;
      }

      const res = await dbHelper.run(`
        INSERT INTO emd_refund_records (
          original_payment_id, tender_id, contractor_id,
          original_emd_amount, refund_eligible_amount, refund_amount,
          eligibility_type, eligibility_notes, eligibility_date, refund_status,
          requested_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
      `, [
        emd.id,
        tenderId,
        emd.contractor_id,
        emdAmount,
        emdAmount,
        emdAmount,
        eligibilityType,
        eligibilityNotes,
        refundStatus,
        userId
      ]);

      const recordId = res.lastID;

      await logFinancialAudit({
        entityType: 'EMD_REFUND',
        entityId: recordId,
        action: 'EMD_ELIGIBILITY_ASSESSED',
        previousState: null,
        newState: refundStatus,
        actorId: userId,
        actorRole: 'admin',
        amount: emdAmount,
        details: `Assessed EMD refund eligibility for contractor ${emd.company_name} on tender ${tender.tender_code}: ${eligibilityType} (${refundStatus})`,
        ipAddress
      });

      const fullRecord = await this.getRefundByIdInternal(recordId);
      createdRecords.push(fullRecord);
    }

    return {
      success: true,
      message: `Assessed EMD refund eligibility for ${createdRecords.length} bidder(s) on tender ${tender.tender_code}.`,
      assessedCount: createdRecords.length,
      records: createdRecords
    };
  }

  /**
   * Authority/Admin: Approve EMD refund for disbursement
   */
  async approveRefund({ id, refundAmount = null, approvedAmount = null, notes = null, userId, userRole, ipAddress }) {
    const refund = await this.getRefundByIdInternal(id);
    if (!refund) {
      const error = new Error('EMD refund record not found.');
      error.status = 404;
      throw error;
    }

    if (refund.refund_status === 'COMPLETED') {
      const error = new Error('This refund has already been completed.');
      error.status = 400;
      throw error;
    }

    if (refund.refund_status === 'FORFEITED') {
      const error = new Error('This deposit has been marked as FORFEITED and cannot be approved without administrative override.');
      error.status = 400;
      throw error;
    }

    const originalEmd = parseFloat(refund.original_emd_amount);
    const eligibleAmt = parseFloat(refund.refund_eligible_amount);
    const rawAmt = approvedAmount !== null && approvedAmount !== undefined ? approvedAmount : refundAmount;
    const finalRefundAmt = rawAmt !== null && rawAmt !== undefined
      ? parseFloat(rawAmt)
      : eligibleAmt;

    if (isNaN(finalRefundAmt) || finalRefundAmt <= 0) {
      const error = new Error('Refund amount must be a positive number.');
      error.status = 400;
      throw error;
    }

    if (finalRefundAmt > originalEmd) {
      const error = new Error(`Refund amount (₹${finalRefundAmt.toLocaleString('en-IN')}) cannot exceed the originally paid EMD deposit (₹${originalEmd.toLocaleString('en-IN')}).`);
      error.status = 400;
      throw error;
    }

    await dbHelper.run(`
      UPDATE emd_refund_records SET
        refund_amount = ?,
        refund_status = 'APPROVED',
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP,
        remarks = COALESCE(?, remarks),
        rejection_reason = NULL,
        forfeiture_reason = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      finalRefundAmt,
      userId,
      notes || null,
      id
    ]);

    await logFinancialAudit({
      entityType: 'EMD_REFUND',
      entityId: id,
      action: 'EMD_REFUND_APPROVED',
      previousState: refund.refund_status,
      newState: 'APPROVED',
      actorId: userId,
      actorRole: userRole,
      amount: finalRefundAmt,
      details: `Approved EMD refund of ₹${finalRefundAmt.toLocaleString('en-IN')} for ${refund.company_name} on tender ${refund.tender_code}. Notes: ${notes || 'None'}`,
      ipAddress
    });

    return await this.getRefundByIdInternal(id);
  }

  /**
   * Authority/Admin: Reject EMD refund with reason
   */
  async rejectRefund({ id, reason, userId, userRole, ipAddress }) {
    if (!reason || reason.trim().length === 0) {
      const error = new Error('A detailed reason for rejecting the EMD refund is required.');
      error.status = 400;
      throw error;
    }

    const refund = await this.getRefundByIdInternal(id);
    if (!refund) {
      const error = new Error('EMD refund record not found.');
      error.status = 404;
      throw error;
    }

    if (refund.refund_status === 'COMPLETED') {
      const error = new Error('Cannot reject an already completed refund.');
      error.status = 400;
      throw error;
    }

    await dbHelper.run(`
      UPDATE emd_refund_records SET
        refund_status = 'REJECTED',
        rejection_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason, id]);

    await logFinancialAudit({
      entityType: 'EMD_REFUND',
      entityId: id,
      action: 'EMD_REFUND_REJECTED',
      previousState: refund.refund_status,
      newState: 'REJECTED',
      actorId: userId,
      actorRole: userRole,
      amount: null,
      details: `EMD refund rejected for ${refund.company_name} on tender ${refund.tender_code}. Reason: ${reason}`,
      ipAddress
    });

    return await this.getRefundByIdInternal(id);
  }

  /**
   * Authority/Admin: Forfeit EMD with mandatory recorded reason
   * Do not automatically forfeit; requires administrative review.
   */
  async forfeitRefund({ id, reason, userId, userRole, ipAddress }) {
    if (!reason || reason.trim().length === 0) {
      const error = new Error('A valid institutional reason is mandatory when marking an EMD as forfeited (e.g., failure to execute contract or fraudulent proposal).');
      error.status = 400;
      throw error;
    }

    const refund = await this.getRefundByIdInternal(id);
    if (!refund) {
      const error = new Error('EMD refund record not found.');
      error.status = 404;
      throw error;
    }

    if (refund.refund_status === 'COMPLETED') {
      const error = new Error('Cannot forfeit an already completed refund.');
      error.status = 400;
      throw error;
    }

    await dbHelper.run(`
      UPDATE emd_refund_records SET
        refund_status = 'FORFEITED',
        forfeiture_reason = ?,
        refund_amount = 0,
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason, userId, id]);

    await logFinancialAudit({
      entityType: 'EMD_REFUND',
      entityId: id,
      action: 'EMD_FORFEITURE_RECORDED',
      previousState: refund.refund_status,
      newState: 'FORFEITED',
      actorId: userId,
      actorRole: userRole,
      amount: parseFloat(refund.original_emd_amount),
      details: `FORFEITURE ORDER: EMD of ₹${parseFloat(refund.original_emd_amount).toLocaleString('en-IN')} forfeited to MIT for contractor ${refund.company_name} on tender ${refund.tender_code}. Reason: ${reason}`,
      ipAddress
    });

    return await this.getRefundByIdInternal(id);
  }

  /**
   * Authority/Admin: Process and execute the approved EMD refund
   * Supports:
   * 1. RAZORPAY_GATEWAY: Server-side Razorpay refund API if originally captured via Razorpay
   * 2. BANK_TRANSFER: Externally executed NEFT/RTGS/IMPS/Cheque recorded by finance officer
   */
  async processRefund({
    id,
    executionType = 'BANK_TRANSFER',
    transactionRef = null,
    bankName = null,
    paymentMethod = 'bank_transfer',
    notes = null,
    userId,
    userRole,
    ipAddress
  }) {
    const refund = await this.getRefundByIdInternal(id);
    if (!refund) {
      const error = new Error('EMD refund record not found.');
      error.status = 404;
      throw error;
    }

    if (refund.refund_status === 'COMPLETED') {
      return {
        success: true,
        alreadyCompleted: true,
        refund,
        message: `EMD refund #${id} was already successfully processed on ${new Date(refund.processed_at).toLocaleString('en-IN')}.`
      };
    }

    if (!['APPROVED', 'ELIGIBLE'].includes(refund.refund_status)) {
      const error = new Error(`Refund cannot be processed in status '${refund.refund_status}'. It must be APPROVED or ELIGIBLE.`);
      error.status = 400;
      throw error;
    }

    const refundAmount = parseFloat(refund.refund_amount || refund.refund_eligible_amount);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      const error = new Error('Invalid refund amount. Must be greater than zero.');
      error.status = 400;
      throw error;
    }

    const normExecType = (executionType || 'BANK_TRANSFER').toUpperCase().trim();

    return await dbHelper.transaction(async (tx) => {
      // Row lock
      const lockedRecord = await tx.get(
        'SELECT * FROM emd_refund_records WHERE id = ? FOR UPDATE',
        [id]
      );

      if (lockedRecord.refund_status === 'COMPLETED') {
        return { success: true, alreadyCompleted: true, refund: lockedRecord };
      }

      let finalProviderRefundId = null;
      let finalTransactionRef = transactionRef ? transactionRef.trim() : null;

      if (normExecType === 'RAZORPAY_GATEWAY') {
        // Attempt Razorpay server-side refund
        if (!refund.provider_payment_id) {
          const error = new Error('Cannot execute Razorpay Gateway refund: Original payment does not contain a valid Razorpay provider payment ID. Please use manual Bank Transfer recording.');
          error.status = 400;
          throw error;
        }

        if (!paymentConfig.isConfigured()) {
          const error = new Error('Razorpay credentials are not configured in environment. Please use manual Bank Transfer recording to record the externally executed refund.');
          error.status = 503;
          throw error;
        }

        try {
          const refundAmountPaise = Math.round(refundAmount * 100);
          const gatewayResult = await paymentGateway.createRefund({
            paymentId: refund.provider_payment_id,
            amount: refundAmountPaise,
            notes: {
              tenderCode: refund.tender_code,
              contractorName: refund.company_name,
              reason: notes || 'EMD Return by MIT Procurement Office'
            }
          });

          finalProviderRefundId = gatewayResult.id;
          finalTransactionRef = gatewayResult.id;
        } catch (err) {
          console.error('[GATEWAY REFUND ERROR]', err.message);
          const error = new Error(`Razorpay Gateway refund failed: ${err.message}. If the merchant account has insufficient balance or does not support automated API refunds, record as an external Bank Transfer.`);
          error.status = 400;
          throw error;
        }
      } else {
        // External Bank Transfer recording
        if (!finalTransactionRef || finalTransactionRef.trim().length === 0) {
          const error = new Error('Transaction reference (Bank UTR / Cheque Number) is mandatory when recording an external bank refund.');
          error.status = 400;
          throw error;
        }

        // Prevent duplicate transaction reference across refund records
        const dupCheck = await tx.get(
          'SELECT id FROM emd_refund_records WHERE transaction_ref = ? AND id != ?',
          [finalTransactionRef, id]
        );
        if (dupCheck) {
          const error = new Error(`Transaction reference "${finalTransactionRef}" has already been recorded for another refund. Duplicate transaction references are prevented.`);
          error.status = 400;
          throw error;
        }
      }

      // Update emd_refund_records
      await tx.run(`
        UPDATE emd_refund_records SET
          refund_status = 'COMPLETED',
          execution_type = ?,
          provider_refund_id = ?,
          transaction_ref = ?,
          payment_method = ?,
          processed_by = ?,
          processed_at = CURRENT_TIMESTAMP,
          remarks = COALESCE(?, remarks),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        normExecType,
        finalProviderRefundId,
        finalTransactionRef,
        paymentMethod || (normExecType === 'RAZORPAY_GATEWAY' ? 'razorpay' : 'bank_transfer'),
        userId,
        notes || null,
        id
      ]);

      // Update original payments record
      await tx.run(`
        UPDATE payments SET
          payment_status = 'REFUNDED',
          refund_reference = ?,
          refund_status = 'PROCESSED',
          refund_reason = COALESCE(?, refund_reason),
          refunded_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        finalTransactionRef,
        notes || 'EMD Refund Settled',
        refund.original_payment_id
      ]);

      // Financial Audit Log
      await logFinancialAudit({
        entityType: 'EMD_REFUND',
        entityId: id,
        action: 'EMD_REFUND_PROCESSED',
        previousState: refund.refund_status,
        newState: 'COMPLETED',
        actorId: userId,
        actorRole: userRole,
        amount: refundAmount,
        details: `Processed ${normExecType} refund of ₹${refundAmount.toLocaleString('en-IN')} for ${refund.company_name} (Ref: ${finalTransactionRef}). Original EMD Receipt: ${refund.receipt_no}`,
        ipAddress,
        tx
      });

      return {
        success: true,
        refundId: id,
        refundStatus: 'COMPLETED',
        executionType: normExecType,
        transactionRef: finalTransactionRef,
        refundAmount,
        message: `EMD refund of ₹${refundAmount.toLocaleString('en-IN')} completed successfully! Reference: ${finalTransactionRef}`
      };
    });
  }

  /**
   * Contractor: Returns EMD refund status records for authenticated contractor
   */
  async getContractorEmdRefunds({ contractorUserId, tenderId = null }) {
    const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [contractorUserId]);
    if (!contractor) {
      return [];
    }

    let sql = `
      SELECT err.*,
             p.receipt_no, p.amount_rupees as original_paid_amount, p.paid_at as deposit_date,
             t.tender_code, t.title as tender_title, t.department
      FROM emd_refund_records err
      JOIN payments p ON err.original_payment_id = p.id
      JOIN tenders t ON err.tender_id = t.id
      WHERE err.contractor_id = ?
    `;
    const params = [contractor.id];

    if (tenderId) {
      sql += ' AND err.tender_id = ?';
      params.push(tenderId);
    }

    sql += ' ORDER BY err.created_at DESC';
    return await dbHelper.all(sql, params);
  }

  /**
   * Admin/Authority: Returns paginated EMD refund records with comprehensive filtering
   */
  async getAdminEmdRefunds({
    page = 1,
    limit = 20,
    status,
    eligibilityType,
    tenderId,
    contractorId,
    search
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND err.refund_status = ?';
      params.push(status);
    }
    if (eligibilityType) {
      whereClause += ' AND err.eligibility_type = ?';
      params.push(eligibilityType);
    }
    if (tenderId) {
      whereClause += ' AND err.tender_id = ?';
      params.push(tenderId);
    }
    if (contractorId) {
      whereClause += ' AND err.contractor_id = ?';
      params.push(contractorId);
    }
    if (search) {
      whereClause += ' AND (p.receipt_no LIKE ? OR err.transaction_ref LIKE ? OR t.tender_code LIKE ? OR c.company_name LIKE ?)';
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    const countRow = await dbHelper.get(`
      SELECT COUNT(*) as count
      FROM emd_refund_records err
      JOIN payments p ON err.original_payment_id = p.id
      JOIN tenders t ON err.tender_id = t.id
      JOIN contractors c ON err.contractor_id = c.id
      ${whereClause}
    `, params);

    const totalRecords = parseInt(countRow.count, 10) || 0;

    const sql = `
      SELECT err.*,
             p.receipt_no, p.amount_rupees as original_paid_amount, p.paid_at as deposit_date,
             t.tender_code, t.title as tender_title, t.department,
             c.company_name, c.license_number, c.gst_number,
             appr.name as approved_by_name,
             proc.name as processed_by_name
      FROM emd_refund_records err
      JOIN payments p ON err.original_payment_id = p.id
      JOIN tenders t ON err.tender_id = t.id
      JOIN contractors c ON err.contractor_id = c.id
      LEFT JOIN users appr ON err.approved_by = appr.id
      LEFT JOIN users proc ON err.processed_by = proc.id
      ${whereClause}
      ORDER BY err.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const records = await dbHelper.all(sql, [...params, limitNum, offset]);

    return {
      refunds: records,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalRecords / limitNum),
        totalRecords,
        limit: limitNum
      }
    };
  }

  /**
   * Detail view of single EMD refund with audit trail
   */
  async getRefundById({ id, user }) {
    const refund = await this.getRefundByIdInternal(id);
    if (!refund) {
      const error = new Error('EMD refund record not found.');
      error.status = 404;
      throw error;
    }

    // Role check
    if (user.role === 'contractor') {
      if (refund.contractor_user_id !== user.id) {
        const error = new Error('Forbidden: You are not authorized to view this refund record.');
        error.status = 403;
        throw error;
      }
    } else if (user.role !== 'admin' && user.role !== 'authority' && user.role !== 'evaluator') {
      const error = new Error('Forbidden: Unauthorized role.');
      error.status = 403;
      throw error;
    }

    const auditHistory = await dbHelper.all(`
      SELECT fal.*, u.name as actor_name
      FROM financial_audit_logs fal
      LEFT JOIN users u ON fal.actor_id = u.id
      WHERE fal.entity_type = 'EMD_REFUND' AND fal.entity_id = ?
      ORDER BY fal.created_at DESC
    `, [id]);

    return {
      refund,
      auditHistory
    };
  }

  /**
   * Admin Analytics for EMD Refunds
   */
  async getAdminRefundStats() {
    // Total EMD collected from payments table
    const emdCollected = await dbHelper.get(`
      SELECT
        COUNT(*) as total_emd_collected_count,
        COALESCE(SUM(amount_rupees), 0) as total_emd_collected_amount
      FROM payments
      WHERE payment_type = 'EMD' AND payment_status IN ('PAID', 'REFUNDED')
    `);

    // Refund metrics from emd_refund_records
    const refundStats = await dbHelper.get(`
      SELECT
        COUNT(*) as total_assessed_records,
        COALESCE(SUM(CASE WHEN refund_status = 'ELIGIBLE' THEN refund_eligible_amount ELSE 0 END), 0) as total_eligible_amount,
        SUM(CASE WHEN refund_status = 'ELIGIBLE' THEN 1 ELSE 0 END) as eligible_count,
        COALESCE(SUM(CASE WHEN refund_status = 'PENDING_REVIEW' THEN refund_eligible_amount ELSE 0 END), 0) as pending_review_amount,
        SUM(CASE WHEN refund_status = 'PENDING_REVIEW' THEN 1 ELSE 0 END) as pending_review_count,
        COALESCE(SUM(CASE WHEN refund_status = 'APPROVED' THEN refund_amount ELSE 0 END), 0) as approved_pending_disbursement_amount,
        SUM(CASE WHEN refund_status = 'APPROVED' THEN 1 ELSE 0 END) as approved_count,
        COALESCE(SUM(CASE WHEN refund_status = 'COMPLETED' THEN refund_amount ELSE 0 END), 0) as total_refunded_amount,
        SUM(CASE WHEN refund_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_count,
        COALESCE(SUM(CASE WHEN refund_status = 'FORFEITED' THEN original_emd_amount ELSE 0 END), 0) as total_forfeited_amount,
        SUM(CASE WHEN refund_status = 'FORFEITED' THEN 1 ELSE 0 END) as forfeited_count,
        SUM(CASE WHEN refund_status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count
      FROM emd_refund_records
    `);

    return {
      totalEmdCollectedCount: parseInt(emdCollected.total_emd_collected_count, 10) || 0,
      totalEmdCollectedAmount: parseFloat(emdCollected.total_emd_collected_amount) || 0,
      totalEmdCollectedRupees: parseFloat(emdCollected.total_emd_collected_amount) || 0,
      totalAssessedRecords: parseInt(refundStats.total_assessed_records, 10) || 0,
      totalEligibleAmount: parseFloat(refundStats.total_eligible_amount) || 0,
      eligibleCount: parseInt(refundStats.eligible_count, 10) || 0,
      pendingReviewCount: parseInt(refundStats.pending_review_count, 10) || 0,
      approvedPendingDisbursementAmount: parseFloat(refundStats.approved_pending_disbursement_amount) || 0,
      approvedCount: parseInt(refundStats.approved_count, 10) || 0,
      totalRefundedAmount: parseFloat(refundStats.total_refunded_amount) || 0,
      totalRefundedRupees: parseFloat(refundStats.total_refunded_amount) || 0,
      completedCount: parseInt(refundStats.completed_count, 10) || 0,
      refundsCompletedCount: parseInt(refundStats.completed_count, 10) || 0,
      totalForfeitedAmount: parseFloat(refundStats.total_forfeited_amount) || 0,
      totalForfeitedRupees: parseFloat(refundStats.total_forfeited_amount) || 0,
      forfeitedCount: parseInt(refundStats.forfeited_count, 10) || 0,
      forfeituresCount: parseInt(refundStats.forfeited_count, 10) || 0,
      rejectedCount: parseInt(refundStats.rejected_count, 10) || 0
    };
  }
}

const emdRefundService = new EmdRefundService();

module.exports = emdRefundService;
