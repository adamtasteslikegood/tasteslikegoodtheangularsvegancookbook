# Copilot Instructions

This repository is **VeganGenius Chef** — a single-page Angular application with a Node/Express backend, served via a Vite-based dev server and deployable to Cloud Run.

## Tech stack

- **Frontend**: Angular 21, TypeScript, Tailwind CSS
- **Backend**: Node.js + Express (compiled TypeScript, lives in `server/`)
- **AI**: Google Gemini via `@google/genai`
- **Build**: Angular CLI (`ng build`) + `tsc` for the server
- **Deployment**: Google Cloud Run via `cloudbuild.yaml`

## File guide

- `index.tsx` / `index.html`: app bootstrap
- `src/app.component.*`: main UI component
- `src/services/*`: API clients and app services
- `server/`: Express API server
- `docs/`: documentation and resources
- `scripts/`: utility scripts

## Development workflow

```sh
npm install          # install dependencies
npm run dev          # start Angular dev server (hot-reload)
npm run build        # build frontend + compile server TypeScript
npm start            # run the compiled Express server (port 8080)
```

Copy `.env.example` to `.env` and set `VITE_GEMINI_API_KEY` before running locally.

## Environment variables

- Client-visible variables **must** be prefixed with `VITE_` (e.g. `VITE_GEMINI_API_KEY`).
- Do **not** hardcode API keys or secrets in source files.
- Do **not** commit `.env` or any file containing real secrets.

## Constraints and preferences

- Keep changes **small and targeted**; prefer minimal diffs.
- Keep dev and prod behavior consistent.
- Do not add server-side runtime dependencies unless explicitly requested.
- Place new documentation in `docs/` unless it belongs at the top level (e.g. `README.md`).
- Update `README.md` only when setup steps change.

## Deployment

- Cloud Run: see `cloudbuild.yaml` and `cloud_build_tips.md`.
- Docker: `docker build -t vegangenius-chef . && docker run --rm -p 8080:8080 -e VITE_GEMINI_API_KEY=... vegangenius-chef`

## Additional resources

- [Angular Documentation](https://angular.io/guide)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Google GenAI SDK](https://github.com/google-gemini/generative-ai-js)
