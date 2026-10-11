require('dotenv').config();
const jwt = require('jsonwebtoken');
const { dbHelper } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('FATAL SECURITY ERROR: JWT_SECRET is not configured in environment variables (.env). Please set JWT_SECRET in your .env file.');
}

// Middleware to authenticate JWT token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please sign in.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch fresh user details from DB
    const user = await dbHelper.get(
      'SELECT id, name, email, role, department, phone, status, email_verified FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account is pending institutional verification or inactive.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired authentication session. Please sign in again.' });
  }
};

// Middleware to enforce Role-Based Access Control (RBAC)
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`
      });
    }

    next();
  };
};

module.exports = {
  verifyToken,
  requireRole,
  JWT_SECRET
};
