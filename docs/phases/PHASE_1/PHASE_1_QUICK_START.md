# Phase 1 Quick Reference 🚀

## What Just Happened

✅ **Flask Backend now has REST API authentication endpoints**

Your Flask app is now ready to serve API requests from your Angular frontend!

## The 5 New Endpoints

### 1. Login Initiation

```
GET /api/auth/login
→ Returns: { authorization_url: "...", state: "..." }
→ Purpose: Start OAuth login flow
```

### 2. OAuth Callback

```
GET /api/auth/callback?code=...&state=...
→ Called by Google after authentication
→ Sets session cookie automatically
```

### 3. Get Current User

```
GET /api/auth/me
→ Returns: { user_id, email, name, picture, authenticated: true }
→ Requires: Session cookie from login
```

### 4. Check Auth Status

```
GET /api/auth/check
→ Returns: { authenticated: true/false, user_id?, email?, ... }
→ No auth required - safe to call anytime
```

### 5. Logout

```
POST /api/auth/logout
→ Returns: { message: "Logged out", authenticated: false }
→ Clears session cookie
```

## How to Use from Angular

### Quick Start (Copy-Paste Ready)

```typescript
import { HttpClient } from '@angular/common/http';

constructor(private http: HttpClient) {}

// Check if logged in
checkAuth() {
  this.http.get('http://localhost:5000/api/auth/check',
    { withCredentials: true })
    .subscribe(res => console.log(res));
}

// Start login
login() {
  this.http.get<any>('http://localhost:5000/api/auth/login',
    { withCredentials: true })
    .subscribe(res => {
      window.location.href = res.authorization_url;
    });
}

// Get user info
getUser() {
  this.http.get('http://localhost:5000/api/auth/me',
    { withCredentials: true })
    .subscribe(res => console.log(res));
}

// Logout
logout() {
  this.http.post('http://localhost:5000/api/auth/logout', {},
    { withCredentials: true })
    .subscribe(res => console.log(res));
}
```

**IMPORTANT:** Always use `{ withCredentials: true }` so session cookies are sent!

## Files Changed

```
Backend/
├── requirements.txt          ← Added Flask-CORS
├── app.py                   ← Added CORS config + import
└── blueprints/
    └── auth_api_bp.py       ← NEW: 5 endpoints
```

## How to Test

### Terminal 1: Start Flask

```bash
cd Backend
python app.py
```

### Terminal 2: Test with curl

```bash
# Check auth (should be false)
curl -X GET http://localhost:5000/api/auth/check

# Get login URL
curl -X GET http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json"
```

### Terminal 3: Start Angular (existing)

```bash
npm start
# Or ng serve on port 4200
```

## Architecture Now Looks Like

```
Express Server (8080)          Flask Server (5000)
├─ Serves Angular app          ├─ /api/auth/* (NEW)
├─ /api/recipe (Gemini)        ├─ /api/recipes/* (next phase)
└─ /api/image (Imagen)         └─ /api/users/* (next phase)

        ↓ CORS allows ↓

     Angular Frontend (4200)
     ├─ Calls Express for AI generation
     └─ Calls Flask for authentication & user data
```

## Environment Variables Needed

Make sure `.env` has:

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
FLASK_SECRET_KEY=some-random-string (or leave blank for dev)
```

## What's Working Now

✅ OAuth flow between Flask and Google  
✅ CORS headers (Angular can call Flask)  
✅ Session cookies (secure user tracking)  
✅ JSON responses (API-ready)  
✅ Error handling (proper HTTP status codes)

## What's Next (Phase 2)

Phase 2 will add:

- Angular auth service/component
- Protected routes
- User profile display
- Recipe save endpoints

---

**Phase 1 Complete!** Your backend is ready for the frontend. 🎉
