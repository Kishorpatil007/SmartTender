/**
 * Rate Limiter Middleware for Authentication Endpoints
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const memoryStore = new Map();

// Periodic cleanup of stale memory records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Creates an Express rate limiter middleware
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 mins)
 * @param {number} options.max - Max requests allowed per window per IP
 * @param {string} options.message - Custom error message
 */
function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 10,
  message = 'Too many requests from this IP. Please try again after 15 minutes.'
} = {}) {
  return (req, res, next) => {
    // In test environment, allow disabling or higher thresholds if TEST_ENV set
    if (process.env.NODE_ENV === 'test_skip_limit') {
      return next();
    }

    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();

    let record = memoryStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      memoryStore.set(key, record);
    } else {
      record.count += 1;
    }

    // Set standard rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);

      return res.status(429).json({
        success: false,
        message: `${message} (Retry after ${Math.ceil(retryAfterSeconds / 60)} minutes)`
      });
    }

    next();
  };
}

// Pre-configured rate limiters for critical authentication routes
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 requests per 15 minutes
  message: 'Security Alert: Too many authentication attempts from this network.'
});

const forgotPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 requests per 15 minutes
  message: 'Security Alert: Too many verification code requests. Please wait 15 minutes before requesting another code.'
});

const registrationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many account registrations attempted from this network.'
});

module.exports = {
  createRateLimiter,
  authRateLimiter,
  forgotPasswordRateLimiter,
  registrationRateLimiter
};
