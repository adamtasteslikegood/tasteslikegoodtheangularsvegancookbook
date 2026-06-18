# Phase 2 Implementation Complete ✅

**Date:** February 26, 2026  
**Status:** ✅ Angular Frontend Now Orchestrates Both Backends

---

## What Was Implemented

Phase 2 connects the Angular frontend to **both** the Express server (AI generation) and the Flask backend (Google OAuth authentication), replacing the old localStorage-only email/password auth.

### Changes Made

#### 1. **Flask CORS Updated for Angular Dev Server**

- **File:** `Backend/app.py`
- **Change:** Added `http://localhost:3000` and `http://127.0.0.1:3000` to CORS origins
- **Why:** Angular dev server runs on port 3000 per `angular.json`

#### 2. **Flask OAuth Callback Redirect Fixed**

- **File:** `Backend/blueprints/auth_api_bp.py`
- **Changes:**
  - Default `FRONTEND_URL` changed from `localhost:4200` to `localhost:3000`
  - Redirect target changed from `/dashboard` to `?auth=success`
  - Angular has no `/dashboard` route — it's a SPA

#### 3. **Environment Configuration Created**

- **Files:** `src/environments/environment.ts` (dev), `src/environments/environment.prod.ts` (prod)
- **Purpose:** Flask API URL configuration (empty = relative/proxied paths)
- **Production:** Uses `fileReplacements` in `angular.json`

#### 4. **Angular Dev Proxy Configured**

- **File:** `proxy.conf.json` (NEW)
- **Change:** Proxies `/api/auth/*` requests to `http://localhost:5000` (Flask)
- **Why:** Avoids cross-origin cookie issues during development
- **Wired in:** `angular.json` → `serve.options.proxyConfig`

#### 5. **User Types Updated**

- **File:** `src/auth.types.ts`
- **Changes:**
  - Added `picture?: string` field (Google profile picture)
  - Added `AuthProvider` type (`'google' | 'guest'`)
  - Added `authProvider?: AuthProvider` field

#### 6. **Auth Service Refactored (Core Change)**

- **File:** `src/services/auth.service.ts` (REWRITTEN)
- **What changed:**
  - `init()` → checks Flask `/api/auth/check` on startup
  - `login()` → calls Flask `/api/auth/login`, redirects to Google OAuth
  - `logout()` → calls Flask `/api/auth/logout`, clears local state
  - `checkAuthStatus()` → hydrates user from Flask session cookie
  - Guest-to-authenticated merge: existing guest recipes are preserved
  - Removed: `signup()`, `hashPassword()`, local password storage
  - Kept: all localStorage recipe/cookbook methods (unchanged)

#### 7. **Auth UI Modernized**

- **File:** `src/app.component.ts`
- **Changes:**
  - Removed: `isLoginMode`, `authEmail`, `authPassword`, `authName` signals
  - Removed: `toggleAuthMode()`, `onAuthSubmit()`, `onSocialLogin()` methods
  - Added: `onGoogleLogin()` method, `authLoginLoading` signal
  - `openAuthModal()` simplified (no mode parameter)
  - `onLogout()` now async

- **File:** `src/app.component.html`
- **Changes:**
  - Header: single "Sign In" button (replaces separate Log In / Sign Up)
  - Header: Google profile picture avatar shown when authenticated
  - Auth modal: replaced email/password form with "Sign in with Google" button
  - Auth modal: guest mode explained clearly
  - Removed: Apple sign-in button, login/signup toggle

---

## Architecture After Phase 2

```
┌──────────────────────────────────────────────────────────┐
│               Angular Frontend (Port 3000)               │
│                                                          │
│  gemini.service.ts ──→ /api/recipe, /api/image           │
│  auth.service.ts   ──→ /api/auth/*                       │
│  localStorage      ──→ recipes, cookbooks (cache)        │
└───────────┬───────────────────────┬──────────────────────┘
            │                       │
            │ (relative paths)      │ (proxied in dev)
            │                       │
            ▼                       ▼
┌───────────────────┐    ┌──────────────────────┐
│  Express Server   │    │   Flask Backend      │
│  (Port 8080)      │    │   (Port 5000)        │
│                   │    │                      │
│  POST /api/recipe │    │  GET /api/auth/login │
│  POST /api/image  │    │  GET /api/auth/check │
│  GET /api/health  │    │  GET /api/auth/me    │
│                   │    │  POST /api/auth/logout│
│  UNCHANGED ✅     │    │  GET /api/auth/callback│
└───────────────────┘    └──────────────────────┘
```

---

## How It Works

### Login Flow

1. User clicks **"Sign In"** → auth modal opens
2. User clicks **"Sign in with Google"**
3. Angular calls `GET /api/auth/login` (proxied to Flask)
4. Flask returns Google OAuth `authorization_url`
5. Browser redirects to Google consent screen
6. User approves → Google redirects to Flask `/api/auth/callback`
7. Flask sets session cookies, redirects to Angular at `/?auth=success`
8. Angular's `AuthService.init()` calls `/api/auth/check`
9. Flask returns user info → Angular displays name + profile picture

### Guest Mode

- Works exactly as before (no sign-in required)
- localStorage stores recipes and cookbooks locally
- Guest data automatically merges into authenticated session on first sign-in

### Recipe Generation

- **Unchanged** — still uses Express via relative `/api/recipe` and `/api/image`

---

## Dev Setup (3 Terminals)

```bash
# Terminal 1: Angular dev server (port 3000, with proxy)
npm run dev

# Terminal 2: Flask backend (port 5000)
cd Backend && python app.py

# Terminal 3: Express server (port 8080) — only needed for production build testing
npm start
```

**Note:** In dev mode, `ng serve` (port 3000) proxies:

- `/api/auth/*` → Flask (port 5000)
- Recipe generation: use the Express server directly or configure an additional proxy

---

## Files Changed (Summary)

| File                                   | Action        | Lines                    |
| -------------------------------------- | ------------- | ------------------------ |
| `Backend/app.py`                       | Modified      | +2 CORS origins          |
| `Backend/blueprints/auth_api_bp.py`    | Modified      | Redirect URL fix         |
| `src/environments/environment.ts`      | **Created**   | Dev config               |
| `src/environments/environment.prod.ts` | **Created**   | Prod config              |
| `proxy.conf.json`                      | **Created**   | Dev proxy config         |
| `angular.json`                         | Modified      | Proxy + fileReplacements |
| `src/auth.types.ts`                    | Modified      | +picture, +authProvider  |
| `src/services/auth.service.ts`         | **Rewritten** | Flask OAuth integration  |
| `src/app.component.ts`                 | Modified      | Google login UI methods  |
| `src/app.component.html`               | Modified      | Google Sign-In modal     |

---

## What's Next: Phase 3

Phase 3 adds a **database layer** to the Flask backend:

- SQLAlchemy/PostgreSQL or MongoDB for persistent storage
- User model (store Google OAuth users)
- Recipe model (persist recipes server-side)
- Replace localStorage recipe storage with Flask API calls
- Recipe sync between browser and server
