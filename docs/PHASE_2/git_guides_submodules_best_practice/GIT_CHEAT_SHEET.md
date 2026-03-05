# Git Submodule Cheat Sheet 📋

## The One Golden Rule

```
╔═════════════════════════════════════════════════════════╗
║     SUBMODULE FIRST → MAIN REPO SECOND                 ║
║                                                        ║
║  Never do it backwards or bad things happen!           ║
╚═════════════════════════════════════════════════════════╝
```

---

## The 4-Step Process

```
┌─ STEP 1: Go to Submodule
│  cd Backend
│
├─ STEP 2: Commit & Push Submodule
│  git add .
│  git commit -m "message"
│  git push origin refactor/modular-architecture
│
├─ STEP 3: Go back to Main Repo
│  cd ..
│
├─ STEP 4: Commit & Push Main Repo
│  git add .
│  git commit -m "message"
│  git push origin main
│
└─ DONE ✅
```

---

## For Your Phase 1 Right Now

### Copy This Exactly:

```bash
# Step 1: Backend
cd Backend
git add requirements.txt app.py blueprints/auth_api_bp.py
git commit -m "feat: Phase 1 - CORS + REST auth endpoints"
git push origin refactor/modular-architecture

# Step 2: Main
cd ..
git add PHASE_1_*.md GIT_*.md
git commit -m "docs: Phase 1 documentation"
git push origin main

# Done!
```

---

## Key Commands

| What | Command |
|------|---------|
| Check current location | `pwd` |
| Check current branch | `git rev-parse --abbrev-ref HEAD` |
| See all changes (both) | `git status && git -C Backend status` |
| Stage submodule files | `cd Backend && git add <files>` |
| Commit submodule | `cd Backend && git commit -m "msg"` |
| Push submodule | `cd Backend && git push origin refactor/modular-architecture` |
| Go back to main | `cd ..` |
| Stage main files | `git add <files>` |
| Commit main | `git commit -m "msg"` |
| Push main | `git push origin main` |

---

## Common Commands

### Check Status Everywhere
```bash
git status
cd Backend && git status && cd ..
```

### See What's Committed
```bash
# Main repo
git log --oneline -5

# Submodule
cd Backend && git log --oneline -5 && cd ..
```

### Dry Run (See What Would Push)
```bash
# Submodule
cd Backend && git push --dry-run origin refactor/modular-architecture && cd ..

# Main
git push --dry-run origin main
```

### Fix Out-of-Sync Submodule
```bash
git pull --recurse-submodules
```

---

## Common Mistakes & Fixes

### ❌ "I pushed main first!"

**Fix:**
```bash
# Your commit is still there locally
cd Backend
git push origin refactor/modular-architecture
# Now submodule commit exists, main repo reference is good
```

### ❌ "Backend shows as modified but I already pushed it"

**Fix:**
```bash
# This is normal, means main repo detected submodule change
git add Backend
git commit -m "Update Backend reference"
git push origin main
```

### ❌ "I can't remember which branch Backend is on"

**Fix:**
```bash
cd Backend
git rev-parse --abbrev-ref HEAD
# Output: refactor/modular-architecture ✅
```

### ❌ "Clone is failing"

**Fix (you might have pushed main first):**
```bash
cd Backend
git push origin refactor/modular-architecture
cd ..
# Now others can clone successfully
```

---

## Decision Tree

```
Do you have changes in Backend?
  YES → 
    │
    ├─ cd Backend
    ├─ git add .
    ├─ git commit -m "message"
    ├─ git push origin refactor/modular-architecture
    └─ cd ..
  
  NO → Skip to next

Do you have changes in main repo?
  YES →
    │
    ├─ git add .
    ├─ git commit -m "message"
    └─ git push origin main
  
  NO → You're done!

Done! ✅
```

---

## Before/After Checklist

### Before You Push
- [ ] `pwd` shows you in `/tasteslikegoodtheangularsvegancookbook`
- [ ] `git status` shows your files
- [ ] You reviewed your changes with `git diff`

### Push Submodule
- [ ] `cd Backend` - in submodule now
- [ ] `git push origin refactor/modular-architecture` - PUSHED ✅
- [ ] `cd ..` - back to main repo

### Push Main Repo
- [ ] `git status` shows Backend as modified (that's correct!)
- [ ] `git push origin main` - PUSHED ✅
- [ ] `git log --oneline -1` shows your commit

### Verification
- [ ] Both commits show in GitHub
- [ ] No error messages
- [ ] Submodule reference points to correct commit

---

## Visual Summary

```
LOCAL MACHINE                GITHUB REMOTE
─────────────────            ──────────────

Backend/                     tasteslikegood.com
├─ requirements.txt          ├─ main commit: abc123
├─ app.py                    └─ branch: refactor/modular-architecture
└─ auth_api_bp.py
   │
   ├─ git push ─────────────→ commit: abc123 ✅
   │
   └─ NOW PUSHED!

Main Repo/                   tasteslikegoodtheangularsvegancookbook
├─ PHASE_1_*.md             ├─ commit: xyz789
├─ GIT_*.md                 │  └─ Backend ref → abc123 ✅
└─ Backend → abc123
   │
   ├─ git push ─────────────→ commit: xyz789 ✅
   │                         └─ (with ref to abc123 which EXISTS)
   └─ NOW PUSHED!

RESULT: ✅ Everything consistent!
```

---

## The Reason (Why Order Matters)

```
Git's Job: Track what code is in what version

Submodule Commit: abc123def456
├─ Contains: Your Phase 1 code
└─ Location: Remote GitHub ✅

Main Repo Reference: "Backend uses abc123def456"
├─ Points to: Submodule commit abc123def456
└─ Requirements: That commit must exist ✅

If Main references abc123 but abc123 doesn't exist:
  ❌ BROKEN REFERENCE
  ❌ Clone fails
  ❌ CI/CD fails
  ❌ Everyone unhappy

If abc123 exists FIRST:
  ✅ Reference is valid
  ✅ Clone works
  ✅ CI/CD works
  ✅ Everyone happy
```

---

## Pro Tips 🚀

1. **Always check branch names:**
   ```bash
   # In Backend (should see: refactor/modular-architecture)
   git rev-parse --abbrev-ref HEAD
   
   # In main (should see: main)
   git rev-parse --abbrev-ref HEAD
   ```

2. **Create bash alias for submodule commits:**
   ```bash
   # Add to ~/.bashrc or ~/.zshrc:
   alias push-both='cd Backend && git push origin refactor/modular-architecture && cd .. && git push origin main'
   
   # Then use:
   push-both
   ```

3. **Use `--dry-run` to test:**
   ```bash
   git push --dry-run origin main
   # Shows what WOULD push without actually pushing
   ```

4. **Verify with GitHub:**
   ```bash
   # After pushing, check GitHub UI:
   # tasteslikegood.com repo - see new commit
   # Main repo - see new docs + Backend reference
   ```

---

## Emergency Undo (If You Mess Up)

```bash
# Undo last commit (before push)
git reset --soft HEAD~1   # Keep files
git reset --hard HEAD~1   # Discard changes

# Undo last push (DANGEROUS - only if needed)
git reset --hard HEAD~1
git push -f origin main   # Force push (risky!)
```

---

## One-Liner Reference

```bash
# Everything in one go (submodule + main)
cd Backend && git push origin refactor/modular-architecture && cd .. && git push origin main

# Check both branches
git rev-parse --abbrev-ref HEAD && cd Backend && git rev-parse --abbrev-ref HEAD && cd ..

# View all commits
git log --oneline -3 && echo "---" && cd Backend && git log --oneline -3 && cd ..
```

---

## Your Setup Reminder

```
Main Repo:   tasteslikegoodtheangularsvegancookbook
Submodule:   Backend → https://github.com/adamtasteslikegood/tasteslikegood.com.git
Sub Branch:  refactor/modular-architecture
Main Branch: main
```

---

**Remember: SUBMODULE FIRST, ALWAYS! 🎯**

No exceptions. No shortcuts. This is the way. ✅

---

**Last Updated:** Feb 26, 2026  
**For:** tasteslikegoodtheangularsvegancookbook project
