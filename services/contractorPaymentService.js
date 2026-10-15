/**
 * Contractor Payment Management Service
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Payment Direction: Institution -> Selected Contractor
 * Enforces server-side financial validations, PostgreSQL transactions,
 * role-based approvals, and append-only financial audit trails.
 */

const { dbHelper, logFinancialAudit } = require('../database/db');

class ContractorPaymentService {
  /**
   * Generates a formal Work Order Reference (e.g., MIT-WO-2026-104)
   */
  _generateWorkOrderRef(tenderCode, id) {
    const year = new Date().getFullYear();
    const cleanTenderCode = (tenderCode || 'TND').replace(/[^a-zA-Z0-9]/g, '');
    return `MIT-WO-${cleanTenderCode}-${year}-${id}`;
  }

  /**
   * Initializes or fetches a contractor payment milestone record for an awarded tender.
   * Can be triggered when tender is awarded, or when admin sets up contract payment.
   */
  async initializeContractPayment({ tenderId, adminUserId, ipAddress }) {
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      const error = new Error(`Tender #${tenderId} does not exist.`);
      error.status = 404;
      throw error;
    }

    if (tender.status !== 'awarded' || !tender.awarded_to_contractor_id) {
      const error = new Error(`Tender ${tender.tender_code} has not been awarded to a contractor yet.`);
      error.status = 400;
      throw error;
    }

    // Check if record already exists
    const existing = await dbHelper.get(
      'SELECT * FROM contractor_payments WHERE tender_id = ? AND contractor_id = ?',
      [tenderId, tender.awarded_to_contractor_id]
    );

    if (existing) {
      return existing;
    }

    // Find the winning bid to get the exact accepted contract quotation
    const winningBid = await dbHelper.get(`
      SELECT b.*, c.company_name, c.license_number, c.gst_number
      FROM bids b
      JOIN contractors c ON b.contractor_id = c.id
      WHERE b.tender_id = ? AND b.contractor_id = ? AND b.status = 'awarded'
    `, [tenderId, tender.awarded_to_contractor_id]);

    const contractAmount = winningBid ? parseFloat(winningBid.bid_amount) : parseFloat(tender.estimated_budget);

    // Initial Work Order reference
    const countRow = await dbHelper.get('SELECT COUNT(*) as count FROM contractor_payments');
    const seq = Number(countRow.count) + 1;
    const workOrderRef = this._generateWorkOrderRef(tender.tender_code, seq);

    const result = await dbHelper.run(`
      INSERT INTO contractor_payments (
        tender_id, contractor_id, work_order_ref, contract_amount,
        deductions_amount, tax_amount, retention_amount,
        approved_payable_amount, total_paid_amount, remaining_payable_amount,
        work_status, claim_status
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, 0, ?, 'contract_awarded', 'draft')
    `, [
      tenderId,
      tender.awarded_to_contractor_id,
      workOrderRef,
      contractAmount,
      contractAmount, // initially approved payable matches contract before claim review
      contractAmount  // initially remaining matches contract
    ]);

    const paymentId = result.lastID;

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: paymentId,
      action: 'CONTRACT_PAYMENT_INITIALIZED',
      previousState: null,
      newState: 'contract_awarded',
      actorId: adminUserId,
      actorRole: 'admin',
      amount: contractAmount,
      details: `Initialized contractor contract ${workOrderRef} for awarded tender ${tender.tender_code} at contract value ₹${contractAmount.toLocaleString('en-IN')}`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(paymentId);
  }

  /**
   * Retrieves single payment record with full relations (internal helper)
   */
  async getPaymentByIdInternal(id) {
    return await dbHelper.get(`
      SELECT cp.*,
             t.tender_code, t.title as tender_title, t.department, t.estimated_budget, t.status as tender_status,
             c.company_name, c.license_number, c.gst_number, c.user_id as contractor_user_id,
             u.name as contractor_rep_name, u.email as contractor_email, u.phone as contractor_phone,
             ins.name as inspected_by_name,
             appr.name as approved_by_name
      FROM contractor_payments cp
      JOIN tenders t ON cp.tender_id = t.id
      JOIN contractors c ON cp.contractor_id = c.id
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users ins ON cp.inspected_by = ins.id
      LEFT JOIN users appr ON cp.approved_by = appr.id
      WHERE cp.id = ?
    `, [id]);
  }

  /**
   * Contractor: Submit work completion and invoice claim
   */
  async submitWorkCompletion({
    contractorUserId,
    contractorPaymentId,
    completionDate,
    remarks,
    evidenceFileUrl,
    invoiceRef,
    invoiceDate,
    claimedAmount,
    invoiceDocumentUrl,
    ipAddress
  }) {
    const payment = await this.getPaymentByIdInternal(contractorPaymentId);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    // Ownership verification
    if (payment.contractor_user_id !== contractorUserId) {
      const error = new Error('Forbidden: You can only submit claims for contracts awarded to your business.');
      error.status = 403;
      throw error;
    }

    if (payment.claim_status === 'fully_paid') {
      const error = new Error('This contract has already been fully paid and settled.');
      error.status = 400;
      throw error;
    }

    const parsedClaimedAmount = claimedAmount ? parseFloat(claimedAmount) : parseFloat(payment.contract_amount);
    if (isNaN(parsedClaimedAmount) || parsedClaimedAmount <= 0) {
      const error = new Error('Claimed amount must be a positive number.');
      error.status = 400;
      throw error;
    }

    if (parsedClaimedAmount > parseFloat(payment.contract_amount)) {
      const error = new Error(`Claimed amount (₹${parsedClaimedAmount.toLocaleString('en-IN')}) cannot exceed total contract value (₹${parseFloat(payment.contract_amount).toLocaleString('en-IN')}).`);
      error.status = 400;
      throw error;
    }

    const previousWorkStatus = payment.work_status;
    const previousClaimStatus = payment.claim_status;

    await dbHelper.run(`
      UPDATE contractor_payments SET
        work_status = 'completion_submitted',
        claim_status = 'claim_submitted',
        claimed_amount = ?,
        invoice_ref = COALESCE(?, invoice_ref),
        invoice_date = COALESCE(?, invoice_date, CURRENT_TIMESTAMP),
        work_completion_date = COALESCE(?, CURRENT_TIMESTAMP),
        completion_evidence_url = COALESCE(?, completion_evidence_url),
        invoice_document_url = COALESCE(?, invoice_document_url),
        remarks = COALESCE(?, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      parsedClaimedAmount,
      invoiceRef || null,
      invoiceDate || null,
      completionDate || null,
      evidenceFileUrl || null,
      invoiceDocumentUrl || null,
      remarks || null,
      contractorPaymentId
    ]);

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: contractorPaymentId,
      action: 'WORK_COMPLETION_CLAIM_SUBMITTED',
      previousState: `${previousWorkStatus}|${previousClaimStatus}`,
      newState: 'completion_submitted|claim_submitted',
      actorId: contractorUserId,
      actorRole: 'contractor',
      amount: parsedClaimedAmount,
      details: `Contractor submitted work completion & invoice claim #${invoiceRef || 'N/A'} for ₹${parsedClaimedAmount.toLocaleString('en-IN')}`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(contractorPaymentId);
  }

  /**
   * Authority/Admin: Update work status (e.g. work_in_progress, inspection_pending)
   */
  async updateWorkStatus({ id, status, notes, userId, userRole, ipAddress }) {
    const validStatuses = [
      'contract_awarded',
      'work_in_progress',
      'completion_submitted',
      'inspection_pending',
      'inspection_approved',
      'inspection_rejected',
      'disputed'
    ];

    if (!validStatuses.includes(status)) {
      const error = new Error(`Invalid work status: ${status}. Valid options: ${validStatuses.join(', ')}`);
      error.status = 400;
      throw error;
    }

    const payment = await this.getPaymentByIdInternal(id);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    const previousStatus = payment.work_status;

    await dbHelper.run(`
      UPDATE contractor_payments SET
        work_status = ?,
        remarks = COALESCE(?, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, notes || null, id]);

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: id,
      action: 'WORK_STATUS_UPDATED',
      previousState: previousStatus,
      newState: status,
      actorId: userId,
      actorRole: userRole,
      amount: null,
      details: `Work status transitioned from ${previousStatus} to ${status}. Notes: ${notes || 'None'}`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(id);
  }

  /**
   * Authority/Admin: Inspect work and record inspection decision
   */
  async inspectWork({ id, approved, inspectionNotes, userId, userRole, ipAddress }) {
    const payment = await this.getPaymentByIdInternal(id);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    if (!inspectionNotes || inspectionNotes.trim().length === 0) {
      const error = new Error('Inspection notes and observations are required.');
      error.status = 400;
      throw error;
    }

    const newWorkStatus = approved ? 'inspection_approved' : 'inspection_rejected';
    const newClaimStatus = approved ? 'approval_pending' : 'rejected';
    const previousStatus = payment.work_status;

    await dbHelper.run(`
      UPDATE contractor_payments SET
        work_status = ?,
        claim_status = ?,
        inspection_date = CURRENT_TIMESTAMP,
        inspection_notes = ?,
        inspected_by = ?,
        rejection_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      newWorkStatus,
      newClaimStatus,
      inspectionNotes,
      userId,
      approved ? null : inspectionNotes,
      id
    ]);

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: id,
      action: approved ? 'WORK_INSPECTION_APPROVED' : 'WORK_INSPECTION_REJECTED',
      previousState: previousStatus,
      newState: newWorkStatus,
      actorId: userId,
      actorRole: userRole,
      amount: null,
      details: approved
        ? `Work completion certified & approved by inspection committee: ${inspectionNotes}`
        : `Work inspection rejected by committee: ${inspectionNotes}`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(id);
  }

  /**
   * Authority/Admin: Approve payment claim, recording applicable deductions, taxes, retention
   * Strictly calculates: Approved Payable Amount = Contract Amount - Deductions - Taxes - Retention
   * Remaining Payable Amount = Approved Payable Amount - Total Successfully Paid Amount
   */
  async approveClaim({
    id,
    deductionsAmount = 0,
    taxAmount = 0,
    retentionAmount = 0,
    approvedPayableAmount = null,
    notes,
    userId,
    userRole,
    ipAddress
  }) {
    const payment = await this.getPaymentByIdInternal(id);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    if (payment.work_status !== 'inspection_approved') {
      const error = new Error(`Cannot approve payment claim before work completion inspection is approved (Current work status: ${payment.work_status}).`);
      error.status = 400;
      throw error;
    }

    const contractAmt = parseFloat(payment.contract_amount);
    const deductions = Math.max(0, parseFloat(deductionsAmount) || 0);
    const tax = Math.max(0, parseFloat(taxAmount) || 0);
    const retention = Math.max(0, parseFloat(retentionAmount) || 0);

    const calculatedPayable = contractAmt - deductions - tax - retention;
    if (calculatedPayable < 0) {
      const error = new Error(`Total deductions, tax, and retention (₹${(deductions + tax + retention).toLocaleString('en-IN')}) exceed the contract value (₹${contractAmt.toLocaleString('en-IN')}).`);
      error.status = 400;
      throw error;
    }

    // Use explicit approved payable if provided, but clamp strictly to <= contractAmt
    let finalApprovedPayable = approvedPayableAmount !== null && approvedPayableAmount !== undefined
      ? parseFloat(approvedPayableAmount)
      : calculatedPayable;

    if (isNaN(finalApprovedPayable) || finalApprovedPayable <= 0) {
      const error = new Error('Approved payable amount must be greater than zero.');
      error.status = 400;
      throw error;
    }

    if (finalApprovedPayable > contractAmt) {
      const error = new Error(`Approved payable amount (₹${finalApprovedPayable.toLocaleString('en-IN')}) cannot exceed agreed contract value (₹${contractAmt.toLocaleString('en-IN')}).`);
      error.status = 400;
      throw error;
    }

    const totalPaid = parseFloat(payment.total_paid_amount || 0);
    if (finalApprovedPayable < totalPaid) {
      const error = new Error(`Approved payable amount cannot be less than already disbursed amount (₹${totalPaid.toLocaleString('en-IN')}).`);
      error.status = 400;
      throw error;
    }

    const remainingPayable = parseFloat((finalApprovedPayable - totalPaid).toFixed(2));
    const newClaimStatus = remainingPayable === 0 ? 'fully_paid' : (totalPaid > 0 ? 'partially_paid' : 'approved');

    await dbHelper.run(`
      UPDATE contractor_payments SET
        deductions_amount = ?,
        tax_amount = ?,
        retention_amount = ?,
        approved_payable_amount = ?,
        remaining_payable_amount = ?,
        claim_status = ?,
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP,
        rejection_reason = NULL,
        remarks = COALESCE(?, remarks),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      deductions,
      tax,
      retention,
      finalApprovedPayable,
      remainingPayable,
      newClaimStatus,
      userId,
      notes || null,
      id
    ]);

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: id,
      action: 'PAYMENT_CLAIM_APPROVED',
      previousState: payment.claim_status,
      newState: newClaimStatus,
      actorId: userId,
      actorRole: userRole,
      amount: finalApprovedPayable,
      details: `Approved payable amount: ₹${finalApprovedPayable.toLocaleString('en-IN')} (Deductions: ₹${deductions}, Tax: ₹${tax}, Retention: ₹${retention}, Remaining: ₹${remainingPayable})`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(id);
  }

  /**
   * Authority/Admin: Reject payment claim with reason
   */
  async rejectClaim({ id, reason, userId, userRole, ipAddress }) {
    if (!reason || reason.trim().length === 0) {
      const error = new Error('A detailed reason for rejection is required.');
      error.status = 400;
      throw error;
    }

    const payment = await this.getPaymentByIdInternal(id);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    if (payment.claim_status === 'fully_paid') {
      const error = new Error('Cannot reject an already fully paid contract.');
      error.status = 400;
      throw error;
    }

    await dbHelper.run(`
      UPDATE contractor_payments SET
        claim_status = 'rejected',
        rejection_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason, id]);

    await logFinancialAudit({
      entityType: 'CONTRACTOR_PAYMENT',
      entityId: id,
      action: 'PAYMENT_CLAIM_REJECTED',
      previousState: payment.claim_status,
      newState: 'rejected',
      actorId: userId,
      actorRole: userRole,
      amount: null,
      details: `Payment claim rejected. Reason: ${reason}`,
      ipAddress
    });

    return await this.getPaymentByIdInternal(id);
  }

  /**
   * Authority/Admin: Record an externally executed payment disbursement (e.g., NEFT/RTGS/IMPS/Cheque)
   * Uses PostgreSQL transaction to atomically lock record, validate balance, insert transaction,
   * update disbursed totals, and log financial audit event.
   */
  async recordPaymentTransaction({
    id,
    amount,
    paymentMethod,
    transactionRef,
    paymentDate,
    bankName,
    bankAccountLast4,
    notes,
    supportingDocUrl,
    userId,
    userRole,
    ipAddress
  }) {
    // 1. Input validations
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      const error = new Error('Disbursed payment amount must be a positive number.');
      error.status = 400;
      throw error;
    }

    if (!transactionRef || transactionRef.trim().length === 0) {
      const error = new Error('Transaction reference (Bank UTR / Cheque Number) is mandatory.');
      error.status = 400;
      throw error;
    }

    const validMethods = ['bank_transfer', 'neft', 'rtgs', 'imps', 'cheque', 'razorpay_payout', 'other'];
    const normMethod = (paymentMethod || 'bank_transfer').toLowerCase().trim();
    if (!validMethods.includes(normMethod)) {
      const error = new Error(`Invalid payment method: ${paymentMethod}. Allowed: ${validMethods.join(', ')}`);
      error.status = 400;
      throw error;
    }

    // 2. Check duplicate transaction reference before transaction
    const dupCheck = await dbHelper.get(
      'SELECT id FROM contractor_payment_transactions WHERE transaction_ref = ?',
      [transactionRef.trim()]
    );
    if (dupCheck) {
      const error = new Error(`Transaction reference "${transactionRef}" has already been recorded in SmartTender. Duplicate payments are strictly prevented.`);
      error.status = 400;
      throw error;
    }

    // 3. PostgreSQL Transaction with Row Lock
    return await dbHelper.transaction(async (tx) => {
      const paymentRow = await tx.get(
        'SELECT * FROM contractor_payments WHERE id = ? FOR UPDATE',
        [id]
      );

      if (!paymentRow) {
        const error = new Error('Contract payment record not found.');
        error.status = 404;
        throw error;
      }

      if (!['approved', 'partially_paid'].includes(paymentRow.claim_status)) {
        const error = new Error(`Cannot record payment disbursement. Claim must be in 'approved' or 'partially_paid' status (Current: ${paymentRow.claim_status}).`);
        error.status = 400;
        throw error;
      }

      const remainingPayable = parseFloat(paymentRow.remaining_payable_amount);
      if (parsedAmount > remainingPayable) {
        const error = new Error(`Disbursement amount (₹${parsedAmount.toLocaleString('en-IN')}) exceeds the remaining approved liability (₹${remainingPayable.toLocaleString('en-IN')}).`);
        error.status = 400;
        throw error;
      }

      const pmtDate = paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString();

      // Insert transaction record
      const txnResult = await tx.run(`
        INSERT INTO contractor_payment_transactions (
          contractor_payment_id, tender_id, contractor_id, transaction_ref,
          payment_method, amount, payment_date, execution_type, payment_status,
          bank_name, bank_account_last4, processed_by, supporting_doc_url, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL_RECORD', 'COMPLETED', ?, ?, ?, ?, ?)
      `, [
        id,
        paymentRow.tender_id,
        paymentRow.contractor_id,
        transactionRef.trim(),
        normMethod,
        parsedAmount,
        pmtDate,
        bankName || 'Institution Bank Account',
        bankAccountLast4 || null,
        userId,
        supportingDocUrl || null,
        notes || null
      ]);

      const txnId = txnResult.lastID;

      // Update contractor_payments amounts
      const newTotalPaid = parseFloat((parseFloat(paymentRow.total_paid_amount) + parsedAmount).toFixed(2));
      const newRemaining = parseFloat((parseFloat(paymentRow.approved_payable_amount) - newTotalPaid).toFixed(2));
      const newClaimStatus = newRemaining <= 0 ? 'fully_paid' : 'partially_paid';

      await tx.run(`
        UPDATE contractor_payments SET
          total_paid_amount = ?,
          remaining_payable_amount = ?,
          claim_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        newTotalPaid,
        newRemaining,
        newClaimStatus,
        id
      ]);

      // Financial Audit Log
      await logFinancialAudit({
        entityType: 'CONTRACTOR_PAYMENT_TXN',
        entityId: txnId,
        action: 'DISBURSEMENT_RECORDED',
        previousState: paymentRow.claim_status,
        newState: newClaimStatus,
        actorId: userId,
        actorRole: userRole,
        amount: parsedAmount,
        details: `Recorded ${normMethod.toUpperCase()} disbursement of ₹${parsedAmount.toLocaleString('en-IN')} (Ref: ${transactionRef}). Remaining liability: ₹${newRemaining}`,
        ipAddress,
        tx
      });

      return {
        success: true,
        transactionId: txnId,
        transactionRef: transactionRef.trim(),
        disbursedAmount: parsedAmount,
        totalPaid: newTotalPaid,
        remainingLiability: newRemaining,
        claimStatus: newClaimStatus
      };
    });
  }

  /**
   * Contractor: Returns all payments/claims belonging to authenticated contractor
   */
  async getContractorPayments({ contractorUserId, tenderId = null }) {
    const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [contractorUserId]);
    if (!contractor) {
      return [];
    }

    let sql = `
      SELECT cp.*,
             t.tender_code, t.title as tender_title, t.department, t.estimated_budget,
             (SELECT COUNT(*) FROM contractor_payment_transactions WHERE contractor_payment_id = cp.id) as transaction_count,
             (SELECT MAX(payment_date) FROM contractor_payment_transactions WHERE contractor_payment_id = cp.id) as last_payment_date
      FROM contractor_payments cp
      JOIN tenders t ON cp.tender_id = t.id
      WHERE cp.contractor_id = ?
    `;
    const params = [contractor.id];

    if (tenderId) {
      sql += ' AND cp.tender_id = ?';
      params.push(tenderId);
    }

    sql += ' ORDER BY cp.created_at DESC';
    return await dbHelper.all(sql, params);
  }

  /**
   * Admin/Authority: Returns paginated contractor claims with comprehensive filtering
   */
  async getAdminContractorPayments({
    page = 1,
    limit = 20,
    claimStatus,
    workStatus,
    tenderId,
    contractorId,
    search
  }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (claimStatus) {
      whereClause += ' AND cp.claim_status = ?';
      params.push(claimStatus);
    }
    if (workStatus) {
      whereClause += ' AND cp.work_status = ?';
      params.push(workStatus);
    }
    if (tenderId) {
      whereClause += ' AND cp.tender_id = ?';
      params.push(tenderId);
    }
    if (contractorId) {
      whereClause += ' AND cp.contractor_id = ?';
      params.push(contractorId);
    }
    if (search) {
      whereClause += ' AND (cp.work_order_ref LIKE ? OR cp.invoice_ref LIKE ? OR t.tender_code LIKE ? OR c.company_name LIKE ?)';
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    const countRow = await dbHelper.get(`
      SELECT COUNT(*) as count
      FROM contractor_payments cp
      JOIN tenders t ON cp.tender_id = t.id
      JOIN contractors c ON cp.contractor_id = c.id
      ${whereClause}
    `, params);

    const totalRecords = parseInt(countRow.count, 10) || 0;

    const sql = `
      SELECT cp.*,
             t.tender_code, t.title as tender_title, t.department,
             c.company_name, c.license_number, c.gst_number,
             ins.name as inspected_by_name,
             appr.name as approved_by_name,
             (SELECT COUNT(*) FROM contractor_payment_transactions WHERE contractor_payment_id = cp.id) as transaction_count,
             (SELECT MAX(payment_date) FROM contractor_payment_transactions WHERE contractor_payment_id = cp.id) as last_payment_date
      FROM contractor_payments cp
      JOIN tenders t ON cp.tender_id = t.id
      JOIN contractors c ON cp.contractor_id = c.id
      LEFT JOIN users ins ON cp.inspected_by = ins.id
      LEFT JOIN users appr ON cp.approved_by = appr.id
      ${whereClause}
      ORDER BY cp.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const records = await dbHelper.all(sql, [...params, limitNum, offset]);

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
   * Detail view of single contract payment with transactions and audit log
   */
  async getPaymentById({ id, user }) {
    const payment = await this.getPaymentByIdInternal(id);
    if (!payment) {
      const error = new Error('Contract payment record not found.');
      error.status = 404;
      throw error;
    }

    // Role security
    if (user.role === 'contractor') {
      if (payment.contractor_user_id !== user.id) {
        const error = new Error('Forbidden: You are not authorized to view this payment record.');
        error.status = 403;
        throw error;
      }
    } else if (user.role !== 'admin' && user.role !== 'authority' && user.role !== 'evaluator') {
      const error = new Error('Forbidden: Unauthorized role.');
      error.status = 403;
      throw error;
    }

    const transactions = await dbHelper.all(`
      SELECT cpt.*, u.name as processed_by_name
      FROM contractor_payment_transactions cpt
      LEFT JOIN users u ON cpt.processed_by = u.id
      WHERE cpt.contractor_payment_id = ?
      ORDER BY cpt.payment_date DESC
    `, [id]);

    const auditHistory = await dbHelper.all(`
      SELECT fal.*, u.name as actor_name
      FROM financial_audit_logs fal
      LEFT JOIN users u ON fal.actor_id = u.id
      WHERE (fal.entity_type = 'CONTRACTOR_PAYMENT' AND fal.entity_id = ?)
         OR (fal.entity_type = 'CONTRACTOR_PAYMENT_TXN' AND fal.entity_id IN (
              SELECT id FROM contractor_payment_transactions WHERE contractor_payment_id = ?
            ))
      ORDER BY fal.created_at DESC
    `, [id, id]);

    return {
      payment,
      transactions,
      auditHistory
    };
  }

  /**
   * Returns list of awarded tenders eligible for contract payments
   */
  async getAwardedTendersEligibleForPayment({ contractorUserId = null }) {
    let sql = `
      SELECT t.id, t.tender_code, t.title, t.department, t.estimated_budget, t.award_date,
             c.id as contractor_id, c.company_name, c.license_number, c.gst_number,
             b.bid_amount as awarded_amount,
             cp.id as contractor_payment_id, cp.work_status, cp.claim_status,
             cp.approved_payable_amount, cp.total_paid_amount, cp.remaining_payable_amount
      FROM tenders t
      JOIN contractors c ON t.awarded_to_contractor_id = c.id
      LEFT JOIN bids b ON b.tender_id = t.id AND b.contractor_id = c.id AND b.status = 'awarded'
      LEFT JOIN contractor_payments cp ON cp.tender_id = t.id AND cp.contractor_id = c.id
      WHERE t.status = 'awarded'
    `;
    const params = [];

    if (contractorUserId) {
      sql += ' AND c.user_id = ?';
      params.push(contractorUserId);
    }

    sql += ' ORDER BY t.award_date DESC';
    return await dbHelper.all(sql, params);
  }

  /**
   * Admin Analytics for Contractor Payments
   */
  async getAdminPaymentStats() {
    const stats = await dbHelper.get(`
      SELECT
        COUNT(*) as total_contracts,
        COALESCE(SUM(contract_amount), 0) as total_contract_value,
        COALESCE(SUM(approved_payable_amount), 0) as total_approved_payable,
        COALESCE(SUM(total_paid_amount), 0) as total_disbursed_amount,
        COALESCE(SUM(remaining_payable_amount), 0) as total_remaining_liability,
        SUM(CASE WHEN claim_status = 'claim_submitted' OR claim_status = 'approval_pending' THEN 1 ELSE 0 END) as pending_claims_count,
        SUM(CASE WHEN work_status = 'completion_submitted' OR work_status = 'inspection_pending' THEN 1 ELSE 0 END) as pending_inspections_count,
        SUM(CASE WHEN claim_status = 'fully_paid' THEN 1 ELSE 0 END) as fully_paid_count,
        SUM(CASE WHEN claim_status = 'partially_paid' THEN 1 ELSE 0 END) as partially_paid_count
      FROM contractor_payments
    `);

    return {
      totalContracts: parseInt(stats.total_contracts, 10) || 0,
      totalAwardedContracts: parseInt(stats.total_contracts, 10) || 0,
      totalContractValue: parseFloat(stats.total_contract_value) || 0,
      totalApprovedPayable: parseFloat(stats.total_approved_payable) || 0,
      totalDisbursedAmount: parseFloat(stats.total_disbursed_amount) || 0,
      totalPaidToDate: parseFloat(stats.total_disbursed_amount) || 0,
      totalRemainingLiability: parseFloat(stats.total_remaining_liability) || 0,
      remainingLiability: parseFloat(stats.total_remaining_liability) || 0,
      pendingClaimsCount: parseInt(stats.pending_claims_count, 10) || 0,
      pendingInspectionsCount: parseInt(stats.pending_inspections_count, 10) || 0,
      fullyPaidCount: parseInt(stats.fully_paid_count, 10) || 0,
      fullyPaidContracts: parseInt(stats.fully_paid_count, 10) || 0,
      partiallyPaidCount: parseInt(stats.partially_paid_count, 10) || 0
    };
  }
}

const contractorPaymentService = new ContractorPaymentService();

module.exports = contractorPaymentService;
