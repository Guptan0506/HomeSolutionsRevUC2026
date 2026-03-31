/**
 * Rate Limiting Middleware
 * Prevents brute force attacks on login, signup, and other endpoints
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    this.maxRequests = options.maxRequests || 5; // 5 requests per window
    this.skipSuccessfulRequests = options.skipSuccessfulRequests !== false; // Don't count successful requests
    this.store = new Map();
    this.keyPrefix = options.keyPrefix || '';
    
    // Cleanup old entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup expired entries from store
   */
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (now - value.timestamp > this.windowMs) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get request count for a key
   */
  getKey(req) {
    return this.keyPrefix + (req.ip || req.connection.remoteAddress || 'unknown');
  }

  /**
   * Middleware function
   */
  middleware() {
    return (req, res, next) => {
      const key = this.getKey(req);
      const now = Date.now();
      const record = this.store.get(key) || { count: 0, timestamp: now, firstRequest: now };

      // Check if window has expired
      if (now - record.timestamp > this.windowMs) {
        // Reset window
        this.store.set(key, { count: 1, timestamp: now, firstRequest: now });
        return next();
      }

      // Increment count
      record.count += 1;
      this.store.set(key, record);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', this.maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, this.maxRequests - record.count));
      res.set('X-RateLimit-Reset', new Date(record.timestamp + this.windowMs).toISOString());

      // Check if limit exceeded
      if (record.count > this.maxRequests) {
        return res.status(429).json({
          message: `Too many requests. Please try again in ${Math.ceil((record.timestamp + this.windowMs - now) / 1000)} seconds.`,
          retryAfter: Math.ceil((record.timestamp + this.windowMs - now) / 1000),
        });
      }

      next();
    };
  }

  /**
   * Destroy rate limiter (cleanup interval)
   */
  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Create a rate limiter instance
 * @param {Object} options - Configuration options
 * @returns {RateLimiter}
 */
function createRateLimiter(options = {}) {
  return new RateLimiter(options);
}

module.exports = {
  RateLimiter,
  createRateLimiter,
};
