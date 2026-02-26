# Pre-Deployment Security Checklist

Use this checklist before deploying to production.

## ✅ Code Changes
- [ ] All security files created:
  - [ ] `server/security.ts`
  - [ ] `server/validation.ts`
  - [ ] `server/types.ts`
- [ ] `server/index.ts` updated with middleware
- [ ] `package.json` updated with dependencies
- [ ] All imports verified (no broken references)
- [ ] TypeScript compilation successful: `npm run build`

## ✅ Dependencies
- [ ] All new packages installed: `npm install`
- [ ] No peer dependency warnings
- [ ] `npm audit` shows no critical vulnerabilities
- [ ] Dependencies are latest stable versions:
  - express-rate-limit@^7.1.5
  - helmet@^7.1.0
  - express-validator@^7.1.0
- [ ] Lock file (`package-lock.json`) updated and committed

## ✅ Configuration
- [ ] `.env.local` created from `.env.example`
- [ ] All required env vars set:
  - [ ] `PORT`
  - [ ] `NODE_ENV=production`
  - [ ] `VITE_GEMINI_API_KEY`
- [ ] Optional env vars configured (if applicable):
  - [ ] `FRONTEND_URL`
  - [ ] `LOG_LEVEL`
- [ ] No sensitive data in code or git

## ✅ Rate Limiting
- [ ] Rate limit values reviewed and appropriate:
  - [ ] General API: 100/15min
  - [ ] Expensive ops: 20/1hr
  - [ ] Adjusted if needed for your traffic patterns
- [ ] Health endpoint properly excluded from limits
- [ ] Tested with rapid requests

## ✅ Security Headers
- [ ] Helmet.js enabled
- [ ] Custom security headers verified:
  - [ ] X-Content-Type-Options: nosniff
  - [ ] X-Frame-Options: DENY
  - [ ] X-XSS-Protection set
  - [ ] Referrer-Policy configured
- [ ] Headers tested with curl: `curl -I http://localhost:8080/api/health`

## ✅ Input Validation
- [ ] All validation rules reviewed
- [ ] Test cases created for:
  - [ ] Valid inputs (should succeed)
  - [ ] Empty inputs (should fail)
  - [ ] Boundary cases (exactly at limit)
  - [ ] Oversized inputs (should fail)
  - [ ] Invalid types (should fail)
- [ ] Validation errors clear to users
- [ ] No sensitive details in validation errors

## ✅ Error Handling
- [ ] Error responses don't leak sensitive info
- [ ] Tested error responses don't show stack traces
- [ ] Server logs contain full error details
- [ ] Error handling tested with:
  - [ ] Invalid API key
  - [ ] Network timeout
  - [ ] Malformed JSON

## ✅ Payload Size
- [ ] JSON limit set to 50KB (not 15MB)
- [ ] Tested that normal requests still work
- [ ] Tested that oversized payloads are rejected
- [ ] Appropriate error message for oversized requests

## ✅ Request Logging
- [ ] Logging middleware enabled
- [ ] Log format verified in console output
- [ ] Tested with sample requests
- [ ] Logs show:
  - [ ] Timestamp
  - [ ] HTTP method
  - [ ] Path
  - [ ] Status code
  - [ ] Duration

## ✅ Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] API endpoints tested:
  - [ ] GET /api/health (should work, no rate limit)
  - [ ] POST /api/recipe (with valid prompt)
  - [ ] POST /api/image (with valid keywords)
  - [ ] POST /api/recipe (invalid - empty prompt)
  - [ ] POST /api/image (invalid - missing recipeName)
- [ ] Rate limit hitting verified
- [ ] Performance acceptable (check logs for durations)

## ✅ Documentation
- [ ] Updated README or docs
- [ ] Security documentation in place:
  - [ ] `SECURITY.md`
  - [ ] `SECURITY_QUICKSTART.md`
  - [ ] `DEVELOPER_GUIDE.md`
  - [ ] `CHANGELOG_SECURITY.md`
  - [ ] `SECURITY_IMPLEMENTATION_REPORT.md`
- [ ] Team aware of new security features
- [ ] Documentation reviewed by team

## ✅ Deployment Preparation
- [ ] Build artifacts generated: `npm run build`
- [ ] No build errors or warnings
- [ ] Distribution files in `dist/` directory
- [ ] Can start production server: `npm start`
- [ ] Health check endpoint responds

## ✅ Production-Only Requirements
- [ ] HTTPS/TLS configured (or planned)
  - [ ] SSL certificate obtained
  - [ ] Reverse proxy configured (nginx/Cloudflare)
  - [ ] HTTP → HTTPS redirect enabled
  - [ ] HSTS header verified
- [ ] API key is:
  - [ ] In environment variable (not in code)
  - [ ] Rotating strategy in place
  - [ ] Access audit trail maintained
- [ ] Secrets management system ready (if using)
- [ ] Error monitoring service configured
- [ ] Log aggregation service configured
- [ ] Uptime monitoring configured

## ✅ Team Communication
- [ ] Team notified of changes
- [ ] New security features documented
- [ ] Breaking changes communicated (if any)
- [ ] Updated deployment procedures
- [ ] Support team aware of new error types
- [ ] Release notes prepared

## ✅ Post-Deployment
- [ ] Monitor error rates in production
- [ ] Monitor rate limit hits
- [ ] Check logs for unexpected patterns
- [ ] Verify security headers in production
- [ ] Test from real client (not just localhost)
- [ ] Monitor API response times
- [ ] Check for any performance regressions

## ✅ Advanced Security (Optional but Recommended)
- [ ] CORS configured for specific domains
- [ ] Request timeout handling implemented
- [ ] Request ID tracking added
- [ ] Security event logging enhanced
- [ ] API authentication implemented
- [ ] Per-user rate limiting added
- [ ] Monitoring alerts configured
- [ ] Incident response plan updated

## 🔒 Security Hardening Reminders

### Before Going Live
1. **Review all error messages** - Ensure no sensitive info is leaked
2. **Test rate limiting** - Confirm it kicks in appropriately
3. **Verify headers** - Use curl to check security headers are present
4. **Check logs** - Verify logging is working and informative
5. **Validate input** - Test with various invalid inputs

### In Production
1. **Monitor logs daily** - Look for suspicious patterns
2. **Check rate limits** - Verify legitimate users aren't hitting limits
3. **Review errors** - Investigate unexpected error spikes
4. **Update dependencies** - Keep security packages current
5. **Audit access** - Who is accessing the API, how often

### Security Best Practices
- [ ] Keep dependencies updated
- [ ] Run `npm audit` regularly
- [ ] Monitor for CVEs affecting dependencies
- [ ] Rotate API keys periodically
- [ ] Review and adjust rate limits based on real usage
- [ ] Keep security documentation updated
- [ ] Regular security reviews (monthly)
- [ ] Incident response plan in place

## 📋 Checklist Completion

- **Date Completed:** _______________
- **Completed By:** _______________
- **Reviewed By:** _______________
- **Approved for Production:** ☐ YES ☐ NO

### Notes:
```
_________________________________________________________________

_________________________________________________________________

_________________________________________________________________
```

---

## Quick Commands Reference

```bash
# Install dependencies
npm install

# Check for vulnerabilities
npm audit

# Run TypeScript build
npm run build

# Start development server
npm run dev

# Start production server
npm start

# Test rate limiting
for i in {1..25}; do
  curl -X POST http://localhost:8080/api/recipe \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test"}'
  sleep 2
done

# Check security headers
curl -I http://localhost:8080/api/health

# Test validation error
curl -X POST http://localhost:8080/api/recipe \
  -H "Content-Type: application/json" \
  -d '{"prompt": ""}'
```

---

**For detailed information, refer to:**
- `SECURITY.md` - Complete security guide
- `SECURITY_QUICKSTART.md` - Implementation details
- `DEVELOPER_GUIDE.md` - Developer reference
- `SECURITY_IMPLEMENTATION_REPORT.md` - Full report
