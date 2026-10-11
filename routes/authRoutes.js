const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { dbHelper } = require('../database/db');
const { JWT_SECRET, verifyToken } = require('../middleware/auth');
const emailService = require('../utils/emailService');
const {
  authRateLimiter,
  forgotPasswordRateLimiter,
  registrationRateLimiter
} = require('../middleware/rateLimiter');

// Security Audit Logger Helper
async function logAudit(userId, action, details, ip) {
  try {
    await dbHelper.run(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [userId || null, action, details, ip || '127.0.0.1']
    );
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

/**
 * Validates password complexity:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 */
function validatePasswordComplexity(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  const minLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!minLength || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    return {
      valid: false,
      message: 'Password must be at least 8 characters long and include at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.'
    };
  }
  return { valid: true };
}

// Helper: Hashing OTP for secure at-rest storage
function hashOTP(otp, email) {
  return crypto.createHash('sha256').update(`${email.toLowerCase().trim()}:${otp}`).digest('hex');
}

// GET /api/auth/admin-status
router.get('/admin-status', async (req, res) => {
  try {
    const adminRecord = await dbHelper.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    const hasAdmin = adminRecord && adminRecord.count > 0;
    res.json({
      success: true,
      hasAdmin,
      count: adminRecord ? adminRecord.count : 0
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/auth/register
router.post('/register', registrationRateLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      confirm_password,
      confirmPassword,
      role,
      department,
      phone,
      company_name,
      license_number,
      gst_number,
      pan_number,
      contact_details,
      address,
      experience_years
    } = req.body;

    const finalConfirm = confirm_password || confirmPassword;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, email, password, and role are required.' });
    }

    // Explicitly restrict public registration to contractors only
    if (role !== 'contractor') {
      return res.status(403).json({
        success: false,
        message: 'Public registration is restricted exclusively to Contractor / Bidder onboarding. Institutional accounts (Tender Authority, Evaluator Committee, Admin) are provisioned directly by the Central Administration Office.'
      });
    }

    // Validate Confirm Password
    if (finalConfirm && password !== finalConfirm) {
      return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match.' });
    }

    // Validate Password Complexity
    const passCheck = validatePasswordComplexity(password);
    if (!passCheck.valid) {
      return res.status(400).json({ success: false, message: passCheck.message });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if email already exists
    const existing = await dbHelper.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email address is already registered.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    
    // Contractors start in 'pending' status awaiting institutional KYC verification
    const userStatus = 'pending';

    const userResult = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified, failed_login_attempts, locked_until)
       VALUES (?, ?, ?, 'contractor', ?, ?, ?, FALSE, 0, NULL)`,
      [name.trim(), cleanEmail, hashedPassword, department ? department.trim() : null, phone ? phone.trim() : null, userStatus]
    );

    const userId = userResult.lastID;

    // Create contractor KYC profile record in pending state
    const company = company_name || name || 'Contractor Firm';
    const license = license_number || 'PENDING_DOCUMENTATION';
    const contact = contact_details || `${cleanEmail} | ${phone || ''}`;
    const addr = address || department || 'MIDC Chhatrapati Sambhajinagar';
    const exp = parseInt(experience_years) || 0;
    const gst = gst_number || null;
    const pan = pan_number || null;

    await dbHelper.run(
      `INSERT INTO contractors (user_id, company_name, license_number, contact_details, address, experience_years, registration_status, gst_number, pan_number)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [userId, company, license, contact, addr, exp, gst, pan]
    );

    await logAudit(
      userId,
      'CONTRACTOR_KYC_SUBMITTED',
      `Contractor KYC application submitted by ${name.trim()} (${cleanEmail} - ${company}). Pending Administrator approval.`,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Contractor KYC registration submitted successfully! Your application has been sent to the Administrator for approval.',
      user: {
        id: userId,
        name: name.trim(),
        email: cleanEmail,
        role: 'contractor',
        department: department || null,
        status: userStatus,
        email_verified: false
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration: ' + error.message });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', authRateLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and verification code (OTP) are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp.toString().trim();
    const otpHashed = hashOTP(cleanOtp, cleanEmail);

    const record = await dbHelper.get(
      `SELECT * FROM password_resets
       WHERE email = $1 AND otp_hash = $2 AND type = 'EMAIL_VERIFICATION' AND used = FALSE AND expires_at >= NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, otpHashed]
    );

    if (!record) {
      return res.status(400).json({ success: false, message: 'Invalid or expired email verification code. Please request a new code.' });
    }

    await dbHelper.run('UPDATE users SET email_verified = TRUE WHERE email = ?', [cleanEmail]);
    await dbHelper.run('UPDATE password_resets SET used = TRUE WHERE id = ?', [record.id]);
    await logAudit(null, 'EMAIL_VERIFIED', `Email address verified for: ${cleanEmail}`, req.ip);

    res.json({
      success: true,
      message: 'Email address verified successfully!'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ success: false, message: 'Server error verifying email: ' + error.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await dbHelper.get('SELECT id, name, email FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      // Return generic positive response for user enumeration defense
      return res.json({
        success: true,
        message: `If an account exists for ${cleanEmail}, a verification code has been dispatched to the registered inbox.`,
        expires_in: '15 minutes'
      });
    }

    // Generate 6-digit cryptographically secure OTP & securely hash it
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHashed = hashOTP(otp, cleanEmail);
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins validity

    // Invalidate old unused OTPs
    await dbHelper.run("UPDATE password_resets SET used = TRUE WHERE email = ? AND type = 'PASSWORD_RESET' AND used = FALSE", [cleanEmail]);

    // Store securely hashed OTP
    await dbHelper.run(
      `INSERT INTO password_resets (email, otp, otp_hash, type, token, expires_at, used)
       VALUES (?, ?, ?, 'PASSWORD_RESET', ?, ?, FALSE)`,
      [cleanEmail, 'ENCRYPTED', otpHashed, token, expiresAt]
    );

    // Send via Email Service Provider
    try {
      await emailService.sendPasswordResetOTP(cleanEmail, user.name, otp);
    } catch (mailErr) {
      console.error(`[FORGOT PASSWORD] Failed to dispatch OTP to ${cleanEmail}:`, mailErr.message);
      console.log(`[PASSWORD RESET OTP RECOVERY] OTP for ${cleanEmail}: ${otp}`);
      return res.status(503).json({
        success: false,
        message: `Unable to deliver password reset OTP email (${mailErr.message}). Cloud hosts like Render Free Tier block outbound SMTP ports (25, 465, 587). Please contact your administrator or configure an HTTPS email API (Resend/Brevo).`
      });
    }

    await logAudit(user.id, 'PASSWORD_RESET_REQUEST', `Password reset verification code dispatched for ${cleanEmail}`, req.ip);

    // Never return the raw OTP in API response
    res.json({
      success: true,
      message: `Verification code sent to ${cleanEmail}. Valid for 15 minutes.`,
      expires_in: '15 minutes'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error processing password reset: ' + error.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authRateLimiter, async (req, res) => {
  try {
    const { email, otp, password, newPassword, confirmPassword, confirm_password } = req.body;
    const finalPassword = password || newPassword;
    const finalConfirm = confirmPassword || confirm_password;

    if (!email || !otp || !finalPassword) {
      return res.status(400).json({ success: false, message: 'Email, verification code (OTP), and new password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp.toString().trim();

    // Confirm password match check
    if (finalConfirm && finalPassword !== finalConfirm) {
      return res.status(400).json({ success: false, message: 'New Password and Confirm Password do not match.' });
    }

    // Password complexity check
    const passCheck = validatePasswordComplexity(finalPassword);
    if (!passCheck.valid) {
      return res.status(400).json({ success: false, message: passCheck.message });
    }

    const otpHashed = hashOTP(cleanOtp, cleanEmail);

    // Validate OTP against unexpired and unused records using cryptographic hash
    const resetRecord = await dbHelper.get(
      `SELECT * FROM password_resets 
       WHERE email = $1 AND otp_hash = $2 AND type = 'PASSWORD_RESET' AND used = FALSE AND expires_at >= NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail, otpHashed]
    );

    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code. Please check your code or request a new one.'
      });
    }

    const user = await dbHelper.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const newHashedPassword = bcrypt.hashSync(finalPassword, 10);
    await dbHelper.run(
      'UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL WHERE email = ?',
      [newHashedPassword, cleanEmail]
    );
    await dbHelper.run('UPDATE password_resets SET used = TRUE WHERE id = ?', [resetRecord.id]);

    await logAudit(user.id, 'PASSWORD_RESET_SUCCESS', `Password successfully reset for account: ${cleanEmail}`, req.ip);

    res.json({
      success: true,
      message: 'Password reset successful! You may now sign in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Server error resetting password: ' + error.message });
  }
});

// POST /api/auth/login (with Brute-force protection & Account Lockout)
router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await dbHelper.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password. Please check your credentials.' });
    }

    const now = new Date();

    // 1. Check Account Lockout status
    if (user.locked_until && new Date(user.locked_until) > now) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until) - now) / (60 * 1000));
      return res.status(423).json({
        success: false,
        message: `Security Lockout: Account is temporarily locked due to multiple failed login attempts. Please try again after ${remainingMinutes} minute(s) or reset your password via email verification.`
      });
    }

    // 2. Verify Password
    const isMatch = bcrypt.compareSync(password, user.password);

    if (!isMatch) {
      const failedAttempts = (user.failed_login_attempts || 0) + 1;

      if (failedAttempts >= 5) {
        // Lock account for 15 minutes
        const lockDurationMs = 15 * 60 * 1000;
        const lockUntil = new Date(Date.now() + lockDurationMs).toISOString();

        await dbHelper.run(
          'UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?',
          [lockUntil, user.id]
        );

        await logAudit(user.id, 'ACCOUNT_TEMPORARY_LOCKOUT', `Account locked for 15 mins after 5 failed password attempts (${cleanEmail})`, req.ip);

        return res.status(423).json({
          success: false,
          message: 'Security Alert: Account has been temporarily locked for 15 minutes due to 5 consecutive failed login attempts. You can reset your password using Forgot Password.'
        });
      } else {
        await dbHelper.run(
          'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
          [failedAttempts, user.id]
        );

        const remainingAttempts = 5 - failedAttempts;
        return res.status(401).json({
          success: false,
          message: `Invalid email or password. ${remainingAttempts} attempt(s) remaining before temporary account lockout.`
        });
      }
    }

    // 3. Password is valid: Clear failed attempts and lockout timers
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await dbHelper.run('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    }

    // 4. Institutional Verification Status Checks
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: `Account Pending Verification: Your institutional registration as [${user.role.toUpperCase()}] is pending approval by the Central Administration Office.`
      });
    }

    if (user.status === 'invited') {
      return res.status(403).json({
        success: false,
        message: 'Account Invitation Pending: Your institutional access was approved! Please click the invitation link sent to your official email to set your password before signing in.'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Account Request Rejected: Your request could not be approved by Central Administration. Please contact the Procurement Office.'
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Account Inactive: Your account has been disabled. Please contact the Central Administration Office.'
      });
    }

    let contractorProfile = null;
    if (user.role === 'contractor') {
      contractorProfile = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [user.id]);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    await logAudit(user.id, 'USER_LOGIN', `User logged in: ${user.email} (${user.role})`, req.ip);

    res.json({
      success: true,
      message: 'Sign in successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        employee_id: user.employee_id,
        designation: user.designation,
        phone: user.phone,
        status: user.status,
        email_verified: Boolean(user.email_verified),
        contractor: contractorProfile
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login: ' + error.message });
  }
});

// POST /api/auth/request-staff-account (Authority / Evaluator Access Request)
router.post('/request-staff-account', registrationRateLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      role,
      employee_id,
      designation,
      department,
      phone,
      justification
    } = req.body;

    if (!name || !email || !role || !department) {
      return res.status(400).json({
        success: false,
        message: 'Name, official email, role, and department are mandatory for institutional access requests.'
      });
    }

    if (!['authority', 'evaluator'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role requested. Must be either Tender Authority or Evaluator.'
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if email already registered
    const existing = await dbHelper.get('SELECT id, status, role FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `An account or pending request with this official email (${cleanEmail}) already exists.`
      });
    }

    // Insert user with pending status and placeholder password until invitation accepted
    const randomSecret = crypto.randomBytes(32).toString('hex');
    const placeholderHash = bcrypt.hashSync(randomSecret, 10);

    const userResult = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, employee_id, designation, justification, status, email_verified, failed_login_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', FALSE, 0)`,
      [
        name.trim(),
        cleanEmail,
        placeholderHash,
        role,
        department.trim(),
        phone ? phone.trim() : null,
        employee_id ? employee_id.trim() : null,
        designation ? designation.trim() : null,
        justification ? justification.trim() : null
      ]
    );

    const userId = userResult.lastID;

    // Dispatch acknowledgment email to applicant (safe, non-blocking)
    let emailSent = true;
    try {
      await emailService.sendStaffAccessRequestReceived(cleanEmail, name.trim(), role, employee_id, department);
    } catch (mailErr) {
      emailSent = false;
      console.warn(`[STAFF ACCESS REQUEST] Acknowledgment email could not be delivered to ${cleanEmail}: ${mailErr.message}. The request was saved.`);
    }

    await logAudit(
      userId,
      'STAFF_ACCESS_REQUEST',
      `New institutional staff request: ${cleanEmail} (${name}) as ${role.toUpperCase()} - Emp ID: ${employee_id || 'N/A'}, Dept: ${department}${!emailSent ? ' (Email notification skipped: SMTP/network timed out)' : ''}`,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: `Access request submitted successfully! Central Administration will verify your credentials and dispatch an official invitation link to ${cleanEmail}.`
    });
  } catch (error) {
    console.error('Staff account request error:', error);
    res.status(500).json({ success: false, message: 'Server error processing request: ' + error.message });
  }
});

// GET /api/auth/verify-invitation (Validates token for setting password)
router.get('/verify-invitation', async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) {
      return res.status(400).json({ success: false, message: 'Invitation token and official email are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await dbHelper.get(
      `SELECT id, name, email, role, department, designation, employee_id, status, invitation_expires_at
       FROM users WHERE email = ? AND invitation_token = ?`,
      [cleanEmail, token.trim()]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Invalid or expired invitation token.' });
    }

    if (user.invitation_expires_at && new Date(user.invitation_expires_at) < new Date()) {
      return res.status(410).json({
        success: false,
        message: 'This invitation link has expired. Please request a new invitation from Central Administration.'
      });
    }

    res.json({
      success: true,
      message: 'Invitation verified.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        designation: user.designation,
        employee_id: user.employee_id
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// POST /api/auth/set-password (Accepts invitation and sets password)
router.post('/set-password', async (req, res) => {
  try {
    const { token, email, password, confirm_password, confirmPassword } = req.body;
    const finalConfirm = confirm_password || confirmPassword;

    if (!token || !email || !password) {
      return res.status(400).json({ success: false, message: 'Token, email, and new password are required.' });
    }

    if (finalConfirm && password !== finalConfirm) {
      return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match.' });
    }

    // Password Complexity
    const passCheck = validatePasswordComplexity(password);
    if (!passCheck.valid) {
      return res.status(400).json({ success: false, message: passCheck.message });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await dbHelper.get(
      `SELECT * FROM users WHERE email = ? AND invitation_token = ?`,
      [cleanEmail, token.trim()]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Invalid invitation credentials.' });
    }

    if (user.invitation_expires_at && new Date(user.invitation_expires_at) < new Date()) {
      return res.status(410).json({ success: false, message: 'This invitation has expired.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    await dbHelper.run(
      `UPDATE users
       SET password = ?, status = 'active', email_verified = TRUE, invitation_token = NULL, invitation_expires_at = NULL, failed_login_attempts = 0, locked_until = NULL
       WHERE id = ?`,
      [hashedPassword, user.id]
    );

    try {
      await emailService.sendPasswordSetSuccessNotification(cleanEmail, user.name, user.role);
    } catch (mailErr) {
      console.warn(`[SET PASSWORD] Confirmation email could not be delivered to ${cleanEmail}: ${mailErr.message}. Password update succeeded.`);
    }

    await logAudit(
      user.id,
      'STAFF_INVITATION_ACCEPTED',
      `Staff member ${cleanEmail} (${user.name}) accepted invitation and configured account password.`,
      req.ip
    );

    res.json({
      success: true,
      message: `Password set successfully! Your institutional account as [${user.role.toUpperCase()}] is now active. You may now sign in.`
    });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    let contractorProfile = null;
    if (req.user.role === 'contractor') {
      contractorProfile = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [req.user.id]);
    }

    res.json({
      success: true,
      user: {
        ...req.user,
        contractor: contractorProfile
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

module.exports = router;
