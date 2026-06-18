<div align="center">
<img width="1200" height="475" alt="Vegangenius Chef" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Vegangenius Chef

**AI-powered vegan recipe generator & personal cookbook**

Generate recipes from natural-language prompts • AI food photography • Organize cookbooks • SSR public recipe pages

[![CI](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/actions/workflows/ci.yml/badge.svg)](https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## Overview

Vegangenius Chef is a full-stack vegan recipe app with three tiers:

```
Browser → Angular 21 SPA → Express reverse-proxy (:8080) → Flask API (:5000) → Cloud SQL
```

- **Generate** vegan recipes via Google Gemini (`gemini-2.5-flash`)
- **AI food photos** via Google Imagen (`imagen-4.0-generate-001`)
- **Save & organize** recipes into named cookbooks
- **Publish** recipes as SSR pages at `/r/<slug>` for SEO & sharing
- **Auth** via Google OAuth or guest mode (localStorage)

## Quick Start

**Prerequisites:** Node.js 20+, Python 3.11+, [uv](https://docs.astral.sh/uv/)

```bash
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/adamtasteslikegood/tasteslikegoodtheangularsvegancookbook.git
cd tasteslikegoodtheangularsvegancookbook

# 2. Frontend + Express proxy
npm install
cp .env.example .env.local   # Set GEMINI_API_KEY, FLASK_BACKEND_URL

# 3. Flask backend
cd Backend
uv sync
cp .env.example .env         # Set GOOGLE_API_KEY, GOOGLE_CLIENT_ID, etc.
./init_database.sh
cd ..

# 4. Run (three terminals)
cd Backend && uv run python app.py          # Flask on :5000
npm run dev                                  # Angular on :3000 (proxies /api → :5000)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Angular dev server (port 3000) |
| `npm run build` | Production build (Angular + Express) |
| `npm start` | Production server (port 8080) |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |
| `npm run type-check` | TypeScript type check |
| `npm test` | Vitest (server tests) |

## Architecture

See [docs/architecture/](docs/architecture/) for ADRs and diagrams.

```
├── src/                 # Angular 21 SPA (signals, standalone components)
├── server/              # Express reverse proxy + static hosting
├── Backend/             # Flask API (submodule: tasteslikegood.com)
├── scripts/             # Utility scripts (PM tooling, git, gcloud)
├── specs/               # PM planning docs (synced to Confluence)
├── docs/                # All documentation
│   ├── architecture/    # ADRs, diagrams, rate limiting
│   ├── guides/          # Developer guides, quickstart
│   ├── deployment/      # Cloud Build, CI/CD checklists
│   ├── security/        # Security docs & guidelines
│   └── phases/          # Historical phase documentation
└── public/              # Static assets (privacy policy, etc.)
```

## Deployment

Two Cloud Run services in `us-central1`:
- `express-frontend` — Node.js (Angular + proxy)
- `flask-backend` — Python (API + AI + auth + DB)

See [docs/deployment/DEPLOYMENT_CHECKLIST.md](docs/deployment/DEPLOYMENT_CHECKLIST.md) for the full checklist.

```bash
gcloud builds submit --config=cloudbuild.yaml
```

## Atlassian PM workflow

This repo has an official cross-agent PM workflow outside git:

- **Jira KAN** = active execution state, who is working on what now
- **Jira RCP** = delivery state, epics, sprints, acceptance scope
- **Confluence TLG** = durable planning/session context and documentation
- **`specs/*.md`** = local working copies that sync non-destructively into Confluence

Quick commands:

```sh
npm run pm:start             # connectivity check + local PM briefing
npm run pm:brief             # refresh local PM briefing
npm run pm:sync              # publish/update Confluence briefing
npm run pm:status            # live Jira + PR + Confluence + prod snapshot
npm run pm:daemon            # start daemon in background on this VM
npm run pm:daemon:status     # show pid + log path
npm run pm:daemon:logs       # tail daemon log
npm run pm:daemon:stop       # stop background daemon
npm run pm:daemon:foreground # run watcher/MCP helper in foreground for debugging
```

Put real Atlassian credentials in `.env` using the variables shown in `.env.example`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, branching strategy, and code style.

## License

[MIT](LICENSE)
