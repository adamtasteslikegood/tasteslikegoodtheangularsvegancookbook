# Git Submodule Commands - Copy & Paste Ready

## For Phase 1 Implementation

### Option A: Individual Commits (Recommended)

```bash
#!/bin/bash

# Navigate to project root
cd /home/adam/projects/tasteslikegoodtheangularsvegancookbook

echo "=== STEP 1: Backend Changes ==="
cd Backend
echo "Current status:"
git status

echo -e "\nStaging Backend files..."
git add requirements.txt app.py blueprints/auth_api_bp.py

echo -e "\nCommitting Backend changes..."
git commit -m "feat: Phase 1 Implementation - CORS + REST API Authentication

- Add Flask-CORS==5.0.0 for frontend CORS support
- Create Backend/blueprints/auth_api_bp.py with 5 REST endpoints
  * GET /api/auth/login - Initiate OAuth
  * GET /api/auth/callback - OAuth callback handler
  * GET /api/auth/me - Get user info (requires auth)
  * GET /api/auth/check - Check auth status
  * POST /api/auth/logout - Logout
- Update Backend/app.py to enable CORS and register blueprint
- Maintain backward compatibility with existing routes"

echo -e "\nPushing Backend to remote..."
git push origin refactor/modular-architecture

echo -e "\nBackend commits:"
git log --oneline -5

echo -e "\n=== STEP 2: Main Repo Changes ==="
cd ..

echo "Current status:"
git status

echo -e "\nStaging main repo files..."
git add PHASE_1_*.md GIT_SUBMODULE_WORKFLOW.md GIT_QUICK_REFERENCE.md

echo -e "\nCommitting main repo changes..."
git commit -m "docs: Phase 1 Complete - Full Documentation

Documentation Files Added:
- PHASE_1_DONE.md: Executive summary
- PHASE_1_COMPLETE.md: Detailed implementation guide
- PHASE_1_QUICK_START.md: Quick reference guide
- PHASE_1_ARCHITECTURE_DIAGRAM.md: System architecture
- PHASE_1_IMPLEMENTATION_SUMMARY.md: Changes summary
- PHASE_1_VERIFICATION_CHECKLIST.md: Testing guide
- PHASE_1_DOCUMENTATION_INDEX.md: Documentation index
- PHASE_1_VISUAL_SUMMARY.md: Visual diagrams & stats
- GIT_SUBMODULE_WORKFLOW.md: Git workflow guide
- GIT_QUICK_REFERENCE.md: Quick reference"

echo -e "\nPushing main repo to remote..."
git push origin main

echo -e "\nMain repo commits:"
git log --oneline -5

echo -e "\n=== VERIFICATION ==="
echo "Submodule on branch: $(cd Backend && git rev-parse --abbrev-ref HEAD && cd ..)"
echo "Main repo on branch: $(git rev-parse --abbrev-ref HEAD)"

echo -e "\n✅ ALL DONE!"
```

### Option B: One-by-One Manual

```bash
# Step 1: Commit Backend (Submodule)
cd Backend
git status  # Review changes
git add requirements.txt app.py blueprints/auth_api_bp.py
git commit -m "feat: Phase 1 - CORS + REST auth endpoints"
git push origin refactor/modular-architecture

# Step 2: Commit Main Repo
cd ..
git status  # Should show Backend as modified
git add PHASE_1_*.md GIT_*.md
git commit -m "docs: Phase 1 documentation"
git push origin main

# Step 3: Verify
git log --oneline -3
cd Backend && git log --oneline -3 && cd ..
```

### Option C: Using Git Aliases (Advanced)

```bash
# Add these to ~/.gitconfig for future use:
git config --global alias.push-submodule '!f() { cd Backend && git push origin refactor/modular-architecture && cd ..; }; f'
git config --global alias.status-all '!f() { echo "=== Main Repo ===" && git status && echo -e "\n=== Backend Submodule ===" && git -C Backend status; }; f'

# Then use:
git push-submodule
git status-all
```

---

## Common Workflows

### 1. Push Only Backend Changes

```bash
cd Backend
git add <files>
git commit -m "message"
git push origin refactor/modular-architecture
```

### 2. Push Only Main Repo Changes

```bash
git add <files>
git commit -m "message"
git push origin main
```

### 3. Push Both (Correct Order)

```bash
# Submodule first
cd Backend && git push origin refactor/modular-architecture && cd ..
# Main repo second
git push origin main
```

### 4. Update from Remote (Pull Everything)

```bash
# Gets latest from both main and submodule
git pull --recurse-submodules
```

### 5. Check What's Different

```bash
# See all changes (main + submodule)
git status

# See what files changed in submodule
cd Backend && git diff --name-only && cd ..

# See commits in submodule not pushed
git -C Backend log --oneline origin/refactor/modular-architecture..HEAD
```

---

## Emergency Undo Commands

### Undo last commit (before push)

```bash
# Submodule
cd Backend
git reset --soft HEAD~1  # Keep changes
git reset --hard HEAD~1  # Discard changes
cd ..

# Main repo
git reset --soft HEAD~1
git reset --hard HEAD~1
```

### Undo after push (force push)

```bash
# Submodule - DANGEROUS!
cd Backend
git reset --hard HEAD~1
git push -f origin refactor/modular-architecture
cd ..

# Main repo - DANGEROUS!
git reset --hard HEAD~1
git push -f origin main
```

---

## Verification Checklist

Run after pushing:

```bash
#!/bin/bash

echo "=== Verifying Git State ==="
echo ""

echo "1. Main repo current branch:"
git rev-parse --abbrev-ref HEAD

echo ""
echo "2. Main repo last 3 commits:"
git log --oneline -3

echo ""
echo "3. Submodule current branch:"
git -C Backend rev-parse --abbrev-ref HEAD

echo ""
echo "4. Submodule last 3 commits:"
git -C Backend log --oneline -3

echo ""
echo "5. Submodule status in main repo:"
git diff --cached Backend

echo ""
echo "6. Check if remotes are reachable:"
git remote -v
cd Backend && echo "Backend remotes:" && git remote -v && cd ..

echo ""
echo "✅ Verification complete!"
```

---

## Key Commands Quick List

| Task | Command |
|------|---------|
| Check status everywhere | `git status && git -C Backend status` |
| Stage files in submodule | `cd Backend && git add <files>` |
| Commit submodule | `cd Backend && git commit -m "msg"` |
| Push submodule | `cd Backend && git push origin refactor/modular-architecture` |
| Stage main repo | `git add <files>` |
| Commit main repo | `git commit -m "msg"` |
| Push main repo | `git push origin main` |
| View submodule log | `git -C Backend log --oneline` |
| Pull everything | `git pull --recurse-submodules` |
| Update submodule | `git submodule update --remote --merge Backend` |

---

**Pro Tip:** Always do submodule → main repo. Never the other way around! 🎯
