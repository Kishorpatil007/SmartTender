/**
 * Razorpay Payment Gateway Adapter & Verification Service
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Implements server-side cryptographic HMAC SHA256 signature verification,
 * HTTPS communication with Razorpay API, and safe error handling without leaking secrets.
 */

const https = require('https');
const crypto = require('crypto');
const paymentConfig = require('../config/paymentConfig');

class PaymentGateway {
  constructor() {
    this.config = paymentConfig;
  }

  /**
   * Internal helper to make HTTPS requests to Razorpay API
   */
  async _request(method, endpoint, payload = null) {
    this.config.validateForTransaction();

    const authHeader = 'Basic ' + Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64');
    const postData = payload ? JSON.stringify(payload) : null;

    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: `/v1${endpoint}`,
      method: method.toUpperCase(),
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'MIT-SmartTender-PaymentGateway/1.0.0'
      },
      timeout: 10000 // 10 second timeout
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const errMessage = (parsed && parsed.error && parsed.error.description) 
                ? parsed.error.description 
                : `Razorpay API returned status code ${res.statusCode}`;
              const error = new Error(errMessage);
              error.statusCode = res.statusCode;
              error.razorpayError = parsed.error;
              reject(error);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Razorpay API response: ${e.message}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Razorpay API request timed out (10s limit).'));
      });

      req.on('error', (err) => {
        reject(new Error(`Network error contacting Razorpay gateway: ${err.message}`));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Creates a Razorpay Order on the gateway
   * @param {Object} params
   * @param {number} params.amount - Amount in paise (integer)
   * @param {string} params.currency - Currency code (e.g. 'INR')
   * @param {string} params.receipt - Internal receipt identifier
   * @param {Object} params.notes - Metadata dictionary
   * @returns {Promise<Object>} Razorpay Order Object
   */
  async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid payment amount: ${amount}. Amount must be a positive integer in paise.`);
    }

    const payload = {
      amount,
      currency: currency || 'INR',
      receipt: String(receipt).substring(0, 40),
      notes: {
        institution: 'MIT Chhatrapati Sambhajinagar',
        ...notes
      }
    };

    const order = await this._request('POST', '/orders', payload);
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status
    };
  }

  /**
   * Cryptographically verifies the Razorpay payment signature
   * signature = HMAC_SHA256(order_id + '|' + payment_id, secret)
   * Uses timing-safe string comparison to protect against side-channel timing attacks.
   */
  verifyPaymentSignature({ orderId, paymentId, signature }) {
    if (!orderId || !paymentId || !signature) {
      return false;
    }

    if (!this.config.keySecret) {
      console.error('[SECURITY ALERT] Cannot verify signature: RAZORPAY_KEY_SECRET is not configured.');
      return false;
    }

    try {
      const generatedSignature = crypto
        .createHmac('sha256', this.config.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const genBuf = Buffer.from(generatedSignature, 'utf8');

      if (sigBuf.length !== genBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, genBuf);
    } catch (err) {
      console.error('Signature verification error:', err);
      return false;
    }
  }

  /**
   * Cryptographically verifies Razorpay Webhook signature
   * signature = HMAC_SHA256(raw_body, webhook_secret)
   */
  verifyWebhookSignature({ rawBody, signature }) {
    if (!rawBody || !signature) {
      return false;
    }

    if (!this.config.webhookSecret) {
      console.error('[SECURITY ALERT] Cannot verify webhook: RAZORPAY_WEBHOOK_SECRET is not configured.');
      return false;
    }

    try {
      const bodyPayload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      const expectedSignature = crypto
        .createHmac('sha256', this.config.webhookSecret)
        .update(bodyPayload)
        .digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');

      if (sigBuf.length !== expBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (err) {
      console.error('Webhook signature verification error:', err);
      return false;
    }
  }

  /**
   * Fetches payment details directly from Razorpay to verify capture status and amount
   */
  async fetchPayment(paymentId) {
    if (!paymentId) throw new Error('Payment ID is required to fetch payment.');
    return await this._request('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  /**
   * Initiates a refund for an authorized payment
   */
  async createRefund({ paymentId, amount = null, notes = {} }) {
    if (!paymentId) throw new Error('Payment ID is required for refund.');
    const payload = {
      notes: {
        reason: 'Authorized refund via MIT Procurement System',
        ...notes
      }
    };
    if (amount) {
      payload.amount = amount;
    }
    return await this._request('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, payload);
  }
}

const paymentGateway = new PaymentGateway();

module.exports = paymentGateway;
