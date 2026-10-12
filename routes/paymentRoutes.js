/**
 * Payment API Routes
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const express = require('express');
const paymentController = require('../controllers/paymentController');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  paymentRateLimiter,
  webhookRateLimiter,
  validateCreateOrder,
  validateVerifyPayment,
  validateWebhook
} = require('../middleware/paymentValidation');

// 1. Contractor & Public Payment Router
const router = express.Router();

// Public / Authenticated gateway status
router.get('/config', paymentController.getConfig);

// Razorpay Webhook Endpoint (No JWT auth - uses cryptographic HMAC SHA256 signature verification)
router.post(
  '/webhook',
  webhookRateLimiter,
  validateWebhook,
  paymentController.handleWebhook
);

// Contractor Payment Endpoints (Protected with JWT & role='contractor')
router.post(
  '/create-order',
  verifyToken,
  requireRole('contractor'),
  paymentRateLimiter,
  validateCreateOrder,
  paymentController.createOrder
);

router.post(
  '/verify',
  verifyToken,
  requireRole('contractor'),
  paymentRateLimiter,
  validateVerifyPayment,
  paymentController.verifyPayment
);

router.get(
  '/history',
  verifyToken,
  requireRole('contractor'),
  paymentController.getHistory
);

router.get(
  '/tender/:tenderId/status',
  verifyToken,
  requireRole('contractor'),
  paymentController.getTenderStatus
);

// Payment details & PDF receipt (Contractor or Admin)
router.get(
  '/:id',
  verifyToken,
  paymentController.getPaymentById
);

router.get(
  '/:id/receipt-pdf',
  verifyToken,
  paymentController.getReceiptPdf
);

// 2. Admin Payment Management Router
const adminRouter = express.Router();

// Protect all admin payment routes
adminRouter.use(verifyToken, requireRole('admin'));

// GET /api/admin/payments/stats - Financial aggregates
adminRouter.get('/stats', paymentController.getAdminStats);

// GET /api/admin/payments - Filtered, paginated list
adminRouter.get('/', paymentController.getAdminPayments);

// POST /api/admin/payments/:id/refund - Process refund
adminRouter.post('/:id/refund', paymentController.processRefund);

module.exports = {
  paymentRouter: router,
  adminPaymentRouter: adminRouter
};
