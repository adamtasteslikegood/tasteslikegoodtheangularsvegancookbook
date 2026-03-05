# Git Submodule Quick Reference

## 🚀 The Correct Order (ALWAYS)

```
1️⃣  Commit SUBMODULE changes
    └─ cd Backend
    └─ git add .
    └─ git commit -m "message"
    └─ git push origin refactor/modular-architecture

2️⃣  Commit MAIN REPO changes
    └─ cd ..
    └─ git add .
    └─ git commit -m "message"
    └─ git push origin main
```

## ✅ For Your Phase 1 Right Now

```bash
# ===== BACKEND (SUBMODULE) =====
cd Backend

# Stage the 3 files you changed
git add requirements.txt app.py blueprints/auth_api_bp.py

# Commit
git commit -m "feat: Phase 1 - CORS + 5 REST auth endpoints"

# Push
git push origin refactor/modular-architecture

# ===== MAIN REPO =====
cd ..

# Stage documentation files
git add PHASE_1_*.md GIT_SUBMODULE_WORKFLOW.md

# Commit
git commit -m "docs: Phase 1 implementation documentation"

# Push
git push origin main

# ===== VERIFY =====
echo "Submodule commits:"
git -C Backend log --oneline -3

echo "Main repo commits:"
git log --oneline -3
```

## 💡 Why This Order?

```
If you do it WRONG (main repo first):
  Main repo: "Backend points to commit ABC123"
  But submodule: Commit ABC123 doesn't exist on server yet!
  → ❌ BROKEN REFERENCE

If you do it RIGHT (submodule first):
  Submodule: Pushed commit ABC123 ✅
  Main repo: "Backend points to commit ABC123" ✅
  → ✅ EVERYTHING WORKS
```

## 🚨 Key Rules

- **Always push submodule BEFORE main repo**
- **Always verify with `git log` after pushing**
- **If you forget, use `git pull --recurse-submodules` to fix**

## 📌 Your Current Setup

```
Main Repo:     tasteslikegoodtheangularsvegancookbook (on GitHub)
Submodule:     Backend/ → https://github.com/adamtasteslikegood/tasteslikegood.com.git
Branch:        refactor/modular-architecture
```

---

**That's it!** Follow the order above and you're good to go. 🎉
