/**
 * Contractor Payment Controller
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const contractorPaymentService = require('../services/contractorPaymentService');
const { generateContractorPaymentVoucherPdf } = require('../utils/paymentVoucherGenerator');

class ContractorPaymentController {
  /**
   * POST /api/contractor-payments/initialize
   * Admin/Authority: Initialize contract payment milestone for an awarded tender
   */
  async initialize(req, res) {
    try {
      const { tender_id } = req.body;
      if (!tender_id) {
        return res.status(400).json({ success: false, message: 'Tender ID is required.' });
      }

      const result = await contractorPaymentService.initializeContractPayment({
        tenderId: parseInt(tender_id, 10),
        adminUserId: req.user.id,
        ipAddress: req.ip
      });

      res.status(201).json({ success: true, contractPayment: result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/awarded-tenders
   * Returns awarded tenders eligible for contract payments
   */
  async getAwardedTenders(req, res) {
    try {
      const contractorUserId = req.user.role === 'contractor' ? req.user.id : null;
      const tenders = await contractorPaymentService.getAwardedTendersEligibleForPayment({
        contractorUserId
      });

      res.json({ success: true, tenders });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/claims
   * Contractor: Submit work completion and invoice payment claim
   */
  async submitClaim(req, res) {
    try {
      const {
        contractor_payment_id,
        completion_date,
        remarks,
        invoice_ref,
        invoice_date,
        claimed_amount
      } = req.body;

      if (!contractor_payment_id) {
        return res.status(400).json({ success: false, message: 'Contract payment ID is required.' });
      }

      let evidenceFileUrl = null;
      let invoiceDocumentUrl = null;

      if (req.files) {
        if (req.files.evidence && req.files.evidence[0]) {
          evidenceFileUrl = `/uploads/${req.files.evidence[0].filename}`;
        }
        if (req.files.invoice && req.files.invoice[0]) {
          invoiceDocumentUrl = `/uploads/${req.files.invoice[0].filename}`;
        }
      }

      const updated = await contractorPaymentService.submitWorkCompletion({
        contractorUserId: req.user.id,
        contractorPaymentId: parseInt(contractor_payment_id, 10),
        completionDate: completion_date,
        remarks,
        evidenceFileUrl,
        invoiceRef,
        invoiceDate,
        claimedAmount,
        invoiceDocumentUrl,
        ipAddress: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'Work completion and invoice claim submitted successfully for institutional inspection!',
        contractPayment: updated
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/:id/work-status
   * Authority/Admin: Transition work status
   */
  async updateWorkStatus(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, notes } = req.body;

      const updated = await contractorPaymentService.updateWorkStatus({
        id,
        status,
        notes,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({ success: true, message: `Work status updated to ${status}.`, contractPayment: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/:id/inspect
   * Authority/Admin: Record work inspection decision
   */
  async inspectWork(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { approved, inspection_notes } = req.body;

      const updated = await contractorPaymentService.inspectWork({
        id,
        approved: approved === true || approved === 'true',
        inspectionNotes: inspection_notes,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({
        success: true,
        message: approved ? 'Work completion inspection approved!' : 'Work inspection rejected.',
        contractPayment: updated
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/:id/approve
   * Authority/Admin: Approve payment claim with deductions, taxes, and retention
   */
  async approveClaim(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        deductions_amount,
        tax_amount,
        retention_amount,
        approved_payable_amount,
        notes
      } = req.body;

      const updated = await contractorPaymentService.approveClaim({
        id,
        deductionsAmount: deductions_amount,
        taxAmount: tax_amount,
        retentionAmount: retention_amount,
        approvedPayableAmount: approved_payable_amount,
        notes,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({
        success: true,
        message: 'Payment claim approved! Ready for financial disbursement.',
        contractPayment: updated
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/:id/reject
   * Authority/Admin: Reject payment claim with reason
   */
  async rejectClaim(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body;

      const updated = await contractorPaymentService.rejectClaim({
        id,
        reason,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({ success: true, message: 'Payment claim rejected.', contractPayment: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/contractor-payments/:id/record-payment
   * Authority/Admin: Record externally executed bank disbursement (NEFT/RTGS/IMPS/Cheque)
   */
  async recordPayment(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        amount,
        payment_method,
        transaction_ref,
        payment_date,
        bank_name,
        bank_account_last4,
        notes
      } = req.body;

      let supportingDocUrl = null;
      if (req.file) {
        supportingDocUrl = `/uploads/${req.file.filename}`;
      }

      const result = await contractorPaymentService.recordPaymentTransaction({
        id,
        amount,
        paymentMethod: payment_method,
        transactionRef: transaction_ref,
        paymentDate: payment_date,
        bankName: bank_name,
        bankAccountLast4: bank_account_last4,
        notes,
        supportingDocUrl,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments
   * Returns list of contractor payments for the authenticated contractor
   */
  async getContractorPayments(req, res) {
    try {
      const tenderId = req.query.tenderId ? parseInt(req.query.tenderId, 10) : null;
      const payments = await contractorPaymentService.getContractorPayments({
        contractorUserId: req.user.id,
        tenderId
      });

      res.json({ success: true, payments });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/admin/all
   * Admin/Authority: Returns paginated list of all claims with filters
   */
  async getAdminPayments(req, res) {
    try {
      const { page, limit, claimStatus, workStatus, tenderId, contractorId, search } = req.query;
      const result = await contractorPaymentService.getAdminContractorPayments({
        page,
        limit,
        claimStatus,
        workStatus,
        tenderId: tenderId ? parseInt(tenderId, 10) : null,
        contractorId: contractorId ? parseInt(contractorId, 10) : null,
        search
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/stats
   * Admin/Authority: High-level financial KPIs
   */
  async getStats(req, res) {
    try {
      const stats = await contractorPaymentService.getAdminPaymentStats();
      res.json({ success: true, stats });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/:id
   * Single payment record detail (Contractor, Authority, Admin)
   */
  async getPaymentById(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await contractorPaymentService.getPaymentById({
        id,
        user: req.user
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/:id/history
   * Audit & transaction history of a contract payment
   */
  async getPaymentHistory(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await contractorPaymentService.getPaymentById({
        id,
        user: req.user
      });

      res.json({
        success: true,
        transactions: result.transactions,
        auditHistory: result.auditHistory
      });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/contractor-payments/:id/voucher-pdf
   * Streams official MIT Payment Disbursement Voucher PDF
   */
  async getVoucherPdf(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { payment, transactions } = await contractorPaymentService.getPaymentById({
        id,
        user: req.user
      });

      const latestTransaction = transactions.length > 0 ? transactions[0] : null;
      generateContractorPaymentVoucherPdf(payment, latestTransaction, res);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }
}

const contractorPaymentController = new ContractorPaymentController();

module.exports = contractorPaymentController;
