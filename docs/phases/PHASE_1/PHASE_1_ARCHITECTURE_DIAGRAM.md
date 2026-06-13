# Phase 1 Architecture Diagram

## Complete System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BROWSER / USER                              │
│                                                                      │
│  1. User loads http://localhost:4200 (Angular app)                 │
│  2. Clicks "Login with Google" button                              │
│  3. Redirects to Google OAuth                                       │
│  4. Authenticates with Google credentials                           │
│  5. Google redirects back to Flask callback                         │
│  6. Sees user profile and "Logout" button                           │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               │ HTTP/HTTPS with CORS headers
               │
    ┌──────────▼──────────────────────────────────────┐
    │                                                  │
    │        Angular Frontend (Port 4200)            │
    │        │                                        │
    │        ├─ app.component.ts                      │
    │        ├─ auth.service.ts (NEW - Phase 2)      │
    │        ├─ recipe.service.ts                     │
    │        ├─ services/                             │
    │        └─ Components                            │
    │           ├─ login.component.ts (NEW)          │
    │           ├─ profile.component.ts (NEW)        │
    │           ├─ recipe-list.component.ts          │
    │           └─ recipe-generate.component.ts      │
    │                                                  │
    └────────────┬─────────────────────┬──────────────┘
                 │                     │
    HTTP GET/POST with withCredentials: true
                 │                     │
    ┌────────────▼────────┐  ┌────────▼───────────────┐
    │ Express Server      │  │ Flask Backend          │
    │ (Port 8080)         │  │ (Port 5000)            │
    │                     │  │                        │
    │ ✅ AI Generation    │  │ ✅ Authentication      │
    │   • /api/recipe     │  │   • /api/auth/login    │
    │   • /api/image      │  │   • /api/auth/me       │
    │                     │  │   • /api/auth/logout   │
    │ ✅ Frontend Serving │  │   • /api/auth/check    │
    │   • Static files    │  │   • /api/auth/callback │
    │   • Angular SPA     │  │                        │
    │                     │  │ ✅ User Data (Phase 3) │
    │ ✅ Rate Limiting    │  │   • /api/recipes/*     │
    │ ✅ Security         │  │   • /api/users/*       │
    │   • Helmet          │  │   • /api/favorites/*   │
    │   • HTTPS ready     │  │                        │
    │                     │  │ ✅ Enabled Features    │
    │                     │  │   • CORS (NEW)         │
    │                     │  │   • JSON responses     │
    │                     │  │   • Session cookies    │
    │                     │  │   • OAuth flow         │
    └─────────────────────┘  └────────────────────────┘
                 │                     │
                 └─────────┬───────────┘
                           │
                Google Cloud APIs
                           │
                ┌──────────▴─────────┐
                │                    │
            ┌───▼────────┐   ┌──────▴──────┐
            │ Google     │   │ Google      │
            │ OAuth 2.0  │   │ Generative  │
            │ (Gmail)    │   │ AI (Gemini) │
            └────────────┘   └─────────────┘
```

## Request Flow Diagram

### Authentication Login Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER LOGIN SEQUENCE                         │
└─────────────────────────────────────────────────────────────────┘

User Browser (localhost:4200)
         │
         │ "Login" button clicked
         │
         ▼
    Angular App
         │
         │ this.http.get('http://localhost:5000/api/auth/login')
         │ withCredentials: true
         │
         ▼
    Flask Server (localhost:5000)
         │
         ├─ @auth_api_bp.route('/api/auth/login', methods=['GET'])
         │
         ├─ Create Google OAuth Flow
         │
         ├─ Generate authorization_url + state
         │
         ├─ Store state in session['state']
         │
         ▼
    Response:
    {
      "authorization_url": "https://accounts.google.com/o/oauth2/auth?...",
      "state": "random_hash"
    }
         │
         │ Location header: Set-Cookie: session=...
         │
         ▼
    Angular App
         │
         │ window.location.href = authorization_url
         │
         ▼
    Google OAuth Page
         │
         │ User authenticates with Google credentials
         │
         ▼
    Google Redirects to:
    http://localhost:5000/api/auth/callback?code=xxx&state=yyy
         │
         ▼
    Flask Server
         │
         ├─ @auth_api_bp.route('/api/auth/callback', methods=['GET'])
         │
         ├─ Verify state matches session['state']
         │
         ├─ Exchange code for credentials with Google
         │
         ├─ Fetch user info from Google
         │
         ├─ Store in session:
         │  - session['credentials'] = {token, refresh_token, ...}
         │  - session['user_info'] = {email, name, picture, ...}
         │  - session['user_id'] = email
         │
         ▼
    Response:
    <script>window.location.href = "http://localhost:4200/dashboard"</script>
    Set-Cookie: session=secure_cookie; HttpOnly; Secure; SameSite=lax
         │
         ▼
    Angular App (Dashboard Page)
         │
         │ checkAuth() called in ngOnInit
         │
         │ this.http.get('http://localhost:5000/api/auth/check')
         │ withCredentials: true  ← Session cookie sent automatically
         │
         ▼
    Flask Server
         │
         ├─ @auth_api_bp.route('/api/auth/check', methods=['GET'])
         │
         ├─ Check if session['credentials'] exists
         │
         ▼
    Response:
    {
      "authenticated": true,
      "user_id": "user@example.com",
      "email": "user@example.com",
      "name": "User Name",
      "picture": "https://..."
    }
         │
         ▼
    Angular App
         │
         ├─ Store in authService.userSubject
         │
         ├─ Display user profile
         │
         └─ Enable "Logout" button
```

## File Organization (After Phase 1)

```
/home/adam/projects/tasteslikegoodtheangularsvegancookbook/
│
├── Backend/
│   ├── app.py (MODIFIED: Added CORS + auth_api_bp)
│   ├── auth.py (UNCHANGED: Old HTML-based auth)
│   ├── requirements.txt (MODIFIED: Added Flask-CORS)
│   │
│   └── blueprints/
│       ├── auth_api_bp.py (NEW: 5 REST API endpoints)
│       ├── api_bp.py (UNCHANGED)
│       ├── recipes_bp.py (UNCHANGED)
│       └── generation_bp.py (UNCHANGED)
│
├── server/
│   ├── index.ts (UNCHANGED: Express server)
│   ├── security.ts (UNCHANGED)
│   └── ... (UNCHANGED)
│
├── src/
│   └── (UNCHANGED: Angular frontend)
│
├── PHASE_1_DONE.md (NEW: Executive summary)
├── PHASE_1_COMPLETE.md (NEW: Detailed guide)
├── PHASE_1_QUICK_START.md (NEW: Quick reference)
├── PHASE_1_IMPLEMENTATION_SUMMARY.md (NEW: Change summary)
└── PHASE_1_VERIFICATION_CHECKLIST.md (NEW: Testing guide)
```

## CORS Configuration (In Detail)

```python
# Backend/app.py

CORS(
    app,
    origins=[
        "http://localhost:4200",      # Angular dev server
        "http://localhost:8080",      # Express server
        "http://127.0.0.1:4200",      # Localhost alternative
        "http://127.0.0.1:8080",      # Localhost alternative
        # + os.environ.get("PRODUCTION_ORIGIN")  if set
    ],
    supports_credentials=True,         # Allow session cookies
    allow_headers=[
        'Content-Type',                # JSON requests
        'Authorization',               # Future: JWT tokens
    ],
    methods=[
        'GET',                         # Read operations
        'POST',                        # Write operations
        'PUT',                         # Updates (future)
        'DELETE',                      # Deletes (future)
        'OPTIONS',                     # CORS preflight
    ]
)

# Result: Browser preflight requests are handled automatically
# Example preflight (browser sends automatically):
#   OPTIONS /api/auth/login
#   Origin: http://localhost:4200
#   Access-Control-Request-Method: GET
#
# Flask responds with:
#   Access-Control-Allow-Origin: http://localhost:4200
#   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
#   Access-Control-Allow-Headers: Content-Type, Authorization
```

## API Endpoint Details

### Endpoint: GET /api/auth/login

```
REQUEST:
  GET /api/auth/login HTTP/1.1
  Host: localhost:5000
  Origin: http://localhost:4200

RESPONSE:
  HTTP/1.1 200 OK
  Access-Control-Allow-Origin: http://localhost:4200
  Access-Control-Allow-Credentials: true
  Content-Type: application/json

  {
    "authorization_url": "https://accounts.google.com/o/oauth2/auth?client_id=...",
    "state": "abc123xyz789"
  }
```

### Endpoint: GET /api/auth/me

```
REQUEST:
  GET /api/auth/me HTTP/1.1
  Host: localhost:5000
  Origin: http://localhost:4200
  Cookie: session=xyz123abc789

RESPONSE:
  HTTP/1.1 200 OK
  Content-Type: application/json

  {
    "user_id": "john@example.com",
    "email": "john@example.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/...",
    "authenticated": true
  }
```

## Technology Stack (After Phase 1)

```
FRONTEND:
  Angular 21
    └─ HTTP Client (with CORS support)
    └─ Services (new: AuthService)
    └─ Components (new: LoginComponent, ProfileComponent)

BACKEND (Express):
  Express.js + TypeScript
    ├─ /api/recipe → Gemini 2.5 Flash
    ├─ /api/image → Imagen 4.0
    └─ Static file serving

BACKEND (Flask):  ← Phase 1 Enhancement
  Flask 3.1.2
    ├─ Flask-CORS 5.0.0 (NEW)
    ├─ Google OAuth 2.0
    ├─ Session Management
    └─ 5 REST API endpoints (NEW)

INFRASTRUCTURE:
  Google Cloud APIs
    ├─ OAuth 2.0 (authentication)
    ├─ Generative AI (Gemini) (Express)
    └─ Image Generation (Imagen) (Express)
```

## Security Layers (Phase 1)

```
Layer 1: CORS
  ↓ Restricts which origins can call the API
  ├─ Only localhost:4200 and localhost:8080 allowed
  └─ Options requests validated by browser

Layer 2: Session Management
  ↓ Authenticates requests with session cookies
  ├─ HTTP-only: Can't be accessed by JavaScript
  ├─ Secure flag: Only sent over HTTPS in production
  └─ SameSite: Prevents CSRF attacks

Layer 3: OAuth 2.0
  ↓ Delegates authentication to Google
  ├─ User credentials never touch your server
  ├─ State parameter prevents CSRF
  └─ Refresh tokens for long-term access

Layer 4: Error Handling
  ↓ Proper HTTP status codes
  ├─ 200 OK: Successful request
  ├─ 401 Unauthorized: Missing credentials
  ├─ 500 Server Error: Logged for debugging
  └─ No sensitive data leaked in errors
```

---

**Diagram Created:** Phase 1 Implementation  
**Date:** February 25, 2026  
**Status:** Complete and Ready for Phase 2
