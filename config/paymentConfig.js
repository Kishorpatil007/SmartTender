/**
 * Payment Gateway Configuration Module
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Strictly enforces Test vs Live mode separation, validates environment variables,
 * and ensures server secrets (KEY_SECRET, WEBHOOK_SECRET) are never leaked.
 */

require('dotenv').config();

class PaymentConfig {
  constructor() {
    this.refresh();
  }

  /**
   * Refreshes settings from process.env
   */
  refresh() {
    this.provider = (process.env.PAYMENT_PROVIDER || 'razorpay').toLowerCase().trim();
    
    // Explicit payment mode: must be 'test' or 'live', defaulting strictly to 'test'
    const envMode = (process.env.PAYMENT_MODE || 'test').toLowerCase().trim();
    this.mode = envMode === 'live' ? 'live' : 'test';

    this.keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
    this.keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    this.webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();

    // Default system fee fallbacks in paise (e.g. ₹1,000 = 100,000 paise)
    this.defaultTenderFeePaise = parseInt(process.env.TENDER_FEE_PAISE, 10) || 100000;
    this.defaultEmdAmountPaise = parseInt(process.env.EMD_AMOUNT_PAISE, 10) || 5000000; // ₹50,000
    this.currency = 'INR';
  }

  /**
   * Checks whether payment gateway credentials have been properly configured for the current mode.
   * Does NOT treat empty or placeholder strings as valid.
   */
  isConfigured() {
    this.refresh();
    if (!this.keyId || !this.keySecret) {
      return false;
    }
    // Reject common dummy placeholders
    const placeholders = ['your_key_id', 'your_key_secret', 'rzp_test_placeholder', 'rzp_live_placeholder'];
    if (placeholders.includes(this.keyId.toLowerCase()) || placeholders.includes(this.keySecret.toLowerCase())) {
      return false;
    }
    return true;
  }

  /**
   * Validates configuration for an active transaction.
   * Throws explicit security / configuration error if incomplete or misconfigured.
   */
  validateForTransaction() {
    this.refresh();

    if (!this.isConfigured()) {
      const err = new Error(
        `PAYMENT_GATEWAY_NOT_CONFIGURED: Razorpay credentials (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) are missing or incomplete in server environment (.env). Contact MIT Administrator to configure API keys for ${this.mode.toUpperCase()} Mode.`
      );
      err.statusCode = 503;
      err.status = 503;
      throw err;
    }

    if (this.mode === 'live') {
      // Strict safety guard: Live mode MUST use live credentials (starting with rzp_live_)
      // Never allow test keys in live mode, and never silently switch between modes.
      if (!this.keyId.startsWith('rzp_live_')) {
        throw new Error(
          'FATAL CONFIGURATION ERROR: PAYMENT_MODE is set to "live", but RAZORPAY_KEY_ID does not match a valid Razorpay Live Mode key (must begin with "rzp_live_"). Payment processing halted for security.'
        );
      }
    } else {
      // In test mode, warn or ensure test key prefix
      if (this.keyId.startsWith('rzp_live_')) {
        throw new Error(
          'FATAL CONFIGURATION ERROR: PAYMENT_MODE is set to "test", but a LIVE API key was supplied. To prevent accidental real fund transactions, match your PAYMENT_MODE and API credentials.'
        );
      }
    }

    return true;
  }

  /**
   * Validates webhook configuration.
   */
  validateWebhook() {
    this.refresh();
    if (!this.webhookSecret) {
      throw new Error(
        'WEBHOOK_SECRET_NOT_CONFIGURED: RAZORPAY_WEBHOOK_SECRET is not configured in environment variables. Webhook signature verification cannot proceed.'
      );
    }
    return true;
  }

  /**
   * Safe public configuration payload to send to client-side.
   * NEVER exposes keySecret or webhookSecret!
   */
  getPublicConfig() {
    this.refresh();
    const configured = this.isConfigured();
    return {
      provider: this.provider,
      mode: this.mode,
      isConfigured: configured,
      currency: this.currency,
      keyId: configured ? this.keyId : null,
      institution: 'Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar',
      system: 'Smart E-Tender Management System'
    };
  }
}

const paymentConfig = new PaymentConfig();

module.exports = paymentConfig;
