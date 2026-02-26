# Git Workflow: Committing Changes to Main Repo + Submodule

## Your Current Setup

```
Main Repository: tasteslikegoodtheangularsvegancookbook
└── Backend/ (Submodule pointing to tasteslikegood.com.git)
    └── branch: refactor/modular-architecture
```

---

## ✅ **BEST PRACTICE WORKFLOW**

### Step 1️⃣: Commit Submodule Changes FIRST

```bash
# Navigate to the submodule
cd Backend

# Stage your changes (inside the submodule)
git add .

# Commit with a descriptive message
git commit -m "feat: Add Phase 1 API authentication endpoints"

# Push the submodule changes to its remote
git push origin refactor/modular-architecture

# Return to main repo
cd ..
```

### Step 2️⃣: Then Commit Main Repo Changes

```bash
# Stage all changes in main repo (Git automatically detects submodule update)
git add .

# Commit the main repo changes
git commit -m "chore: Update Backend submodule with Phase 1 implementation"

# Push main repo
git push origin main
# (or whatever your main branch is called)
```

---

## 🎯 **Complete One-Command Checklist**

Here's what to run in sequence:

```bash
# 1. Check what's changed everywhere
git status

# 2. Commit submodule changes
cd Backend
git add .
git commit -m "feat: Add Phase 1 API endpoints (CORS + auth)"
git push origin refactor/modular-architecture
cd ..

# 3. Verify submodule was updated (should see "Backend" in changes)
git status

# 4. Commit the submodule reference update in main repo
git add .
git commit -m "chore: Update Backend submodule to latest refactor/modular-architecture"
git push origin main

# 5. Verify everything
git log --oneline -5
cd Backend && git log --oneline -3 && cd ..
```

---

## ⚠️ **COMMON PITFALLS TO AVOID**

### ❌ DON'T: Commit main repo without pushing submodule first
```bash
# This creates a "dangling" commit reference
git add .
git commit -m "Update everything"  # ← Submodule ref points to non-existent commit
git push origin main
```

### ❌ DON'T: Push main repo without updating submodule reference
```bash
cd Backend
git add .
git commit -m "Changes"
# Forgot to push submodule!
cd ..
git add . && git commit && git push  # ← Main repo points to wrong commit
```

### ✅ DO: Always push submodule BEFORE main repo
```bash
# Submodule first
cd Backend && git push origin branch && cd ..
# Then main
git push origin branch
```

---

## 📋 **Reference: How Git Tracks Submodules**

When you have a submodule, the main repo stores **a reference** (commit hash) to the submodule, not the actual code:

```bash
# In main repo, the .gitmodules file contains:
[submodule "Backend"]
    path = Backend
    url = https://github.com/adamtasteslikegood/tasteslikegood.com.git
    branch = refactor/modular-architecture

# When you do 'git status', you see:
# new file:   Backend (new commit abcd123)
# This means: "Point Backend submodule to commit abcd123"
```

---

## 🔍 **Verifying Your Commits**

After pushing, verify everything is correct:

```bash
# Check main repo history
git log --oneline -5

# Check submodule history
cd Backend
git log --oneline -5
cd ..

# Verify remote matches local
git remote -v
cd Backend && git remote -v && cd ..
```

---

## 🚀 **For Your Phase 1 Implementation**

Since you just completed Phase 1, here's the exact workflow:

```bash
# Navigate to your project
cd /home/adam/projects/tasteslikegoodtheangularsvegancookbook

# 1. Commit Backend changes (submodule)
cd Backend

# See what changed
git status

# Stage the 3 modified files
git add requirements.txt app.py blueprints/auth_api_bp.py

# Commit
git commit -m "feat: Phase 1 - Add CORS and REST API authentication

- Add Flask-CORS support for frontend communication
- Create auth_api_bp.py with 5 new endpoints
- Implement GET /api/auth/login, /api/auth/me, /api/auth/check
- Implement POST /api/auth/logout and GET /api/auth/callback
- Update app.py to register new blueprint and enable CORS
- Support secure session-based authentication with Google OAuth"

# Push submodule
git push origin refactor/modular-architecture

# Return to main repo
cd ..

# 2. Commit main repo changes (documentation)
git add PHASE_1_*.md

git commit -m "docs: Phase 1 complete - Backend API authentication

- PHASE_1_DONE.md: Executive summary
- PHASE_1_COMPLETE.md: Detailed implementation guide
- PHASE_1_QUICK_START.md: Quick reference
- PHASE_1_ARCHITECTURE_DIAGRAM.md: System architecture
- PHASE_1_IMPLEMENTATION_SUMMARY.md: Changes summary
- PHASE_1_VERIFICATION_CHECKLIST.md: Testing guide
- PHASE_1_DOCUMENTATION_INDEX.md: Documentation index
- PHASE_1_VISUAL_SUMMARY.md: Visual diagrams"

# Push main repo
git push origin main
```

---

## 📱 **Using GitHub Desktop (GUI Alternative)**

If you prefer GUI:

1. Open GitHub Desktop
2. Switch to "Backend" folder and commit changes there
3. Push "Backend" branch
4. Switch back to main repo
5. You'll see "Backend" as a modified file (with new commit reference)
6. Commit that change
7. Push main repo

---

## 🔧 **Useful Commands Cheat Sheet**

```bash
# Check status everywhere
git status                    # Main repo
cd Backend && git status      # Submodule

# See what files changed where
git diff --name-only

# View commits
git log --oneline -10         # Main repo
git -C Backend log --oneline -10  # Submodule (alternative way)

# Undo last commit (if needed)
git reset HEAD~1              # Main repo
cd Backend && git reset HEAD~1 && cd ..  # Submodule

# Update submodule to latest from remote
git submodule update --remote --merge Backend

# Fetch and pull everything
git pull --recurse-submodules
cd Backend && git pull && cd ..
```

---

## ✨ **Best Practices Summary**

| Do ✅ | Don't ❌ |
|------|---------|
| Push submodule first | Push main repo first |
| Commit descriptive messages | Use generic "update" messages |
| Verify with `git log` | Assume it worked |
| Use `.gitignore` for build files | Commit node_modules, venv, etc |
| Pull with `--recurse-submodules` | Forget submodule is out of sync |
| Test locally before push | Push breaking changes untested |

---

## 🎯 **Your Immediate Action Items**

For Phase 1 changes right now:

```bash
# Terminal 1: Backend changes
cd Backend
git add requirements.txt app.py blueprints/auth_api_bp.py
git commit -m "feat: Phase 1 API auth - CORS + 5 endpoints"
git push origin refactor/modular-architecture

# Terminal 2: Main repo docs
cd ..
git add PHASE_1_*.md
git commit -m "docs: Phase 1 documentation complete"
git push origin main
```

---

## 🆘 **If Something Goes Wrong**

### Submodule is out of sync with main repo:
```bash
git pull --recurse-submodules
cd Backend && git pull && cd ..
```

### Main repo points to commit that doesn't exist in submodule:
```bash
cd Backend
git fetch origin
git checkout <commit-hash>
cd ..
git add Backend
git commit -m "fix: Sync submodule to correct commit"
git push origin main
```

### Need to force push (use with caution!):
```bash
cd Backend
git push -f origin refactor/modular-architecture

cd ..
git push -f origin main
```

---

**Summary:** Always commit submodule → push submodule → update main repo reference → push main repo. This ensures no broken references! ✅
