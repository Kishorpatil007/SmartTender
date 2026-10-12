/**
 * Payment Controller - HTTP Request Handlers
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const paymentConfig = require('../config/paymentConfig');
const paymentService = require('../services/paymentService');
const { generatePaymentReceiptPdf } = require('../utils/receiptGenerator');
const { dbHelper } = require('../database/db');

class PaymentController {
  /**
   * GET /api/payments/config
   * Returns public gateway configuration (provider, mode, keyId if configured)
   * Safely never exposes secrets.
   */
  async getConfig(req, res) {
    try {
      const config = paymentConfig.getPublicConfig();
      res.json({ success: true, config });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/payments/create-order
   * Contractor creates order for Tender Fee or EMD
   */
  async createOrder(req, res) {
    try {
      const { tenderId, paymentType } = req.validatedBody;
      const order = await paymentService.createPaymentOrder({
        userId: req.user.id,
        tenderId,
        paymentType,
        ipAddress: req.ip
      });

      res.status(201).json(order);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message,
        alreadyPaid: err.alreadyPaid || false,
        existingPayment: err.existingPayment || null
      });
    }
  }

  /**
   * POST /api/payments/verify
   * Contractor verifies Razorpay payment signature
   */
  async verifyPayment(req, res) {
    try {
      const { orderId, paymentId, signature, internalPaymentId } = req.validatedVerification;

      const result = await paymentService.verifyPayment({
        userId: req.user.id,
        orderId,
        paymentId,
        signature,
        internalPaymentId,
        ipAddress: req.ip
      });

      res.json(result);
    } catch (err) {
      const statusCode = err.status || 400;
      res.status(statusCode).json({
        success: false,
        message: err.message
      });
    }
  }

  /**
   * POST /api/payments/webhook
   * Razorpay Server-to-Server Webhook handler
   */
  async handleWebhook(req, res) {
    try {
      const result = await paymentService.handleWebhookEvent({
        rawBody: req.rawBody,
        signature: req.webhookSignature,
        eventData: req.body,
        ipAddress: req.ip
      });

      res.status(200).json(result);
    } catch (err) {
      console.error('[WEBHOOK ERROR]', err.message);
      res.status(err.status || 400).json({
        success: false,
        message: err.message
      });
    }
  }

  /**
   * GET /api/payments/history
   * Contractor payment history
   */
  async getHistory(req, res) {
    try {
      const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [req.user.id]);
      if (!contractor) {
        return res.status(404).json({ success: false, message: 'Contractor profile not found.' });
      }

      const payments = await paymentService.getContractorPayments({
        contractorId: contractor.id,
        tenderId: req.query.tenderId ? parseInt(req.query.tenderId, 10) : null
      });

      res.json({ success: true, payments });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/payments/tender/:tenderId/status
   * Status of Tender Fee and EMD for a specific tender
   */
  async getTenderStatus(req, res) {
    try {
      const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [req.user.id]);
      if (!contractor) {
        return res.status(404).json({ success: false, message: 'Contractor profile not found.' });
      }

      const tenderId = parseInt(req.params.tenderId, 10);
      const status = await paymentService.getTenderPaymentStatus({
        contractorId: contractor.id,
        tenderId
      });

      res.json({ success: true, ...status });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/payments/:id
   * Single payment details (Authorized user only)
   */
  async getPaymentById(req, res) {
    try {
      const paymentId = parseInt(req.params.id, 10);
      const payment = await paymentService.getPaymentById({
        paymentId,
        user: req.user
      });

      res.json({ success: true, payment });
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/payments/:id/receipt-pdf
   * Streams official receipt PDF
   */
  async getReceiptPdf(req, res) {
    try {
      const paymentId = parseInt(req.params.id, 10);
      const payment = await paymentService.getPaymentById({
        paymentId,
        user: req.user
      });

      if (payment.payment_status !== 'PAID') {
        return res.status(400).send('Receipts can only be generated for verified PAID transactions.');
      }

      generatePaymentReceiptPdf(payment, res);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/admin/payments
   * Admin: List payments with filtering, search & pagination
   */
  async getAdminPayments(req, res) {
    try {
      const {
        page,
        limit,
        tenderId,
        contractorId,
        paymentType,
        status,
        mode,
        startDate,
        endDate,
        search
      } = req.query;

      const result = await paymentService.getAdminPayments({
        page,
        limit,
        tenderId: tenderId ? parseInt(tenderId, 10) : null,
        contractorId: contractorId ? parseInt(contractorId, 10) : null,
        paymentType,
        status,
        mode,
        startDate,
        endDate,
        search
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/admin/payments/stats
   * Admin: Summary financial metrics
   */
  async getAdminStats(req, res) {
    try {
      const stats = await paymentService.getAdminPaymentStats();
      res.json({ success: true, stats });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/payments/:id/refund
   * Admin: Process refund
   */
  async processRefund(req, res) {
    try {
      const paymentId = parseInt(req.params.id, 10);
      const { reason } = req.body;

      const result = await paymentService.processRefund({
        paymentId,
        adminUserId: req.user.id,
        reason,
        ipAddress: req.ip
      });

      res.json(result);
    } catch (err) {
      const statusCode = err.status || 500;
      res.status(statusCode).json({ success: false, message: err.message });
    }
  }
}

const paymentController = new PaymentController();

module.exports = paymentController;
