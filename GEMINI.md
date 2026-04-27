# tasteslikegoodtheangularsvegancookbook

## Project Overview

This project is a full-stack application featuring an Angular/React frontend and a Python backend. It serves as a recipe platform or cookbook application ("tasteslikegoodtheangularsvegancookbook").

**Key Technologies:**

- **Frontend:** Angular/React (TypeScript, `angular.json`, `index.tsx`), Tailwind CSS (`tailwind.config.js`), Vitest (`vitest.config.ts`), ESLint.
- **Backend:** Python (`Backend/app.py`), managed with `pip` and `pyproject.toml`/`requirements.txt`.
- **Infrastructure:** Docker (`Dockerfile`, `Backend/Dockerfile`), Google Cloud Build (`cloudbuild.yaml`), GitHub Actions.
- **Code Quality:** Qodana (`qodana.yaml`), Prettier (`.prettierrc`).
- **Agents/Skills:** Uses custom Gemini CLI and Claude skills (located in `alirez-claude-skills/`).

## Building and Running

### Frontend

- **Install dependencies:** `npm install` (implied by `package.json` and `package-lock.json`)
- **Run development server:** `npm start` or `ng serve` (check `package.json` scripts)
- **Run tests:** `npm test` (using Vitest)
- **Linting:** `npm run lint` (using ESLint)

### Backend

- **Setup Environment:**
  ```bash
  cd Backend
  ./setup_venv.sh
  source .venv/bin/activate
  pip install -r requirements.txt
  ```
- **Database Setup:** `bash init_database.sh`
- **Run Server:** `python app.py` or through the provided shell scripts (e.g., `run_debug.sh`).
- **Tests/CI:** `bash run_ci_checks.sh`

## Development Conventions

- **Version Control:** Follow guidelines in `BRANCHING_STRATEGY.md` and `CONTRIBUTING.md`.
- **CI/CD:** PRs and commits are checked via GitHub Actions and Qodana. Ensure all tests pass before submitting a PR.
- **Code Style:** Enforced by ESLint (frontend), Flake8 (backend - `.flake8`), and Prettier.
- **Documentation:** Review `START_HERE.md` and `API.md` (in Backend) for detailed onboarding.

## gemstack

To install gemstack for this project, run the following:

```bash
git submodule update --init --recursive
cd gemstack && ./setup
```

Use the `/browse` skill from gemstack for all web browsing, never use `mcp__claude-in-chrome__*` tools.
Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gemstack-upgrade`.
