# Security Implementation Guide - Phase 4

## Overview

This document outlines the security features implemented in HomeSolutions to protect user data, prevent unauthorized access, and ensure safe communication.

## 🔐 Security Features Implemented

### 1. **JWT Token-Based Authentication**
- **What**: JSON Web Tokens replace localStorage-only authentication
- **How**: After login/signup, server returns a signed JWT token with 7-day default expiry
- **Usage**: Token is sent in `Authorization: Bearer <token>` header on protected endpoints
- **Benefits**: Stateless, can't be forged without secret key, expires automatically

**Example:**
```javascript
// Login response now includes token
{
  "token": "eyJhbGc...",
  "expiresAt": 1717200000,
  "expiresInSeconds": 604800,
  "user": { ... }
}
```

### 2. **Secure Password Requirements**
- **Minimum 10 characters** (upgraded from 6)
- **Required complexity:**
  - At least 1 uppercase letter (A-Z)
  - At least 1 number (0-9)
  - At least 1 special character (!@#$%^&*()_+...)
- **Hashing**: bcryptjs with 10 salt rounds
- **Validation**: Server-side validation prevents weak passwords

**Example error:**
```json
{
  "message": "Password does not meet security requirements.",
  "requirements": [
    "Password must be at least 10 characters long.",
    "Password must contain at least one number."
  ]
}
```

### 3. **Rate Limiting**
- **Default**: 5 requests per 15 minutes on auth endpoints
- **Endpoints Protected**:
  - `POST /api/auth/login`
  - `POST /api/auth/signup`
- **Response**: 429 (Too Many Requests) with retry-after info
- **Headers**: Includes `X-RateLimit-*` headers per request

**Example response when limit exceeded:**
```json
{
  "message": "Too many requests. Please try again in 300 seconds.",
  "retryAfter": 300
}
```

### 4. **Security Headers (Helmet.js)**
Automatically adds HTTP security headers:
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Blocks clickjacking attacks
- `Strict-Transport-Security` - Enforces HTTPS
- `X-XSS-Protection` - XSS attack prevention
- `Content-Security-Policy` - Script injection prevention

### 5. **CORS Configuration**
- **Whitelist**: Only specified origin domains can access API
- **Credentials**: Supports credential-based requests
- **Methods**: Explicit HTTP method allowlist

**Configuration (.env):**
```
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 6. **Input Validation & Sanitization**
- **Email Validation**: RFC 5322 format check
- **Input Sanitization**: Removes newlines, trims whitespace
- **SQL Injection Prevention**: Parameterized queries (pg library)
- **Request Size Limit**: 1MB max JSON payload

### 7. **Enhanced Authentication Middleware**
Updated `requireAuth` now:
- Accepts tokens from `Authorization: Bearer <token>` header
- Verifies token signature with JWT library
- Checks token expiry
- Rejects invalid/expired tokens (401 response)
- Makes token available as `req.user` object

**Example authenticated request:**
```javascript
const response = await fetch('/api/profile', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

## 🛡️ Protection Against Common Attacks

| Attack | Prevention |
|--------|-----------|
| **Brute Force Login** | Rate limiting (5 attempts/15min) |
| **SQL Injection** | Parameterized queries |
| **XSS (Cross-Site Scripting)** | Input sanitization + CSP headers |
| **CSRF (Cross-Site Forgery)** | CORS whitelist + SameSite cookies |
| **Weak Passwords** | Complexity requirements |
| **Session Hijacking** | JWT signature validation |
| **Man-in-the-Middle** | HTTPS requirement + strict CORS |
| **Clickjacking** | X-Frame-Options header |
| **MIME Sniffing** | X-Content-Type-Options header |

## 📋 Configuration

### Environment Variables (.env)
```bash
# JWT Configuration
JWT_SECRET=your-super-secret-key-minimum-32-characters
JWT_EXPIRY=7d

# Database (use strong password)
DB_PASSWORD=minimum_20_characters_strong_password

# CORS
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000        # 15 minutes in milliseconds
RATE_LIMIT_MAX_REQUESTS=5          # 5 requests per window

# HTTPS (Production)
USE_HTTPS=true
SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem
```

### Password Requirements Display
Inform users on signup page about requirements:
- ✓ Minimum 10 characters
- ✓ At least one uppercase letter
- ✓ At least one number
- ✓ At least one special character (!@#$%^&*()_+...)

## 🔄 Frontend Implementation

### Token Storage & Management
Frontend provides helper functions in `api.js`:

```javascript
import { 
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getAuthHeaders
} from './api';

// Get current valid token (returns null if expired)
const token = getAuthToken();

// Store token after login
setAuthToken(token, expiresAt);

// Get headers with authorization
const headers = getAuthHeaders();
// Returns: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <token>' }

// Clear token on logout
clearAuthToken();
```

### Token Expiry Handling
Tokens are automatically:
- Checked for expiry on each API call
- Removed from localStorage if expired
- Null returned if not found or expired

## 🚀 Installation & Deployment

### Install Dependencies
```bash
cd backend
npm install

# Verify installations:
npm ls jsonwebtoken helmet
```

### Environment Setup
```bash
# Copy example to .env
cp .env.example .env

# Edit .env with your values:
# 1. Change JWT_SECRET to a random 32+ character string
# 2. Set DB_PASSWORD to a strong password
# 3. Add your CORS_ALLOWED_ORIGINS
```

### Production Checklist
- [ ] `JWT_SECRET` is random, 32+ characters, stored securely
- [ ] `NODE_ENV=production` in .env
- [ ] HTTPS enabled with valid certificate
- [ ] `CORS_ALLOWED_ORIGINS` restricted to your domain(s)
- [ ] Database password is strong (20+ characters)
- [ ] Rate limiting enabled in .env
- [ ] Email notifications configured (optional)
- [ ] Database backups configured
- [ ] Monitoring/logging enabled

## 🔍 Testing Security

### Test Rate Limiting
```bash
# Try 6 login attempts in quick succession - 6th should fail
for i in {1..6}; do
  curl -X POST http://localhost:5001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"Test123!","userRole":"customer"}'
done
```

### Test Token Validation
```bash
# Without token - should fail
curl http://localhost:5001/api/requests/user/1

# With invalid token - should fail
curl -H "Authorization: Bearer invalid.token.here" \
  http://localhost:5001/api/requests/user/1

# With valid token - should succeed
curl -H "Authorization: Bearer $VALID_TOKEN_HERE" \
  http://localhost:5001/api/requests/user/1
```

### Test Password Validation
```bash
# Try weak password - should fail
curl -X POST http://localhost:5001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Test User",
    "email":"test@example.com",
    "password":"weak",
    "userRole":"customer"
  }'
```

## 📚 Additional Resources

- [JWT.io - JWT Introduction](https://jwt.io/introduction)
- [OWASP Top 10 Security Risks](https://owasp.org/Top10/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [bcryptjs Documentation](https://github.com/dcodeIO/bcrypt.js)

## ⚠️ Known Limitations & Future Improvements

**Current State (Phase 4):**
- ✅ JWT authentication
- ✅ Strong password requirements
- ✅ Rate limiting on auth endpoints
- ✅ Security headers

**Future Enhancements:**
- [ ] Rate limiting on all endpoints (not just auth)
- [ ] Two-factor authentication (2FA)
- [ ] Refresh tokens for long-lived sessions
- [ ] OAuth 2.0 / Social login
- [ ] API key authentication for service-to-service
- [ ] Audit logging of sensitive operations
- [ ] Automated security scanning
- [ ] Database encryption at rest
- [ ] End-to-end encryption for messages

---

**Last Updated**: March 31, 2026  
**Version**: 1.0  
**Status**: Production-Ready for Hackathon Demo

