/**
 * EMD Refund Controller
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const emdRefundService = require('../services/emdRefundService');
const { generateEmdRefundAdvicePdf } = require('../utils/paymentVoucherGenerator');

class EmdRefundController {
  /**
   * POST /api/emd-refunds/assess-eligibility
   * Admin/Authority: Assesses EMD refund eligibility for all bidders on a tender
   */
  async assessEligibility(req, res) {
    try {
      const { tender_id } = req.body;
      if (!tender_id) {
        return res.status(400).json({ success: false, message: 'Tender ID is required.' });
      }

      const result = await emdRefundService.assessEligibilityForTender({
        tenderId: parseInt(tender_id, 10),
        userId: req.user.id,
        ipAddress: req.ip
      });

      res.status(200).json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/emd-refunds/:id/approve
   * Admin/Authority: Approve EMD refund for processing
   */
  async approve(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { refund_amount, notes } = req.body;

      const updated = await emdRefundService.approveRefund({
        id,
        refundAmount: refund_amount,
        notes,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({ success: true, message: 'EMD refund approved successfully!', refund: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/emd-refunds/:id/reject
   * Admin/Authority: Reject EMD refund with reason
   */
  async reject(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body;

      const updated = await emdRefundService.rejectRefund({
        id,
        reason,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({ success: true, message: 'EMD refund rejected.', refund: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/emd-refunds/:id/forfeit
   * Admin/Authority: Forfeit EMD with mandatory recorded reason
   */
  async forfeit(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { reason } = req.body;

      const updated = await emdRefundService.forfeitRefund({
        id,
        reason,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json({ success: true, message: 'EMD security deposit marked as FORFEITED to MIT.', refund: updated });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/emd-refunds/:id/process
   * Admin/Authority: Process refund via gateway or external bank transfer recording
   */
  async process(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        execution_type,
        transaction_ref,
        bank_name,
        payment_method,
        notes
      } = req.body;

      const result = await emdRefundService.processRefund({
        id,
        executionType: execution_type,
        transactionRef: transaction_ref,
        bankName: bank_name,
        paymentMethod: payment_method,
        notes,
        userId: req.user.id,
        userRole: req.user.role,
        ipAddress: req.ip
      });

      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/emd-refunds
   * Contractor: Get own EMD refunds
   */
  async getContractorRefunds(req, res) {
    try {
      const tenderId = req.query.tenderId ? parseInt(req.query.tenderId, 10) : null;
      const refunds = await emdRefundService.getContractorEmdRefunds({
        contractorUserId: req.user.id,
        tenderId
      });

      res.json({ success: true, refunds });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/emd-refunds/admin/all
   * Admin/Authority: Paginated list of EMD refunds
   */
  async getAdminRefunds(req, res) {
    try {
      const { page, limit, status, eligibilityType, tenderId, contractorId, search } = req.query;
      const result = await emdRefundService.getAdminEmdRefunds({
        page,
        limit,
        status,
        eligibilityType,
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
   * GET /api/emd-refunds/stats
   * Admin/Authority: Summary analytics
   */
  async getStats(req, res) {
    try {
      const stats = await emdRefundService.getAdminRefundStats();
      res.json({ success: true, stats });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/emd-refunds/:id
   * Single EMD refund detail
   */
  async getRefundById(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await emdRefundService.getRefundById({
        id,
        user: req.user
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/emd-refunds/:id/history
   * Audit history of refund
   */
  async getHistory(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const result = await emdRefundService.getRefundById({
        id,
        user: req.user
      });

      res.json({ success: true, auditHistory: result.auditHistory });
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/emd-refunds/:id/voucher-pdf
   * Streams official EMD Refund Advice PDF
   */
  async getVoucherPdf(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const { refund } = await emdRefundService.getRefundById({
        id,
        user: req.user
      });

      generateEmdRefundAdvicePdf(refund, res);
    } catch (err) {
      res.status(err.status || 500).json({ success: false, message: err.message });
    }
  }
}

const emdRefundController = new EmdRefundController();

module.exports = emdRefundController;
