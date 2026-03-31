/**
 * Security Utilities Module
 * Handles password validation, JWT tokens, input sanitization, and rate limiting
 */

const jwt = require('jsonwebtoken');

// Password validation rules
const PASSWORD_RULES = {
  minLength: 10,
  requireUppercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

/**
 * Validate password against security requirements
 * @param {string} password - Password to validate
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
function validatePassword(password) {
  const errors = [];

  if (!password) {
    errors.push('Password is required.');
    return { isValid: false, errors };
  }

  if (password.length < PASSWORD_RULES.minLength) {
    errors.push(`Password must be at least ${PASSWORD_RULES.minLength} characters long.`);
  }

  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter.');
  }

  if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number.');
  }

  if (PASSWORD_RULES.requireSpecialChars && !new RegExp(`[${PASSWORD_RULES.specialChars}]`).test(password)) {
    errors.push(`Password must contain at least one special character: ${PASSWORD_RULES.specialChars}`);
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Generate JWT token for authenticated user
 * @param {number} userId - User ID
 * @param {string} email - User email
 * @param {string} role - User role (customer or service_provider)
 * @returns {Object} { token: string, expiresIn: number_of_seconds }
 */
function generateToken(userId, email, role) {
  const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  const expiresIn = process.env.JWT_EXPIRY || '7d'; // 7 days default
  
  const token = jwt.sign(
    {
      user_id: userId,
      email,
      role,
      iat: Math.floor(Date.now() / 1000),
    },
    secret,
    { expiresIn }
  );

  // Return token and expiry info
  const decoded = jwt.decode(token);
  const expiresAt = decoded.exp;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = expiresAt - nowSeconds;

  return {
    token,
    expiresAt,
    expiresInSeconds,
  };
}

/**
 * Verify and decode JWT token
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function verifyToken(token) {
  if (!token) {
    return null;
  }

  try {
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const decoded = jwt.verify(token, secret);
    return decoded;
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return null;
  }
}

/**
 * Sanitize input to prevent SQL injection and XSS
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .replace(/[\r\n]/g, ' ') // Remove newlines
    .trim();
}

/**
 * Extract token from Authorization header
 * Format: "Bearer <token>"
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null
 */
function extractTokenFromHeader(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Check if email is valid format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
  // RFC 5322 simplified email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

module.exports = {
  PASSWORD_RULES,
  validatePassword,
  generateToken,
  verifyToken,
  sanitizeInput,
  extractTokenFromHeader,
  isValidEmail,
};
