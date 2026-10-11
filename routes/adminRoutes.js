const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { dbHelper } = require('../database/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const emailService = require('../utils/emailService');

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

// Protect all admin routes with verifyToken and requireRole('admin')
router.use(verifyToken, requireRole('admin'));

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await dbHelper.get('SELECT COUNT(*) as count FROM users');
    const totalContractors = await dbHelper.get('SELECT COUNT(*) as count FROM contractors');
    const pendingContractors = await dbHelper.get("SELECT COUNT(*) as count FROM contractors WHERE registration_status = 'pending'");
    const pendingInstitutionalUsers = await dbHelper.get("SELECT COUNT(*) as count FROM users WHERE status = 'pending' AND role IN ('authority', 'evaluator')");
    const totalTenders = await dbHelper.get('SELECT COUNT(*) as count FROM tenders');
    const activeTenders = await dbHelper.get("SELECT COUNT(*) as count FROM tenders WHERE status IN ('published', 'under_evaluation')");
    const awardedTenders = await dbHelper.get("SELECT COUNT(*) as count FROM tenders WHERE status = 'awarded'");
    const totalBudget = await dbHelper.get('SELECT SUM(estimated_budget) as total FROM tenders');
    const totalBids = await dbHelper.get('SELECT COUNT(*) as count FROM bids');

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers.count,
        totalContractors: totalContractors.count,
        pendingContractors: pendingContractors.count,
        pendingInstitutionalUsers: pendingInstitutionalUsers.count,
        totalTenders: totalTenders.count,
        activeTenders: activeTenders.count,
        awardedTenders: awardedTenders.count,
        totalBudget: totalBudget.total || 0,
        totalBids: totalBids.count
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { role, status, search } = req.query;
    let sql = `
      SELECT id, name, email, role, department, phone, employee_id, designation, justification,
             status, email_verified, failed_login_attempts, locked_until, invitation_token, invitation_expires_at, created_at
      FROM users WHERE 1=1
    `;
    const params = [];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (name LIKE ? OR email LIKE ? OR department LIKE ? OR employee_id LIKE ? OR designation LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    const users = await dbHelper.all(sql, params);
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/staff-requests (Pending / Invited / All Staff Requests)
router.get('/staff-requests', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT id, name, email, role, department, phone, employee_id, designation, justification,
             status, email_verified, invitation_token, invitation_expires_at, created_at
      FROM users
      WHERE role IN ('authority', 'evaluator')
    `;
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';
    const requests = await dbHelper.all(sql, params);
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/users/:id/details (Full user & profile details)
router.get('/users/:id/details', async (req, res) => {
  try {
    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let contractor = null;
    if (user.role === 'contractor') {
      contractor = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [user.id]);
    }

    // Exclude password hash from response
    delete user.password;

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const invitation_link = user.invitation_token
      ? `${appUrl.replace(/\/$/, '')}/#set-password?token=${user.invitation_token}&email=${encodeURIComponent(user.email)}`
      : null;

    res.json({
      success: true,
      user: {
        ...user,
        invitation_link,
        contractor
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/staff-requests/:id/approve (Admin Approves Staff Request & Dispatches Invitation)
router.post('/staff-requests/:id/approve', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff request not found.' });
    }

    if (!['authority', 'evaluator'].includes(user.role)) {
      return res.status(400).json({ success: false, message: 'Only Tender Authority or Evaluator requests can be approved via this endpoint.' });
    }

    const isResend = user.status === 'invited';

    if (user.status === 'active') {
      return res.status(409).json({
        success: false,
        message: 'This staff account is already active and does not require another invitation.'
      });
    }

    if (user.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'This staff request was rejected and cannot be re-approved through this route.'
      });
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      return res.status(500).json({
        success: false,
        message: 'APP_URL is not configured on the server.'
      });
    }

    // Reuse existing valid token or generate fresh 48-hour token
    const invitationToken = (isResend && user.invitation_token && user.invitation_expires_at && new Date(user.invitation_expires_at) > new Date())
      ? user.invitation_token
      : crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const invitationLink = `${appUrl.replace(/\/$/, '')}/#set-password?token=${invitationToken}&email=${encodeURIComponent(user.email)}`;

    try {
      await emailService.sendStaffInvitation(
        user.email,
        user.name,
        user.role,
        invitationLink,
        invitationToken,
        user.employee_id,
        user.designation,
        user.department
      );
    } catch (emailError) {
      console.error('Staff invitation email failed:', emailError);
      return res.status(500).json({
        success: false,
        message: `Invitation email could not be delivered: ${emailError.message}`
      });
    }

    await dbHelper.run(
      `UPDATE users
       SET status = 'invited', invitation_token = ?, invitation_expires_at = ?
       WHERE id = ?`,
      [invitationToken, expiresAt, userId]
    );

    await logAudit(
      req.user.id,
      isResend ? 'STAFF_INVITATION_RESENT' : 'STAFF_REQUEST_APPROVED',
      `Admin ${isResend ? 're-dispatched invitation to' : 'approved staff request for'} ${user.email} (${user.name}) as ${user.role.toUpperCase()} [Emp ID: ${user.employee_id || 'N/A'}, Dept: ${user.department}]. Dispatched official invitation email.`,
      req.ip
    );

    res.json({
      success: true,
      message: isResend
        ? `Invitation email re-dispatched to ${user.email}! (Please check Inbox and Spam/Junk folder)`
        : `Staff request approved! Official invitation email containing password setup link has been dispatched to ${user.email}. (Please check Inbox and Spam/Junk folder)`,
      invitation_token: invitationToken,
      invitation_link: invitationLink,
      is_resend: isResend
    });
  } catch (error) {
    console.error('Approve staff request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/staff-requests/:id/reject (Admin Rejects Staff Request)
router.post('/staff-requests/:id/reject', async (req, res) => {
  try {
    const userId = req.params.id;
    const { reason } = req.body;
    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff request not found.' });
    }

    await dbHelper.run(
      `UPDATE users
       SET status = 'rejected', invitation_token = NULL, invitation_expires_at = NULL
       WHERE id = ?`,
      [userId]
    );

    await emailService.sendStaffRejectionNotification(
      user.email,
      user.name,
      user.role,
      reason || 'Staff credentials could not be verified against college roster.'
    );

    await logAudit(
      req.user.id,
      'STAFF_REQUEST_REJECTED',
      `Admin rejected staff request for ${user.email} (${user.name}) as ${user.role.toUpperCase()}. Reason: ${reason || 'Unverified'}`,
      req.ip
    );

    res.json({
      success: true,
      message: `Staff request for ${user.name} has been rejected and notification sent.`
    });
  } catch (error) {
    console.error('Reject staff request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/admin/staff-requests/:id (Permanently deletes a rejected/pending staff request)
router.delete('/staff-requests/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff request not found.' });
    }

    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own admin account.' });
    }

    // Clean up associated password resets
    await dbHelper.run('DELETE FROM password_resets WHERE email = ?', [user.email]);
    // Delete user record
    await dbHelper.run('DELETE FROM users WHERE id = ?', [userId]);

    await logAudit(
      req.user.id,
      'STAFF_REQUEST_DELETED',
      `Admin permanently deleted staff request for ${user.email} (${user.name}) from database.`,
      req.ip
    );

    res.json({
      success: true,
      message: `Staff request for ${user.name} (${user.email}) permanently deleted from database and dashboard.`
    });
  } catch (error) {
    console.error('Delete staff request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/users (Direct provisioning of Institutional Tender Authority / Evaluator accounts)
router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, department, phone } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Name, email, password, and role are required.' });
    }

    if (!['authority', 'evaluator', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role for institutional staff provisioning.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await dbHelper.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email address already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const userResult = await dbHelper.run(
      `INSERT INTO users (name, email, password, role, department, phone, status, email_verified, failed_login_attempts, locked_until)
       VALUES (?, ?, ?, ?, ?, ?, 'active', TRUE, 0, NULL)`,
      [name.trim(), cleanEmail, hashedPassword, role, department ? department.trim() : null, phone ? phone.trim() : null]
    );

    await logAudit(
      req.user.id,
      'STAFF_PROVISIONING',
      `Admin provisioned new institutional staff account: ${cleanEmail} as ${role.toUpperCase()} (${department || 'Central Procurement'})`,
      req.ip
    );

    await emailService.sendAccountApprovedNotification(cleanEmail, name.trim(), role);

    res.status(201).json({
      success: true,
      message: `Institutional account for ${name} (${role.toUpperCase()}) provisioned successfully and activated for login.`,
      user: {
        id: userResult.lastID,
        name: name.trim(),
        email: cleanEmail,
        role,
        department,
        status: 'active',
        email_verified: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/users/:id/verify (for Authority, Evaluator & all role approval)
router.put('/users/:id/verify', async (req, res) => {
  try {
    const { status } = req.body; // 'approved' (activates user) or 'rejected' (inactivates user)
    const userId = req.params.id;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid verification status.' });
    }

    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    const newStatus = status === 'approved' ? 'active' : status === 'rejected' ? 'inactive' : 'pending';
    await dbHelper.run('UPDATE users SET status = ? WHERE id = ?', [newStatus, userId]);

    // If user is a contractor, sync contractor profile
    if (user.role === 'contractor') {
      await dbHelper.run('UPDATE contractors SET registration_status = ? WHERE user_id = ?', [status, userId]);
    }

    // Send notification
    if (status === 'approved') {
      await emailService.sendAccountApprovedNotification(user.email, user.name, user.role);
    }

    await logAudit(
      req.user.id,
      'USER_VERIFICATION',
      `Admin verified user #${userId} (${user.email}, ${user.role}) -> ${status} (account: ${newStatus})`,
      req.ip
    );

    res.json({
      success: true,
      message: `Account for ${user.name} (${user.role.toUpperCase()}) has been ${status === 'approved' ? 'approved and activated' : 'rejected'}.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.params.id;

    if (!['active', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    await dbHelper.run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    await logAudit(req.user.id, 'USER_STATUS_CHANGE', `Updated status of user #${userId} to ${status}`, req.ip);

    res.json({ success: true, message: `User status updated to ${status}.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own admin account.' });
    }

    await dbHelper.run('DELETE FROM users WHERE id = ?', [userId]);
    await logAudit(req.user.id, 'USER_DELETE', `Deleted user account #${userId}`, req.ip);

    res.json({ success: true, message: 'User account removed successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/contractors
router.get('/contractors', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT 
        COALESCE(c.id, u.id) as id,
        u.id as user_id,
        COALESCE(c.company_name, u.name || ' (Contractor)') as company_name,
        COALESCE(c.license_number, 'PENDING_DOCUMENTATION') as license_number,
        COALESCE(c.contact_details, u.email || ' | ' || COALESCE(u.phone, '')) as contact_details,
        COALESCE(c.address, u.department, 'MIDC Chhatrapati Sambhajinagar') as address,
        COALESCE(c.experience_years, 0) as experience_years,
        COALESCE(c.registration_status, 'pending') as registration_status,
        COALESCE(c.gst_number, 'NOT PROVIDED') as gst_number,
        COALESCE(c.pan_number, 'NOT PROVIDED') as pan_number,
        COALESCE(c.created_at, u.created_at) as created_at,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        u.status as account_status,
        u.email_verified,
        COALESCE((SELECT COUNT(*) FROM bids WHERE contractor_id = c.id), 0) as total_bids,
        COALESCE((SELECT COUNT(*) FROM bids WHERE contractor_id = c.id AND status = 'awarded'), 0) as won_tenders
      FROM users u
      LEFT JOIN contractors c ON c.user_id = u.id
      WHERE u.role = 'contractor'
    `;
    const params = [];

    if (status) {
      sql += " AND COALESCE(c.registration_status, 'pending') = $1";
      params.push(status);
    }

    sql += ` ORDER BY 
      CASE COALESCE(c.registration_status, 'pending') 
        WHEN 'pending' THEN 1 
        WHEN 'approved' THEN 2 
        ELSE 3 
      END, 
      COALESCE(c.created_at, u.created_at) DESC`;
      
    const contractors = await dbHelper.all(sql, params);
    res.json({ success: true, contractors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/contractors/:id/verify
router.put('/contractors/:id/verify', async (req, res) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    const targetId = req.params.id;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid verification status.' });
    }

    // Check if contractor exists by contractors.id or users.id
    let contractor = await dbHelper.get('SELECT * FROM contractors WHERE id = ? OR user_id = ?', [targetId, targetId]);
    let targetUserId = contractor ? contractor.user_id : targetId;

    if (!contractor) {
      const user = await dbHelper.get("SELECT * FROM users WHERE id = ? AND role = 'contractor'", [targetId]);
      if (!user) {
        return res.status(404).json({ success: false, message: 'Contractor record or user not found.' });
      }

      // Create contractor profile if it was missing
      const result = await dbHelper.run(
        `INSERT INTO contractors (user_id, company_name, license_number, contact_details, address, experience_years, registration_status)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [user.id, user.name || 'Contractor Firm', 'PENDING_DOCUMENTATION', `${user.email} | ${user.phone || ''}`, user.department || 'MIDC Chhatrapati Sambhajinagar', status]
      );
      contractor = await dbHelper.get('SELECT * FROM contractors WHERE id = ?', [result.lastID]);
      targetUserId = user.id;
    } else {
      await dbHelper.run('UPDATE contractors SET registration_status = ? WHERE id = ?', [status, contractor.id]);
    }
    
    if (status === 'approved') {
      await dbHelper.run("UPDATE users SET status = 'active', email_verified = TRUE WHERE id = ?", [targetUserId]);
      const u = await dbHelper.get('SELECT * FROM users WHERE id = ?', [targetUserId]);
      if (u) {
        await emailService.sendAccountApprovedNotification(u.email, u.name, 'contractor');
      }
    } else if (status === 'rejected') {
      await dbHelper.run("UPDATE users SET status = 'inactive' WHERE id = ?", [targetUserId]);
    }

    await logAudit(
      req.user.id,
      'CONTRACTOR_VERIFICATION',
      `Vendor #${contractor.id} (${contractor.company_name}) verification status updated to '${status}' by Administrator`,
      req.ip
    );

    res.json({ 
      success: true, 
      message: `Vendor '${contractor.company_name}' has been successfully ${status === 'approved' ? 'approved & verified for bidding' : status === 'rejected' ? 'rejected' : 'updated'}.` 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/admin/contractors/:id (Permanently deletes a contractor KYC profile and user)
router.delete('/contractors/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    let contractor = await dbHelper.get('SELECT * FROM contractors WHERE id = ? OR user_id = ?', [targetId, targetId]);

    if (!contractor) {
      return res.status(404).json({ success: false, message: 'Contractor record not found.' });
    }

    const userId = contractor.user_id;
    const user = await dbHelper.get('SELECT * FROM users WHERE id = ?', [userId]);

    if (user) {
      await dbHelper.run('DELETE FROM password_resets WHERE email = ?', [user.email]);
    }

    // Delete contractor record
    await dbHelper.run('DELETE FROM contractors WHERE id = ?', [contractor.id]);
    // Delete associated user record
    if (userId) {
      await dbHelper.run('DELETE FROM users WHERE id = ?', [userId]);
    }

    await logAudit(
      req.user.id,
      'CONTRACTOR_REQUEST_DELETED',
      `Admin permanently deleted contractor KYC application for ${contractor.company_name} (User #${userId || 'N/A'}).`,
      req.ip
    );

    res.json({
      success: true,
      message: `Contractor request for '${contractor.company_name}' permanently deleted from database and queue.`
    });
  } catch (error) {
    console.error('Delete contractor request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await dbHelper.all(`
      SELECT a.*, u.name as user_name, u.email as user_email, u.role as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/departments
router.get('/departments', async (req, res) => {
  try {
    const departments = await dbHelper.all(`
      SELECT 
        department,
        COUNT(id) as tender_count,
        SUM(estimated_budget) as total_budget,
        SUM(CASE WHEN status = 'awarded' THEN 1 ELSE 0 END) as awarded_count
      FROM tenders
      GROUP BY department
      ORDER BY total_budget DESC
    `);
    res.json({ success: true, departments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
