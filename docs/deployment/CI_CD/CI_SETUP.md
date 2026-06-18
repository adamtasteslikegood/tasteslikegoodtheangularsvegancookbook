# CI/CD Setup Guide

This document explains the CI/CD configuration for Vegangenius Chef.

## Overview

The project now has comprehensive CI checks via GitHub Actions:

- ✅ **Build** - Compiles Angular app and Express server
- ✅ **Lint** - ESLint + Prettier code quality checks
- ✅ **Test** - Vitest test suite (basic placeholder tests included)
- ✅ **Type Check** - TypeScript compilation verification

## Quick Start

### Install Dependencies

After pulling this configuration, install the new devDependencies:

```bash
npm install
```

### Local Scripts

Run these commands locally before pushing:

```bash
# Build the project
npm run build

# Run linting
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Check code formatting
npm run format:check

# Format code
npm run format

# Run tests
npm run test

# Run tests with coverage (CI mode)
npm run test:ci

# Type-check TypeScript
npm run type-check
```

## GitHub Actions Workflow

The CI pipeline (`.github/workflows/ci.yml`) runs on:

- Pushes to `main` or `develop` branches
- Pull requests targeting `main` or `develop`

### Jobs

1. **Build** - Compiles the project and uploads artifacts
2. **Lint** - Runs ESLint and Prettier checks
3. **Test** - Runs Vitest tests with coverage reporting
4. **Type Check** - Verifies TypeScript types for frontend and server

## Configuration Files

### ESLint (`.eslintrc.json`)

- Separate configurations for Angular code and Express server code
- TypeScript-aware linting
- Angular-specific rules (component/directive selectors)
- HTML template linting with accessibility checks
- Prettier integration

### Prettier (`.prettierrc`)

- Single quotes
- 2-space indentation
- 100-character line width
- Semicolons required
- LF line endings

### Vitest (`vitest.config.ts`)

- Node environment for server tests
- Coverage reports (text, JSON, HTML)
- Tests located in `server/**/*.test.ts` or `server/**/*.spec.ts`

## Adding Tests

### Server Tests

Create test files alongside your server code:

```typescript
// server/mymodule.test.ts
import { describe, it, expect } from 'vitest';

describe('My Module', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

### Angular Tests

Angular tests would require additional setup with Karma or Jest. The current setup focuses on server-side testing with Vitest.

## Environment Variables in CI

The CI workflow does **not** require API keys for build, lint, and type-check jobs. The test job will skip tests that require the Gemini API key unless you configure it as a GitHub secret:

1. Go to your repository **Settings** → **Secrets and variables** → **Actions**
2. Add a new secret: `GEMINI_API_KEY`
3. Update the test job in `.github/workflows/ci.yml` to use it:

```yaml
- name: Run tests
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  run: npm run test:ci
```

## Troubleshooting

### ESLint fails with "Parsing error"

- Ensure you've run `npm install` to install all devDependencies
- Check that `tsconfig.json` and `server/tsconfig.server.json` are valid

### Prettier conflicts with ESLint

- This shouldn't happen - `eslint-config-prettier` disables conflicting rules
- Run `npm run format` before `npm run lint`

### Tests fail in CI but pass locally

- Check Node.js version (CI uses Node 20)
- Ensure environment variables are set in CI (if needed)
- Check for platform-specific issues (line endings, paths)

## Updating Dependencies

Keep ESLint, Prettier, and Vitest up to date:

```bash
npm update eslint prettier vitest @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Next Steps

- [ ] Add more comprehensive server tests
- [ ] Set up Angular component testing (Karma or Jest)
- [ ] Add E2E tests (Playwright or Cypress)
- [ ] Configure code coverage thresholds
- [ ] Add automatic dependency updates (Dependabot or Renovate)
