# AGENTS

This repository is a single-page Angular application served via a Vite-based dev server. Keep changes minimal and production-friendly.

## Development notes

- Client code only sees environment variables prefixed with `VITE_`.
- Do not hardcode API keys in source files.
- Prefer small, focused commits that keep local and production behavior aligned.

## File guide

- `index.tsx`: app bootstrap.
- `src/app.component.*`: main UI.
- `src/services/*`: API clients and app services.
