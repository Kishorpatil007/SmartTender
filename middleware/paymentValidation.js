/**
 * Payment Input Validation & Rate Limiting Middleware
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const { createRateLimiter } = require('./rateLimiter');

// Rate limiter for order creation & verification endpoints (Prevents brute force / order flooding)
const paymentRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 requests per 15 minutes per IP
  message: 'Payment Rate Limit: Too many payment requests from this network. Please wait a few moments.'
});

// Rate limiter specifically for webhooks
const webhookRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 120, // 120 webhook events per minute
  message: 'Webhook Rate Limit: High incoming webhook volume.'
});

/**
 * Validates request to create a payment order
 */
const validateCreateOrder = (req, res, next) => {
  const { tender_id, payment_type } = req.body;

  if (!tender_id) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: tender_id is required.'
    });
  }

  const parsedTenderId = parseInt(tender_id, 10);
  if (isNaN(parsedTenderId) || parsedTenderId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: tender_id must be a valid positive integer.'
    });
  }

  if (!payment_type) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: payment_type is required (Must be "TENDER_FEE" or "EMD").'
    });
  }

  const normalizedType = String(payment_type).toUpperCase().trim();
  if (!['TENDER_FEE', 'EMD'].includes(normalizedType)) {
    return res.status(400).json({
      success: false,
      message: `Validation Error: Invalid payment_type "${payment_type}". Allowed types are: TENDER_FEE, EMD.`
    });
  }

  req.validatedBody = {
    tenderId: parsedTenderId,
    paymentType: normalizedType
  };

  next();
};

/**
 * Validates request to verify a payment
 */
const validateVerifyPayment = (req, res, next) => {
  const {
    provider_order_id,
    provider_payment_id,
    provider_signature,
    payment_id
  } = req.body;

  const orderId = provider_order_id || req.body.razorpay_order_id;
  const paymentId = provider_payment_id || req.body.razorpay_payment_id;
  const signature = provider_signature || req.body.razorpay_signature;

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: provider_order_id, provider_payment_id, and provider_signature are required for signature verification.'
    });
  }

  req.validatedVerification = {
    orderId: String(orderId).trim(),
    paymentId: String(paymentId).trim(),
    signature: String(signature).trim(),
    internalPaymentId: payment_id ? parseInt(payment_id, 10) : null
  };

  next();
};

/**
 * Validates incoming webhook payload & signature header
 */
const validateWebhook = (req, res, next) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    return res.status(400).json({
      success: false,
      message: 'Security Alert: Missing x-razorpay-signature header on incoming webhook.'
    });
  }

  if (!req.rawBody) {
    return res.status(400).json({
      success: false,
      message: 'Internal Error: Raw request body not available for cryptographic webhook signature verification.'
    });
  }

  req.webhookSignature = signature;
  next();
};

module.exports = {
  paymentRateLimiter,
  webhookRateLimiter,
  validateCreateOrder,
  validateVerifyPayment,
  validateWebhook
};
