# 📋 Documentation Index

> **Last updated:** 2026-03-27 · **Status:** ✅ Current

## 🚀 Start Here

| Document                                                       | Read time | Description                                   |
| -------------------------------------------------------------- | --------- | --------------------------------------------- |
| [**README.md**](../README.md)                                  | 5 min     | Project overview, local setup, CI/CD commands |
| [**VISUAL_SUMMARY.md**](./VISUAL_SUMMARY.md)                   | 5 min     | Quick visual overview with diagrams           |
| [**IMPLEMENTATION_COMPLETE.md**](./IMPLEMENTATION_COMPLETE.md) | 10 min    | Delivery summary and getting started          |

---

## 📚 Documentation by Category

### 🏗️ Architecture — `Label: architecture`

| Document                                                                         | Description                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [ADR-001: Auth & Persistence Routing](./ADR-001-auth-and-persistence-routing.md) | Express→Flask proxy decision and rationale              |
| [ARCHITECTURE_RECOMMENDATION.md](./ARCHITECTURE_RECOMMENDATION.md)               | System architecture overview and recommendations        |
| [RECIPE_API.md](./RECIPE_API.md)                                                 | REST API endpoint reference for recipes and collections |

### 🔐 Security — `Label: security`

| Document                                                                 | Description                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [SECURITY.md](./SECURITY.md)                                             | Comprehensive security guide (rate limiting, headers, validation) |
| [README_SECURITY.md](./README_SECURITY.md)                               | Security implementation overview                                  |
| [SECURITY_QUICKSTART.md](./SECURITY_QUICKSTART.md)                       | Step-by-step security setup                                       |
| [SECURITY_IMPLEMENTATION_REPORT.md](./SECURITY_IMPLEMENTATION_REPORT.md) | Detailed security metrics and analysis                            |
| [secretsguidelines.md](./secretsguidelines.md)                           | Secrets management guidelines                                     |
| [rate_limit.md](./rate_limit.md)                                         | Rate limiting configuration reference                             |

### 👨‍💻 Developer — `Label: developer`

| Document                                                   | Description                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)                 | Daily development reference (security, debugging, testing) |
| [GETTING_STARTED_CI.md](./GETTING_STARTED_CI.md)           | CI/CD setup and first-run guide                            |
| [BUILD_ERROR_FIXED.md](./BUILD_ERROR_FIXED.md)             | Build error troubleshooting notes                          |
| [TYPESCRIPT_ERRORS_FIXED.md](./TYPESCRIPT_ERRORS_FIXED.md) | TypeScript error resolutions                               |
| [UV_INTEGRATION_SUMMARY.md](./UV_INTEGRATION_SUMMARY.md)   | Python `uv` dependency manager integration                 |

### 🚀 Deployment & CI/CD — `Label: deployment`

| Document                                                         | Description                           |
| ---------------------------------------------------------------- | ------------------------------------- |
| [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)             | Pre-deployment verification checklist |
| [cloud_build_tips.md](./cloud_build_tips.md)                     | Google Cloud Build tips               |
| [cloud_build_tipsFORMAT.md](./cloud_build_tipsFORMAT.md)         | Formatted Cloud Build reference       |
| [TERRAFORM_DEPLOYMENT_AUDIT.md](./TERRAFORM_DEPLOYMENT_AUDIT.md) | Terraform deployment audit notes      |
| [MASTER_CI_CD_CHECKLIST.md](./MASTER_CI_CD_CHECKLIST.md)         | Master CI/CD checklist                |

#### CI/CD Detailed Guides (`CI_CD/`)

| Document                                                               | Description                |
| ---------------------------------------------------------------------- | -------------------------- |
| [CI_SETUP.md](./CI_CD/CI_SETUP.md)                                     | Detailed CI setup guide    |
| [CI_QUICK_REFERENCE.md](./CI_CD/CI_QUICK_REFERENCE.md)                 | Quick CI command reference |
| [CI_SCRIPTS_INVENTORY.md](./CI_CD/CI_SCRIPTS_INVENTORY.md)             | Complete scripts inventory |
| [CI_CD_BOTH_REPOS_SUMMARY.md](./CI_CD/CI_CD_BOTH_REPOS_SUMMARY.md)     | CI/CD for both repos       |
| [CI_IMPLEMENTATION_COMPLETE.md](./CI_CD/CI_IMPLEMENTATION_COMPLETE.md) | CI implementation status   |
| [CI_FINAL_STATUS.md](./CI_CD/CI_FINAL_STATUS.md)                       | Final CI status report     |
| [CI_LINT_FIXES.md](./CI_CD/CI_LINT_FIXES.md)                           | Lint fix history           |
| [CI_READY_TO_TEST.md](./CI_CD/CI_READY_TO_TEST.md)                     | CI readiness checklist     |

### 🗄️ Database & Data — `Label: database`

| Document                                                     | Description                   |
| ------------------------------------------------------------ | ----------------------------- |
| [RECIPE_ID_FIX.md](./RECIPE_ID_FIX.md)                       | Recipe dual-ID issue fix      |
| [RECIPE_ID_FIX_VISUAL.md](./RECIPE_ID_FIX_VISUAL.md)         | Visual guide to recipe ID fix |
| [QUICKSTART_ID_FIX.md](./QUICKSTART_ID_FIX.md)               | Quick reference for ID fix    |
| [RECIPE_ID_ISSUE_RESOLVED.md](./RECIPE_ID_ISSUE_RESOLVED.md) | Issue resolution summary      |

### 📖 Git & Workflow — `Label: workflow`

#### Git Guides (`git_guides_submodules_best_practice/`)

| Document                                                                                     | Description              |
| -------------------------------------------------------------------------------------------- | ------------------------ |
| [GIT_GUIDES_README.md](./git_guides_submodules_best_practice/GIT_GUIDES_README.md)           | Index of all git guides  |
| [GIT_CHEAT_SHEET.md](./git_guides_submodules_best_practice/GIT_CHEAT_SHEET.md)               | Common git commands      |
| [GIT_SUBMODULE_WORKFLOW.md](./git_guides_submodules_best_practice/GIT_SUBMODULE_WORKFLOW.md) | Submodule workflow guide |
| [GIT_QUICK_REFERENCE.md](./git_guides_submodules_best_practice/GIT_QUICK_REFERENCE.md)       | Quick git reference      |

### 📋 Phase Implementation Records — `Label: archive`

> Historical records of each implementation phase. Kept for reference.

| Phase                    | Index                                                  | Description                                   |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------- |
| **Phase 1** — Security   | [PHASE_1/](./PHASE_1/)                                 | Security middleware, rate limiting, Helmet.js |
| **Phase 2** — Submodules | [PHASE_2/](./PHASE_2/)                                 | Git submodule integration                     |
| **Phase 3** — Database   | [PHASE_3/PHASE_3_INDEX.md](./PHASE_3/PHASE_3_INDEX.md) | Cloud SQL, Flask-Migrate, OAuth               |
| **Phase 4** — Deployment | [PHASE_4/PHASE_4_INDEX.md](./PHASE_4/PHASE_4_INDEX.md) | Cloud Run deployment, production config       |

### 📝 Plans & Research — `Label: planning`

| Document                                                                             | Description                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [IntegrateBackendPlan1_github-copilot.md](./IntegrateBackendPlan1_github-copilot.md) | Backend integration plan                           |
| [Optimized Deployment Prompt.md](./Optimized%20Deployment%20Prompt.md)               | Deployment optimization notes                      |
| [plans/](./plans/)                                                                   | Future plans (SEO, frontend fixes, Valkey pub/sub) |
| [logs_findings/](./logs_findings/)                                                   | Investigation logs and findings                    |

### 🐧 Reference — `Label: reference`

| Document                             | Description                        |
| ------------------------------------ | ---------------------------------- |
| [linuxarch101.md](./linuxarch101.md) | Linux/architecture quick reference |

---

## 🗺️ Navigation by Topic

### I want to...

| Goal                            | Go to                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Set up the project**          | [README.md](../README.md)                                                                                                |
| **Understand the architecture** | [ADR-001](./ADR-001-auth-and-persistence-routing.md), [ARCHITECTURE_RECOMMENDATION.md](./ARCHITECTURE_RECOMMENDATION.md) |
| **Deploy to production**        | [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)                                                                     |
| **Review security**             | [SECURITY.md](./SECURITY.md)                                                                                             |
| **Write/maintain code**         | [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)                                                                               |
| **Use the API**                 | [RECIPE_API.md](./RECIPE_API.md)                                                                                         |
| **Set up CI/CD**                | [GETTING_STARTED_CI.md](./GETTING_STARTED_CI.md)                                                                         |
| **Fix a build error**           | [BUILD_ERROR_FIXED.md](./BUILD_ERROR_FIXED.md)                                                                           |
| **Work with git submodules**    | [git_guides_submodules_best_practice/](./git_guides_submodules_best_practice/)                                           |
| **See phase history**           | Phase directories ([1](./PHASE_1/), [2](./PHASE_2/), [3](./PHASE_3/), [4](./PHASE_4/))                                   |

---

## 📊 Root-Level Documentation

These files live in the repository root for easy discoverability:

| File                                        | Description                                   |
| ------------------------------------------- | --------------------------------------------- |
| [README.md](../README.md)                   | Main project README                           |
| [AGENTS.md](../AGENTS.md)                   | System architecture reference (for AI agents) |
| [CONTRIBUTING.md](../CONTRIBUTING.md)       | Contribution guidelines                       |
| [START_HERE.md](../START_HERE.md)           | Onboarding and security deployment guide      |
| [QUICK_REFERENCE.md](../QUICK_REFERENCE.md) | Command quick reference with rate limits      |
| [LICENSE](../LICENSE)                       | MIT License                                   |

---

## 📝 Last Updated

> **2026-03-27** — Reorganized documentation, removed backup copies, consolidated duplicates, added category labels.
