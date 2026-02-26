# Phase 1 Verification Checklist ✅

Use this to verify Phase 1 was installed correctly.

## Code Changes Verification

### ✅ requirements.txt
- [ ] Flask-CORS==5.0.0 is listed in Web Framework section
- [ ] File location: `Backend/requirements.txt`

### ✅ app.py
- [ ] `from flask_cors import CORS` import added
- [ ] `from blueprints.auth_api_bp import auth_api_bp` import added
- [ ] `CORS(app, origins=[...])` configuration in create_app()
- [ ] `supports_credentials=True` is set
- [ ] `app.register_blueprint(auth_api_bp)` called before other blueprints
- [ ] File location: `Backend/app.py`

### ✅ auth_api_bp.py (NEW)
- [ ] File exists: `Backend/blueprints/auth_api_bp.py`
- [ ] Contains 5 endpoints:
  - [ ] `/api/auth/login` (GET)
  - [ ] `/api/auth/callback` (GET)
  - [ ] `/api/auth/me` (GET)
  - [ ] `/api/auth/logout` (POST)
  - [ ] `/api/auth/check` (GET)
- [ ] All endpoints return JSON
- [ ] OAuth flow is implemented
- [ ] Decorator `@require_auth` protects `/api/auth/me`

## Installation Verification

### ✅ Dependencies Installed
```bash
cd Backend
python -c "import flask_cors; print(flask_cors.__version__)"
```
Expected output: Should show Flask-CORS version without error

### ✅ Flask App Starts
```bash
cd Backend
python app.py
```
Expected output:
```
 * Running on http://0.0.0.0:5000
```
No import errors or exceptions

## API Testing

### ✅ CORS is Enabled
```bash
curl -i http://localhost:5000/api/auth/check \
  -H "Origin: http://localhost:4200" \
  -H "Content-Type: application/json"
```
Expected: Response includes header `Access-Control-Allow-Origin: http://localhost:4200`

### ✅ /api/auth/check Works
```bash
curl http://localhost:5000/api/auth/check
```
Expected response:
```json
{
  "authenticated": false,
  "user_id": null
}
```

### ✅ /api/auth/login Returns Authorization URL
```bash
curl http://localhost:5000/api/auth/login
```
Expected response (contains these fields):
```json
{
  "authorization_url": "https://accounts.google.com/...",
  "state": "some_state_value"
}
```

## Security Verification

### ✅ Session Cookies Work
```bash
# Create a session by calling login callback manually 
# (in real use, Google does this)
# Then verify cookies are set
```
Check that HTTP requests include session cookies for authenticated requests

### ✅ CORS Origins Restricted
In `app.py`, verify CORS only allows:
- [ ] http://localhost:4200
- [ ] http://localhost:8080
- [ ] http://127.0.0.1:4200
- [ ] http://127.0.0.1:8080
- [ ] Production origin (if set)

### ✅ Error Handling
Test error scenarios:
```bash
# Missing credentials (should return 401)
curl http://localhost:5000/api/auth/me

# Invalid state in callback
curl http://localhost:5000/api/auth/callback?code=bad&state=bad
```

## Backward Compatibility

### ✅ Old Routes Still Work
Verify template-based auth routes still work:
- [ ] GET `/auth/login` - redirects to Google (HTML page)
- [ ] GET `/auth/callback` - OAuth callback (redirects to /recipe)
- [ ] GET `/auth/profile` - displays profile (HTML template)
- [ ] GET `/auth/logout` - clears session

## Documentation Created

### ✅ Documentation Files
- [ ] `PHASE_1_COMPLETE.md` - Detailed guide
- [ ] `PHASE_1_QUICK_START.md` - Quick reference
- [ ] `PHASE_1_IMPLEMENTATION_SUMMARY.md` - Summary
- [ ] `PHASE_1_VERIFICATION_CHECKLIST.md` - This file

## Environment Setup

### ✅ .env File
Ensure file exists at `Backend/.env` with:
```
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_secret
FLASK_SECRET_KEY=your_secret_key (optional)
```

## Angular Integration Ready

### ✅ Angular Can Call Endpoints
From Angular component (when running on :4200):
```typescript
// This should work without CORS errors
this.http.get('http://localhost:5000/api/auth/check', 
  { withCredentials: true })
  .subscribe(res => console.log(res));
```

## Troubleshooting

### If Dependencies Fail to Install
```bash
cd Backend
pip install --upgrade pip
pip install Flask-CORS==5.0.0
```

### If CORS Errors Still Occur
1. Verify `CORS()` is called in `create_app()` before registering blueprints
2. Check browser console for actual error message
3. Verify `supports_credentials=True` is set

### If OAuth Fails
1. Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in .env
2. Verify redirect URI matches in Google Cloud Console
3. Check logs for error messages: `python app.py 2>&1 | grep -i error`

## Performance Check

### ✅ No Performance Degradation
- [ ] App still starts in < 5 seconds
- [ ] API responses < 200ms
- [ ] No memory leaks (check with `watch -n 1 'ps aux | grep python'`)

## Sign-Off

When all checkboxes are ✅:
- **Phase 1 is verified complete**
- **Ready to proceed to Phase 2**

---

**Verification Date:** ___________  
**Verified By:** ___________  
**Status:** ☐ COMPLETE ☐ ISSUES FOUND

## Issues Found (if any)

List any issues discovered:
1. 
2. 
3. 

---

**Next Step:** Phase 2 - Angular Frontend Integration
