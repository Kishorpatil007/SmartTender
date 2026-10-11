
require('dotenv').config();

const nodemailer = require('nodemailer');

/**
 * Enterprise Email Service
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 *
 * Uses production SMTP through Nodemailer.
 *
 * SMTP configuration is supplied through environment variables:
 * SMTP_HOST
 * SMTP_PORT
 * SMTP_SECURE
 * SMTP_USER
 * SMTP_PASS
 * EMAIL_FROM
 * APP_URL
 */

class EmailService {
  constructor() {
    this.provider = process.env.EMAIL_SERVICE || 'smtp';

    this.fromAddress =
      process.env.EMAIL_FROM ||
      process.env.SMTP_USER ||
      'MIT Central Procurement <procurement@mit.asia>';

    this.transporter = null;

    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
    ) {
      try {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT, 10) || 587,
          secure: process.env.SMTP_SECURE === 'true',

          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          },

          connectionTimeout: 30000,
          greetingTimeout: 30000,
          socketTimeout: 30000,

          tls: {
            rejectUnauthorized: true
          }
        });

        console.log(
          `[EMAIL SERVICE] SMTP transporter initialized: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
        );

      } catch (err) {
        console.error(
          '[EMAIL SERVICE] SMTP transporter initialization failed:',
          err.message
        );
      }
    } else {
      console.warn(
        '[EMAIL SERVICE] SMTP environment variables are incomplete.'
      );
    }
  }

  /**
   * Get application URL.
   */
  getAppUrl() {
    if (!process.env.APP_URL) {
      throw new Error(
        'APP_URL is not configured on the server.'
      );
    }

    return process.env.APP_URL.replace(/\/$/, '');
  }

  /**
   * Dispatch email verification OTP.
   */
  async sendEmailVerificationOTP(
    toEmail,
    recipientName,
    otp
  ) {
    const subject =
      'MIT E-Tender Portal — Email Verification Code';

    const text = `Dear ${recipientName},

Your 6-digit verification code to activate your MIT E-Tender Portal account is: ${otp}

This verification code expires in 15 minutes.

Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1a56db;">
          Maharashtra Institute of Technology (MIT)
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Chhatrapati Sambhajinagar • Smart E-Tender Management System
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your 6-digit email verification code is:
        </p>

        <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1a56db;">
          ${otp}
        </div>

        <p style="color: #64748b; font-size: 12px; margin-top: 15px;">
          This code is valid for 15 minutes. Never share this code with anyone.
        </p>
      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'EMAIL_VERIFICATION',
      meta: {
        recipientName
      }
    });
  }

  /**
   * Dispatch password reset OTP.
   */
  async sendPasswordResetOTP(
    toEmail,
    recipientName,
    otp
  ) {
    const subject =
      'MIT E-Tender Portal — Password Reset Code';

    const text = `Dear ${recipientName || 'User'},

A password reset request was received for your MIT E-Tender Portal account.

Your 6-digit password reset verification code is: ${otp}

This code will expire in 15 minutes.

If you did not initiate this request, please alert the Central Administration Office immediately.

Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1a56db;">
          Maharashtra Institute of Technology (MIT)
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Chhatrapati Sambhajinagar • Security & Authentication Desk
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName || 'User'}</strong>,
        </p>

        <p>
          We received a password reset request. Your 6-digit verification code is:
        </p>

        <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #dc2626;">
          ${otp}
        </div>

        <p style="color: #64748b; font-size: 12px; margin-top: 15px;">
          Valid for 15 minutes. If you did not request this, please notify the Central Administration Office.
        </p>
      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'PASSWORD_RESET',
      meta: {
        recipientName
      }
    });
  }

  /**
   * Account approval notification.
   */
  async sendAccountApprovedNotification(
    toEmail,
    recipientName,
    role
  ) {
    const appUrl = this.getAppUrl();

    const subject =
      `MIT E-Tender Portal — Account Approved (${role.toUpperCase()})`;

    const text = `Dear ${recipientName},

Your institutional registration as [${role.toUpperCase()}] has been verified and approved by the Central Administration Office of Maharashtra Institute of Technology (MIT).

You may now sign in to access your procurement desk at:

${appUrl}

Central Purchase & Administration Office,

MIT Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">

        <h2 style="color: #16a34a;">
          Account Verified & Approved
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your account has been officially approved with role:
          <strong style="color: #1a56db;">
            ${role.toUpperCase()}
          </strong>.
        </p>

        <p>
          You may now sign in to access your e-procurement workspace.
        </p>

        <div style="text-align: center; margin: 20px 0;">
          <a href="${appUrl}"
             style="background: #1a56db; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Sign In to MIT E-Tender Portal
          </a>
        </div>

      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'ACCOUNT_APPROVED',
      meta: {
        role,
        recipientName
      }
    });
  }

  /**
   * Staff access request received.
   */
  async sendStaffAccessRequestReceived(
    toEmail,
    recipientName,
    role,
    employeeId,
    department
  ) {
    const roleLabel =
      role === 'authority'
        ? 'Tender Authority / Purchase Officer'
        : 'Technical & Financial Evaluator';

    const subject =
      `MIT E-Tender Portal — Access Request Received (${role.toUpperCase()})`;

    const text = `Dear ${recipientName},

Your institutional access request for [${roleLabel}] has been received by the Central Administration Office.

Employee ID: ${employeeId || 'N/A'}

Department: ${department || 'N/A'}

Our administration team will verify your credentials and dispatch an official invitation link to configure your account password upon approval.

Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">

        <h2 style="color: #1a56db;">
          Maharashtra Institute of Technology (MIT)
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Chhatrapati Sambhajinagar • Central Procurement & Administration
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your access request for institutional role:
          <strong style="color: #1a56db;">
            ${roleLabel}
          </strong>
          has been logged in the verification queue.
        </p>

        <div style="background: #f8fafc; border-left: 4px solid #1a56db; padding: 12px 16px; margin: 15px 0; border-radius: 4px;">

          <div style="font-size: 13px; color: #475569;">
            <strong>Employee ID:</strong> ${employeeId || 'N/A'}
          </div>

          <div style="font-size: 13px; color: #475569;">
            <strong>Department:</strong> ${department || 'N/A'}
          </div>

          <div style="font-size: 13px; color: #475569;">
            <strong>Official Email:</strong> ${toEmail}
          </div>

        </div>

        <p style="color: #334155; font-size: 14px;">
          Once Central Administration verifies your details, you will receive an official invitation email containing a secure link to set your password and activate your workspace.
        </p>

      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'STAFF_REQUEST_RECEIVED',
      meta: {
        role,
        recipientName,
        employeeId,
        department
      }
    });
  }

  /**
   * Official staff invitation.
   */
  async sendStaffInvitation(
    toEmail,
    recipientName,
    role,
    invitationLink,
    token,
    employeeId,
    designation,
    department
  ) {
    const roleLabel =
      role === 'authority'
        ? 'Tender Authority (Procurement Desk)'
        : 'Technical & Financial Evaluator';

    const subject =
      `Official Invitation: Set Up Your MIT E-Tender Portal Account (${role.toUpperCase()})`;

    const text = `Dear ${recipientName},

Your institutional access request for [${roleLabel}] has been verified and approved by Central Administration.

Designation: ${designation || 'Faculty / Officer'}

Employee ID: ${employeeId || 'N/A'}

Department: ${department || 'N/A'}

Please configure your secure account password using this official invitation link:

${invitationLink}

Activation Token: ${token}

This invitation link is valid for 48 hours.

Central Administration,

Maharashtra Institute of Technology (MIT),

Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">

        <h2 style="color: #16a34a;">
          Official Invitation to MIT E-Tender Portal
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your institutional access request has been
          <strong>approved</strong> by the Central Administration Office
          for the role of
          <strong style="color: #1a56db;">
            ${roleLabel}
          </strong>.
        </p>

        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 16px; margin: 15px 0;">

          <div style="font-size: 13px; color: #166534;">
            <strong>Designation:</strong> ${designation || 'N/A'}
          </div>

          <div style="font-size: 13px; color: #166534;">
            <strong>Employee ID:</strong> ${employeeId || 'N/A'}
          </div>

          <div style="font-size: 13px; color: #166534;">
            <strong>Department:</strong> ${department || 'N/A'}
          </div>

        </div>

        <p>
          Please click the button below to set your account password
          and activate your portal access:
        </p>

        <div style="text-align: center; margin: 25px 0;">

          <a href="${invitationLink}"
             style="background: #1a56db; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 15px;">

            Set Account Password

          </a>

        </div>

        <div style="background: #f8fafc; padding: 10px; border-radius: 4px; font-size: 12px; color: #64748b; word-break: break-all;">

          <strong>Direct URL:</strong>

          <a href="${invitationLink}">
            ${invitationLink}
          </a>

          <br><br>

          <strong>Activation Token:</strong>
          <code>${token}</code>

        </div>

        <p style="color: #94a3b8; font-size: 12px; margin-top: 15px;">
          This invitation link is valid for 48 hours.
        </p>

      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'STAFF_INVITATION',
      meta: {
        role,
        recipientName,
        invitationLink
      }
    });
  }

  /**
   * Staff rejection notification.
   */
  async sendStaffRejectionNotification(
    toEmail,
    recipientName,
    role,
    reason
  ) {
    const subject =
      `MIT E-Tender Portal — Account Request Status (${role.toUpperCase()})`;

    const text = `Dear ${recipientName},

Your institutional access request as [${role.toUpperCase()}] could not be approved at this time.

Reason:

${reason || 'Details could not be verified with college records.'}

If you believe this is an error, please contact the Central Administration Office.

MIT Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">

        <h2 style="color: #dc2626;">
          Account Request Update
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your access request for role
          <strong style="color: #1a56db;">
            ${role.toUpperCase()}
          </strong>
          was reviewed by Central Administration.
        </p>

        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 15px 0; border-radius: 4px;">

          <strong style="color: #991b1b;">
            Administrative Note:
          </strong>

          <p style="color: #7f1d1d; margin: 5px 0 0 0; font-size: 13px;">
            ${reason || 'Institutional employee details could not be validated against official faculty/staff roster.'}
          </p>

        </div>

        <p style="color: #64748b; font-size: 13px;">
          Please contact the Central Administration / Procurement Office for assistance.
        </p>

      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'STAFF_REQUEST_REJECTED',
      meta: {
        role,
        recipientName,
        reason
      }
    });
  }

  /**
   * Password set success notification.
   */
  async sendPasswordSetSuccessNotification(
    toEmail,
    recipientName,
    role
  ) {
    const appUrl = this.getAppUrl();

    const subject =
      'MIT E-Tender Portal — Password Configured & Account Active';

    const text = `Dear ${recipientName},

Your password for the MIT E-Tender Portal has been successfully set.

Your account is now fully active with [${role.toUpperCase()}] privileges.

Sign in at:

${appUrl}

Central Purchase & Administration Office,

MIT Chhatrapati Sambhajinagar`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">

        <h2 style="color: #16a34a;">
          Account Activated Successfully
        </h2>

        <p style="color: #64748b; font-size: 14px;">
          Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
        </p>

        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">

        <p>
          Dear <strong>${recipientName}</strong>,
        </p>

        <p>
          Your password has been configured and your institutional account
          is active with role:
          <strong style="color: #1a56db;">
            ${role.toUpperCase()}
          </strong>.
        </p>

        <div style="text-align: center; margin: 20px 0;">

          <a href="${appUrl}"
             style="background: #1a56db; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">

            Sign In to MIT E-Tender Portal

          </a>

        </div>

      </div>
    `;

    return this._dispatchEmail({
      to: toEmail,
      subject,
      text,
      html,
      type: 'PASSWORD_SET_SUCCESS',
      meta: {
        role,
        recipientName
      }
    });
  }

  /**
   * Internal email dispatcher.
   *
   * Sends real email through the configured SMTP server.
   * SMTP failures are surfaced to the calling route.
   */
  async _dispatchEmail({
    to,
    subject,
    text,
    html,
    type,
    meta
  }) {
    if (!this.transporter) {
      throw new Error(
        'Email service is not configured. SMTP transporter is unavailable.'
      );
    }

    try {
      console.log(
        `[SMTP DEBUG] Connecting to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
      );

      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        text,
        html
      });

      console.log(
        `[SMTP EMAIL TRANSPORT] Sent "${subject}" to <${to}>`
      );

      console.log(
        `[SMTP EMAIL TRANSPORT] Message ID: ${info.messageId}`
      );

      return {
        success: true,
        simulated: false,
        messageId: info.messageId
      };

    } catch (err) {
      console.error(
        '[SMTP EMAIL TRANSPORT ERROR]',
        err
      );

      throw new Error(
        `Email delivery failed: ${err.message}`
      );
    }
  }
}

module.exports = new EmailService();

