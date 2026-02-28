# Developer's Quick Reference - Security Features

## Overview
Your API now has enterprise-grade security features. This guide helps developers understand and work with them.

## What Each Component Does

### 1. Rate Limiting
**Files:** `server/security.ts`, `server/index.ts`

Limits the number of requests from each IP address:
- General API: 100 requests per 15 minutes
- Recipe/Image generation: 20 requests per hour

**What you'll see:**
```
Success (within limit):
HTTP 200 OK
RateLimit-Limit: 20
RateLimit-Remaining: 19
RateLimit-Reset: 1645000000

When rate limit exceeded:
HTTP 429 Too Many Requests
{
  "error": "Too many requests, please try again later."
}
```

**In tests:**
- Use `request-id` header for logging
- Account for rate limits in test suites
- Mock responses for unit tests to avoid hitting limits

### 2. Helmet.js Security Headers
**Files:** `server/security.ts`, `server/index.ts`

Automatically adds security headers to every response:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: ...
Strict-Transport-Security: ...
```

**What this protects against:**
- Cross-Site Scripting (XSS)
- Clickjacking attacks
- MIME type sniffing
- Information leakage

### 3. Input Validation
**Files:** `server/validation.ts`, `server/index.ts`

Validates all input before processing:

#### Recipe Endpoint
```typescript
POST /api/recipe
{
  "prompt": "string, required, 1-500 characters"
}

// Invalid examples:
{ "prompt": "" }                           // Too short
{ "prompt": "x" × 501 }                   // Too long
{ "prompt": 123 }                         // Wrong type
```

#### Image Endpoint
```typescript
POST /api/image
{
  "recipeName": "string, 1-100 characters",
  "keywords": [
    "string, 1-50 characters each",
    "1-10 keywords total"
  ]
}

// Invalid examples:
{ "recipeName": "", "keywords": [] }      // Empty
{ "recipeName": "x" × 101, "keywords": ["test"] }  // Too long
{ "keywords": ["test"] }                  // Missing recipeName
```

**Error Response:**
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

### 4. Error Handling
**Files:** `server/security.ts`, `server/index.ts`

Logs errors server-side, sends generic messages to clients:

**Server logs (detailed):**
```
[ERROR] {
  "timestamp": "2026-02-25T12:30:45.123Z",
  "method": "POST",
  "path": "/api/recipe",
  "statusCode": 500,
  "error": "API key is invalid",
  "stack": "..."
}
```

**Client response (generic):**
```json
{
  "error": "An unexpected error occurred while generating the recipe."
}
```

**Why?** Prevents attackers from learning about your system's internals.

### 5. Request Logging
**Files:** `server/security.ts`

Every request is logged with timing info:
```
[2026-02-25T12:30:45.123Z] POST /api/recipe - 200 (1250ms)
[2026-02-25T12:30:46.456Z] POST /api/image - 400 (5ms)
[2026-02-25T12:30:47.789Z] GET /api/health - 200 (2ms)
```

**Look for:**
- 429 responses = Rate limit hit
- 400 responses = Validation failed
- 5xx responses = Server error
- High duration times = Performance issue

## Common Tasks

### Adjusting Rate Limits

**In `server/security.ts`:**
```typescript
// General API - slower operations
export const createApiLimiter = (
  windowMs: number = 15 * 60 * 1000,  // Time window
  max: number = 100                    // Max requests
) => {
  // ...
};

// Expensive operations - stricter limits
export const createExpensiveOperationLimiter = (
  windowMs: number = 60 * 60 * 1000,  // 1 hour
  max: number = 20                     // 20 requests
) => {
  // ...
};
```

**In `server/index.ts`:**
```typescript
// To change settings:
const apiLimiter = createApiLimiter(
  15 * 60 * 1000,  // 15 minutes
  100              // 100 requests
);

const expensiveOpLimiter = createExpensiveOperationLimiter(
  60 * 60 * 1000,  // 1 hour
  50               // Changed from 20 to 50
);
```

### Customizing Validation Rules

**In `server/validation.ts`:**
```typescript
// Make prompt longer (up to 1000 chars)
export const validateRecipeRequest = [
  body("prompt")
    .isString()
    .trim()
    .isLength({ min: 1, max: 1000 })  // Changed from 500
    .withMessage("Prompt must be between 1 and 1000 characters"),
];

// Allow more keywords (up to 20)
export const validateImageRequest = [
  // ...
  body("keywords")
    .isArray({ min: 1, max: 20 })  // Changed from 10
    .withMessage("Keywords must be an array with 1-20 items"),
  // ...
];
```

### Testing with Security Middleware

**For rate limiting, test with delays:**
```bash
for i in {1..20}; do
  curl -X POST http://localhost:8080/api/recipe \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test recipe"}'
  sleep 3  # Delay between requests
done
```

**For validation, test edge cases:**
```bash
# Test empty input
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": ""}'

# Test boundary (exactly at limit)
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": "'$(printf 'a%.0s' {1..500})'"}' # Exactly 500 chars - should pass
```

### Debugging Issues

**Rate limit hitting too fast:**
1. Check actual request volume
2. Increase limits in `server/security.ts`
3. Check if multiple processes are making requests
4. Verify X-Forwarded-For header if behind proxy

**Validation errors:**
1. Check exact error message in response
2. Verify input matches the validation rules
3. Check `server/validation.ts` for rule definitions
4. Ensure Content-Type is `application/json`

**Performance issues:**
1. Check request duration in logs
2. See if specific endpoints are slow
3. Profile database/API calls
4. Consider caching for repeated requests

## Architecture

```
Express App
├── Security Middleware
│   ├── Helmet.js (security headers)
│   ├── Request Logger
│   └── Rate Limiter
├── Routes
│   ├── POST /api/recipe
│   │   ├── Rate Limiter (expensive op)
│   │   ├── Validation
│   │   ├── Handler
│   │   └── Error Handler
│   ├── POST /api/image
│   │   ├── Rate Limiter (expensive op)
│   │   ├── Validation
│   │   ├── Handler
│   │   └── Error Handler
│   └── GET /api/health
│       └── Handler
├── Static Files (dist/)
└── Error Handler (middleware)
```

## Common HTTP Status Codes

| Code | Meaning | Common Cause |
|------|---------|-------------|
| 200 | Success | Request processed successfully |
| 400 | Bad Request | Validation failed, check response for details |
| 429 | Rate Limit | Too many requests, wait before retrying |
| 500 | Server Error | Unexpected error, check server logs |
| 502 | Bad Gateway | External API error (Gemini API issue) |

## Environment Variables

Essential for production:
```bash
NODE_ENV=production              # Not development
PORT=8080                        # Server port
VITE_GEMINI_API_KEY=xxx         # Gemini API key (REQUIRED)
```

Optional for advanced setup:
```bash
FRONTEND_URL=https://yourdomain.com   # For CORS
API_KEY=your-secret-key              # For API authentication
LOG_LEVEL=info                       # Logging verbosity
```

## Testing Checklist

Before deployment:
- [ ] Rate limiting works (test with rapid requests)
- [ ] Validation rejects invalid input
- [ ] Valid requests are accepted
- [ ] Error responses don't leak sensitive info
- [ ] Logs show all requests
- [ ] Security headers present in responses
- [ ] Performance is acceptable (check logs for duration)

## Support & Resources

- **Full docs:** `SECURITY.md`
- **Quick start:** `SECURITY_QUICKSTART.md`
- **Changelog:** `CHANGELOG_SECURITY.md`
- **Types:** See `server/types.ts`
- **Configuration:** See `server/security.ts` and `server/validation.ts`

## Tips & Tricks

✅ **Enable CORS when needed:**
```typescript
import cors from 'cors';
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));
```

✅ **Skip rate limiting for health checks:**
Already done! Check `server/security.ts` - health endpoint is excluded.

✅ **Add custom request ID for tracking:**
```typescript
import { v4 as uuidv4 } from 'uuid';
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});
```

✅ **Monitor specific endpoints:**
```typescript
app.post("/api/recipe", (req, res) => {
  console.log(`Recipe request: prompt length = ${req.body.prompt.length}`);
  // ...
});
```

---

**Questions?** Check the relevant file in the workspace or review `SECURITY.md` for detailed information.
