# Contributing

Thanks for helping improve this project.

## Quick start

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` (or `.env.local`) and set `GEMINI_API_KEY`.
3. Run the dev server:
   `npm run dev`

## Guidelines

- Keep changes small and production-friendly.
- Do not commit real API keys.
- Update `README.md` if the setup steps change.

## Before Submitting a PR

Run these checks locally:

```bash
npm run format      # Format your code
npm run lint        # Check for linting errors
npm run test        # Run tests
npm run build       # Verify build works
```

Or run all at once:

```bash
npm run format && npm run lint && npm run test:ci && npm run build
```

GitHub Actions will run these same checks automatically when you open a PR.

## CI/CD

This project uses GitHub Actions for continuous integration. All PRs must pass:

- ✅ Build check
- ✅ Linting (ESLint + Prettier)
- ✅ Tests (Vitest)
- ✅ Type checking (TypeScript)

See [`CI_QUICK_REFERENCE.md`](CI_QUICK_REFERENCE.md) for all available commands.
