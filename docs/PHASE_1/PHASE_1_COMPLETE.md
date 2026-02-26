# Phase 1 Implementation Complete ✅

## What Was Implemented

Phase 1 of the three-tier architecture has been successfully implemented! This enables the Flask backend to serve API endpoints that the Angular frontend can consume.

### Changes Made

#### 1. **Added Flask-CORS Support**
- **File:** `Backend/requirements.txt`
- **Change:** Added `Flask-CORS==5.0.0`
- **Purpose:** Enables Cross-Origin Resource Sharing so Angular frontend (port 4200) can call Flask backend (port 5000)

#### 2. **Configured CORS in Flask App**
- **File:** `Backend/app.py`
- **Changes:**
  - Imported `CORS` from `flask_cors`
  - Added CORS configuration in `create_app()` function
  - Configured allowed origins: `localhost:4200`, `localhost:8080`, `127.0.0.1:4200`, `127.0.0.1:8080`
  - Configured allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`
  - Enabled `supports_credentials=True` for session cookies

#### 3. **Created API Authentication Blueprint**
- **File:** `Backend/blueprints/auth_api_bp.py` (NEW)
- **Endpoints Implemented:**

  - **GET `/api/auth/login`**
    - Initiates Google OAuth flow
    - Returns JSON with authorization URL
    - Frontend can redirect user to this URL
    ```json
    {
      "authorization_url": "https://accounts.google.com/o/oauth2/auth?...",
      "state": "random_state_value"
    }
    ```

  - **GET `/api/auth/callback`**
    - OAuth callback endpoint (called by Google)
    - Sets session cookies with user credentials
    - Redirects to frontend dashboard

  - **GET `/api/auth/me`**
    - Returns current authenticated user's information
    - Requires valid session cookie
    - Returns 401 if not authenticated
    ```json
    {
      "user_id": "user@example.com",
      "email": "user@example.com",
      "name": "User Name",
      "picture": "https://...",
      "authenticated": true
    }
    ```

  - **POST `/api/auth/logout`**
    - Clears user session
    - Returns 200 with logout confirmation
    ```json
    {
      "message": "Logged out successfully",
      "authenticated": false
    }
    ```

  - **GET `/api/auth/check`**
    - Checks current authentication status
    - Does NOT require authentication
    - Returns user info if authenticated, otherwise just `authenticated: false`
    ```json
    {
      "authenticated": true,
      "user_id": "user@example.com",
      "email": "user@example.com",
      "name": "User Name",
      "picture": "https://..."
    }
    ```

#### 4. **Registered New Blueprint**
- **File:** `Backend/app.py`
- **Change:** Added import and registration of `auth_api_bp` before other blueprints

## How It Works

```
Angular Frontend (http://localhost:4200)
        │
        ├─ POST /api/auth/logout ────────┐
        ├─ GET /api/auth/check           │
        ├─ GET /api/auth/me              │
        └─ GET /api/auth/login ──────────┤
                    │                     │
                    ▼                     ▼
        Flask Backend (http://localhost:5000)
                    │
                    ├─ Session Management
                    ├─ Google OAuth Flow
                    └─ User Info Storage
```

### Authentication Flow

1. **User clicks "Login" button in Angular**
   ```typescript
   // In Angular component
   authService.redirectToLogin(); // Calls GET /api/auth/login
   ```

2. **Flask returns authorization URL**
   ```json
   {
     "authorization_url": "https://accounts.google.com/o/oauth2/auth?..."
   }
   ```

3. **Angular redirects to Google**
   ```typescript
   window.location.href = response.authorization_url;
   ```

4. **User authenticates with Google**
   - Google redirects to `GET /api/auth/callback?code=...`

5. **Flask exchanges code for credentials**
   - Sets secure session cookie
   - Stores user info in session

6. **Flask redirects back to Angular**
   ```javascript
   // Redirects to http://localhost:4200/dashboard (or configured URL)
   ```

7. **Angular checks auth status**
   ```typescript
   authService.checkAuth(); // Calls GET /api/auth/check
   ```

8. **Angular displays user info**
   ```typescript
   authService.user$.subscribe(user => {
     if (user && user.authenticated) {
       // Display user name, picture, etc.
     }
   });
   ```

## Angular Integration Example

Create a new service file: `src/services/auth.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';

export interface UserInfo {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  authenticated: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly FLASK_API = 'http://localhost:5000';
  
  private userSubject = new BehaviorSubject<UserInfo | null>(null);
  public user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {
    this.checkAuth();
  }

  checkAuth(): void {
    this.http.get<UserInfo>(`${this.FLASK_API}/api/auth/check`, {
      withCredentials: true
    }).subscribe(
      (response: UserInfo) => {
        if (response.authenticated) {
          this.userSubject.next(response);
        }
      }
    );
  }

  redirectToLogin(): void {
    this.http.get<any>(`${this.FLASK_API}/api/auth/login`, {
      withCredentials: true
    }).subscribe(
      (response: any) => {
        window.location.href = response.authorization_url;
      }
    );
  }

  logout(): Observable<any> {
    return this.http.post(`${this.FLASK_API}/api/auth/logout`, {}, {
      withCredentials: true
    });
  }
}
```

### Use in Angular Component

```typescript
import { Component } from '@angular/core';
import { AuthService } from '@services/auth.service';

@Component({
  selector: 'app-login',
  template: `
    <div *ngIf="!isAuthenticated">
      <button (click)="login()">Login with Google</button>
    </div>
    <div *ngIf="isAuthenticated">
      <p>Hello, {{ user?.name }}!</p>
      <img [src]="user?.picture" alt="Profile">
      <button (click)="logout()">Logout</button>
    </div>
  `
})
export class LoginComponent {
  user$ = this.authService.user$;
  isAuthenticated$ = this.authService.isAuthenticated$;

  constructor(private authService: AuthService) {}

  login(): void {
    this.authService.redirectToLogin();
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      window.location.href = 'http://localhost:4200';
    });
  }
}
```

## Security Notes

### ✅ What's Secure
- **Session Cookies:** Credentials stored securely in HTTP-only session cookies
- **CORS Restricted:** Only specific origins allowed
- **State Validation:** OAuth state parameter prevents CSRF attacks
- **Google OAuth:** Leverages industry-standard OAuth 2.0

### ⚠️ Production Checklist
- [ ] Set `PRODUCTION_ORIGIN` environment variable with your actual domain
- [ ] Set `FLASK_SECRET_KEY` environment variable (strong random key)
- [ ] Use HTTPS in production (secure cookies require it)
- [ ] Add rate limiting to `/api/auth/login` and `/api/auth/callback`
- [ ] Review CORS origins are correct
- [ ] Add CSRF protection if needed

## Installation & Setup

### 1. Install Flask-CORS

```bash
cd Backend
pip install -r requirements.txt
# OR
pip install Flask-CORS==5.0.0
```

### 2. Environment Variables

Make sure your `.env` file has:
```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_secret
FLASK_SECRET_KEY=your_strong_secret_key (optional in dev)
PRODUCTION_ORIGIN=https://yourdomain.com (for production)
FRONTEND_URL=http://localhost:4200 (for dev)
```

### 3. Start Both Servers

**Terminal 1 - Flask Backend:**
```bash
cd Backend
python app.py
# Runs on http://localhost:5000
```

**Terminal 2 - Express Frontend:**
```bash
npm start
# Runs on http://localhost:8080 (serves Angular on 4200)
```

### 4. Test the Endpoints

```bash
# Check auth status (should be false)
curl -X GET http://localhost:5000/api/auth/check \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -c cookies.txt

# Output:
# {"authenticated": false, "user_id": null}

# Get login URL
curl -X GET http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -c cookies.txt

# Output:
# {"authorization_url": "https://accounts.google.com/...", "state": "..."}
```

## Next Steps (Phase 2)

Phase 2 will focus on **Angular Frontend Integration**:
- [ ] Create `src/services/auth.service.ts`
- [ ] Create login/logout components
- [ ] Add auth guards for protected routes
- [ ] Display user profile
- [ ] Integrate with existing recipe services

## Files Modified

| File | Change |
|------|--------|
| `Backend/requirements.txt` | Added Flask-CORS |
| `Backend/app.py` | Added CORS config, registered auth_api_bp |
| `Backend/blueprints/auth_api_bp.py` | NEW - Authentication API endpoints |

## Verification

✅ **CORS enabled** - Flask can be called from Angular  
✅ **Auth endpoints created** - `/api/auth/*` endpoints ready  
✅ **Session management** - Using existing auth infrastructure  
✅ **JSON responses** - All endpoints return JSON (API-ready)  
✅ **Backward compatible** - Existing templates still work at `/auth/*`  

---

**Phase 1 is complete!** Ready to move to Phase 2 when you are. 🚀
