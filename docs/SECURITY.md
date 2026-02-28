# Security Implementation Guide

## Overview

This document outlines the security enhancements implemented in the Vegangenius Chef backend to make it production-ready. The implementation addresses key vulnerabilities and follows OWASP best practices.

## Implemented Security Measures

### 1. **Rate Limiting** ✅
**File:** `server/security.ts`

Rate limiting prevents abuse, DOS attacks, and controls API costs.

**Configuration:**
- **General API endpoints:** 100 requests per 15 minutes per IP
- **Expensive operations** (`/api/recipe`, `/api/image`): 20 requests per hour per IP
- **Health check:** Excluded from rate limiting

**How it works:**
- Uses `express-rate-limit` middleware
- Returns `429 Too Many Requests` when limits are exceeded
- Includes rate limit info in response headers

**Client Impact:**
```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1234567890
```

### 2. **Security Headers** ✅
**File:** `server/security.ts`

Implemented via `helmet` middleware and custom headers:

- **X-Content-Type-Options: nosniff** - Prevents MIME type sniffing
- **X-Frame-Options: DENY** - Prevents clickjacking
- **X-XSS-Protection: 1; mode=block** - Legacy XSS protection
- **Referrer-Policy: strict-origin-when-cross-origin** - Controls referrer information
- **Helmet defaults:** CSP, HSTS, X-Powered-By removal, etc.

### 3. **Input Validation** ✅
**File:** `server/validation.ts`

Strict input validation using `express-validator`:

**Recipe endpoint (`/api/recipe`):**
- `prompt`: String, 1-500 characters

**Image endpoint (`/api/image`):**
- `recipeName`: String, 1-100 characters
- `keywords`: Array of 1-10 strings
- Each keyword: 1-50 characters

**Validation failures** return 400 status with detailed error info:
```json
{
  "error": "Invalid request",
  "details": [
    {
      "field": "prompt",
      "message": "Prompt must be between 1 and 500 characters"
    }
  ]
}
```

### 4. **Payload Size Limits** ✅
**File:** `server/index.ts`

Reduced JSON payload limit from 15MB to 50KB:
- Prevents large payload DOS attacks
- Protects against memory exhaustion
- Sufficient for normal API usage

### 5. **Error Handling** ✅
**Files:** `server/security.ts`, `server/index.ts`

Implements secure error handling:
- **Server-side:** Full error details logged for debugging
- **Client-side:** Generic error messages (no sensitive leaks)
- Prevents information disclosure about internals

**Example:**
```typescript
catch (error) {
  console.error("Recipe generation error:", error);
  res.status(500).json({ 
    error: "An unexpected error occurred while generating the recipe."
  });
}
```

### 6. **Request Logging** ✅
**File:** `server/security.ts`

Logs all API requests with:
- Timestamp
- HTTP method and path
- Response status code
- Request duration

Useful for:
- Debugging issues
- Security monitoring
- Performance analysis

**Log Format:**
```
[2026-02-25T12:30:45.123Z] POST /api/recipe - 200 (1250ms)
[2026-02-25T12:30:46.456Z] GET /api/health - 200 (5ms)
```

## Security Dependencies

Added to `package.json`:
- `express-rate-limit@^7.1.5` - Rate limiting
- `helmet@^7.1.0` - Security headers
- `express-validator@^7.1.0` - Input validation
- `@types/express-rate-limit@^6.0.0` - TypeScript types

## Installation & Usage

### Install dependencies:
```bash
npm install
```

### Build:
```bash
npm run build
```

### Start production server:
```bash
npm start
```

### Development:
```bash
npm run dev
```

## Environment Variables

### Recommended for production:
```bash
NODE_ENV=production
PORT=8080
VITE_GEMINI_API_KEY=your-api-key
```

Consider using:
- `.env.local` for local development
- Environment management tools (like dotenv) for production
- Secrets management systems (e.g., Google Cloud Secret Manager)

## Additional Security Recommendations

### 1. **Authentication (Priority: HIGH)**
Consider implementing authentication for the following reasons:
- Control who can access the API
- Track usage per user
- Implement per-user rate limits
- Better cost management

**Options:**
- **API Key authentication** - Simple, good for public APIs with trusted clients
- **JWT authentication** - More robust, suitable for user accounts
- **OAuth 2.0** - Industry standard for delegated access

**Example API Key implementation:**
```typescript
const verifyApiKey = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/api/', verifyApiKey);
```

### 2. **CORS Configuration (Priority: MEDIUM)**
Currently, CORS is open (Express default). Consider restricting:

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST'],
}));
```

### 3. **Request Timeouts (Priority: MEDIUM)**
Add timeout middleware to prevent hanging requests:

```typescript
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  next();
});
```

### 4. **API Monitoring & Alerting (Priority: MEDIUM)**
Implement monitoring for:
- Spike in error rates
- Unusual rate limit hits
- API latency increases
- Failed authentication attempts

### 5. **HTTPS/TLS (Priority: CRITICAL)**
**Always use HTTPS in production:**
- Use reverse proxy (nginx, Cloudflare)
- Obtain SSL certificate (Let's Encrypt, Cloud Armor)
- Enforce HTTPS with HSTS headers (already set by Helmet)

### 6. **Database Security (Priority: CRITICAL)**
If you add a database:
- Use prepared statements to prevent SQL injection
- Hash passwords with bcrypt or Argon2
- Implement proper access controls
- Regular backups with encryption

### 7. **API Key Security (Priority: CRITICAL)**
For the Gemini API key:
- **NEVER** commit to Git
- Use environment variables only
- Rotate keys regularly
- Monitor usage for unauthorized access
- Consider using separate keys for dev/prod

### 8. **Dependency Management (Priority: HIGH)**
Regularly update dependencies:
```bash
npm audit
npm update
```

Consider using:
- Dependabot for automated PR checks
- npm audit to check for CVEs
- Pin to specific versions in production

### 9. **Security Headers - CORS (Priority: MEDIUM)**

For better CORS control:
```typescript
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:4200');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
  next();
});
```

### 10. **Logging & Monitoring (Priority: MEDIUM)**
Enhance logging:
- Send logs to centralized service (e.g., Cloud Logging)
- Set up alerts for suspicious activity
- Monitor rate limit threshold hits
- Track API errors and performance

## Testing Security

### Test rate limiting:
```bash
# Should succeed (within limit)
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a vegan pasta recipe"}'

# After 20 requests in an hour, should get 429
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a vegan pasta recipe"}' \
  # Returns: 429 Too Many Requests
```

### Test input validation:
```bash
# Invalid: empty prompt
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": ""}'
# Returns: 400 with validation details

# Invalid: prompt too long (>500 chars)
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": "x[repeated 501 times]"}'
# Returns: 400 with validation details
```

### Test error handling:
```bash
# Should return generic error (not internal details)
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}' \
  # (with invalid API key)
# Returns: 500 with generic message only
```

## Monitoring Checklist

- [ ] Set up error logging/monitoring service
- [ ] Configure alerts for rate limit threshold
- [ ] Monitor API latency
- [ ] Track failed requests/validation errors
- [ ] Regular security audits
- [ ] Dependency updates via automated tools
- [ ] HTTPS/TLS verification in production
- [ ] API key rotation schedule
- [ ] Backup and disaster recovery plan

## Compliance & Standards

This implementation aligns with:
- **OWASP Top 10** - Covers many key vulnerabilities
- **CWE/SANS Top 25** - Includes common weaknesses
- **NIST Cybersecurity Framework** - Core security practices

## Version History

- **v1.0** (2026-02-25) - Initial security implementation
  - Rate limiting
  - Security headers
  - Input validation
  - Error handling improvements
  - Request logging

## Support & Further Help

For questions about implementing the recommended security measures, refer to:
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Security Checklist](https://nodejs.org/en/docs/guides/nodejs-security-checklist/)
