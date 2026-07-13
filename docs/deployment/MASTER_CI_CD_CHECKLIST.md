# 🎯 Master Checklist - CI/CD for Both Repositories

## Overview

This checklist helps you verify and deploy CI/CD for both the Angular/Express frontend and Flask backend.

---

## ✅ Frontend (Angular/Express) - COMPLETE

**Location:** Root of repository  
**Branch:** `deploy-with-db`  
**Status:** ✅ Already tested and passing

### Verification

- [x] Build passes: `npm run build` ✅
- [x] Lint passes: `npm run lint` ✅
- [x] Tests pass: `npm run test:ci` ✅
- [x] All files committed ✅

### Ready to Push

```bash
# Frontend is ready - already verified
git push origin deploy-with-db
```

---

## 🐍 Backend (Flask) - READY TO TEST

**Location:** `Backend/` directory (submodule)  
**Repo:** adamtasteslikegood/tasteslikegood.com  
**Branch:** `dev/backend_sub222`  
**Status:** 🟡 Needs local testing before commit

### Step 1: Navigate to Backend

```bash
cd /home/adam/projects/tasteslikegoodtheangularsvegancookbook/Backend
```

### Step 2: Install Dependencies

```bash
uv sync --dev
```

**Expected:** Dependencies install successfully

### Step 3: Run Formatter

```bash
uv run black .
```

- [ ] Black formats files (or reports "All done!")

### Step 4: Run Linter

```bash
uv run flake8 .
```

- [ ] Flake8 passes (or shows fixable warnings)

### Step 5: Run Type Checker

```bash
uv run mypy . --ignore-missing-imports
```

- [ ] mypy runs (some errors OK initially)

### Step 6: Run Tests

```bash
uv run pytest --cov=. --cov-report=term
```

- [ ] Tests run and generate coverage report

### Step 7: All-in-One Check

```bash
uv run black . && \
uv run flake8 . && \
uv run mypy . --ignore-missing-imports && \
uv run pytest --cov=.
```

- [ ] All checks complete

### Step 8: Review Changes

```bash
git status
```

- [ ] See all new CI files
- [ ] See any formatted files (if Black made changes)

### Step 9: Stage Files

```bash
git add .github/workflows/ci.yml
git add .flake8
git add .gitignore
git add .github/pull_request_template.md
git add *.md
git add README.md
```

- [ ] All CI files staged

### Step 10: Stage Formatted Files (if any)

```bash
git add -u
```

- [ ] Formatted files staged

### Step 11: Commit

```bash
git commit -m "ci: Add CI/CD pipeline for Flask backend

- Add GitHub Actions workflow (lint, type-check, test, security)
- Add Black formatter configuration (line length 100)
- Add Flake8 linter configuration (max complexity 10)
- Add mypy type checker configuration
- Add comprehensive CI documentation
- Add PR template with checklist
- Update README with CI/CD section
"
```

- [ ] Commit successful

### Step 12: Push

```bash
git push origin dev/backend_sub222
```

- [ ] Pushed to GitHub

### Step 13: Verify in GitHub

1. Visit: https://github.com/adamtasteslikegood/tasteslikegood.com
2. Switch to branch: `dev/backend_sub222`
3. Click "Actions" tab
4. Watch workflow run

- [ ] Workflow visible
- [ ] Jobs running (lint, type-check, test, security)
- [ ] All jobs complete

---

## 🎯 Quick Commands Summary

### Frontend (Root)

```bash
# Already passing - just push
git push origin deploy-with-db
```

### Backend (Backend/)

```bash
# Test locally
cd Backend
uv sync --dev
uv run black . && uv run flake8 . && uv run mypy . --ignore-missing-imports && uv run pytest --cov=.

# Commit and push
git add .
git commit -m "ci: Add CI/CD pipeline for Flask backend"
git push origin dev/backend_sub222
```

---

## 📊 Expected Results

### Frontend CI (Already Verified)

- ✅ Build: Success
- ✅ Lint: Success (0 errors, 0 warnings)
- ✅ Test: Success (2/2 tests passing)
- ✅ Type Check: Success

### Backend CI (After Push)

- 🎯 Lint: Should pass (Black + Flake8)
- 🎯 Type Check: May have warnings (OK initially)
- 🎯 Test: Should pass (8 test files)
- 🎯 Security: Non-blocking scan

---

## 🚨 Troubleshooting

### Backend: "uv: command not found"

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.zshrc
```

### Backend: Dependencies fail

```bash
rm -rf .venv
uv sync --dev
```

### Backend: Tests fail

```bash
# See which tests fail
uv run pytest -v

# Check if environment variables needed
cat .env.example
```

### Backend: Flake8 errors

```bash
# Format first
uv run black .

# Then check
uv run flake8 .
```

---

## 📚 Documentation Reference

### Frontend

- `CI_QUICK_REFERENCE.md` - Quick commands
- `CI_FINAL_STATUS.md` - Current status
- `CI_IMPLEMENTATION_COMPLETE.md` - Full details

### Backend

- `Backend/CI_QUICK_REFERENCE.md` - Quick commands
- `Backend/CI_READY_TO_TEST.md` - Test checklist
- `Backend/BACKEND_CI_COMPLETE.md` - Complete summary

### Both

- `CI_CD_BOTH_REPOS_SUMMARY.md` - Side-by-side comparison

---

## ✅ Success Criteria

### Minimum (Can proceed)

- [ ] Frontend: Already pushed and passing ✅
- [ ] Backend: Files created ✅
- [ ] Backend: Local checks run (any result) ⏳
- [ ] Backend: Committed and pushed ⏳

### Ideal (Best practice)

- [ ] Frontend: All checks passing ✅
- [ ] Backend: All checks passing ⏳
- [ ] Backend: Coverage >70% ⏳
- [ ] Backend: GitHub Actions green ⏳

---

## 🎉 You're Almost Done!

**Frontend:** ✅ Complete and passing  
**Backend:** 🟡 Ready to test (5-10 minutes)

### Final Steps:

1. ✅ Frontend is done - already verified
2. ⏳ Test Backend locally (steps above)
3. ⏳ Commit Backend changes
4. ⏳ Push to `dev/backend_sub222`
5. ⏳ Verify in GitHub Actions

---

## 📞 Need Help?

**Quick References:**

- Frontend: `CI_QUICK_REFERENCE.md`
- Backend: `Backend/CI_QUICK_REFERENCE.md`

**Detailed Guides:**

- Frontend: `CI_FINAL_STATUS.md`
- Backend: `Backend/BACKEND_CI_COMPLETE.md`

**Test Checklists:**

- Frontend: `CI_READY_TO_TEST.md`
- Backend: `Backend/CI_READY_TO_TEST.md`

---

**Status:** Frontend ✅ | Backend 🟡 Ready  
**Next:** Test Backend locally, then commit and push!

🚀 **You're building production-grade CI/CD!**
