# Getting Started with CI/CD

This guide will help you install and verify the new CI/CD setup.

## Step 1: Install Dependencies

Run the following command to install all new devDependencies:

```bash
npm install
```

This will install:
- ESLint and Angular ESLint plugins
- Prettier for code formatting
- Vitest for testing
- TypeScript ESLint parser and plugins
- Coverage reporting tools

## Step 2: Verify Installation

Check that the new scripts are available:

```bash
npm run lint -- --version
npm run format -- --version
npm run test -- --version
```

## Step 3: Run Initial Checks

### Format the codebase

```bash
npm run format
```

This will format all TypeScript, HTML, CSS, and config files according to the Prettier rules.

### Check for linting issues

```bash
npm run lint
```

**Note:** You may see some linting errors on the first run. This is normal. To auto-fix many of them:

```bash
npm run lint:fix
```

### Run tests

```bash
npm run test
```

This will run the test suite. Currently, only placeholder tests are included.

### Build the project

```bash
npm run build
```

This ensures everything compiles correctly.

## Step 4: Commit the Configuration

```bash
git add .
git commit -m "ci: Add ESLint, Prettier, Vitest, and GitHub Actions workflow"
git push
```

## Step 5: Verify GitHub Actions

1. Go to your GitHub repository
2. Click the **Actions** tab
3. You should see the CI workflow running
4. Wait for all jobs to complete (Build, Lint, Test, Type Check)

## Troubleshooting

### ESLint reports many errors

Some existing code may not follow the new linting rules. Options:

1. **Auto-fix:** `npm run lint:fix`
2. **Format first:** `npm run format` then `npm run lint:fix`
3. **Disable rules temporarily:** Edit `.eslintrc.json` to make rules "warn" instead of "error"

### Node version mismatch

The CI uses Node 20. To check your local version:

```bash
node --version
```

If you're on a different version, consider using [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 20
nvm use 20
```

### Tests fail

The initial test is a placeholder. If it fails, check:

```bash
npm run test -- --reporter=verbose
```

### Build fails

If the build fails after adding linting:

```bash
# Clean and rebuild
rm -rf dist server/dist node_modules
npm install
npm run build
```

## What to Do Next

### Add Real Tests

Replace the placeholder test in `server/server.test.ts` with actual tests:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest'; // You'll need to install this

describe('Express API', () => {
  let app: express.Application;

  beforeAll(() => {
    // Setup your Express app
    app = express();
    // ... configure routes
  });

  it('GET /api/health returns 200', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});
```

### Configure Branch Protection

In GitHub:
1. Go to **Settings** → **Branches**
2. Add a branch protection rule for `main`
3. Enable "Require status checks to pass before merging"
4. Select all CI jobs (Build, Lint, Test, Type Check)

### Optional: Add Pre-Commit Hooks

Install [husky](https://typicode.github.io/husky/) to run checks before commits:

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Create `.husky/pre-commit`:

```bash
#!/bin/sh
npx lint-staged
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"],
    "*.{html,css,json,md}": ["prettier --write"]
  }
}
```

## Summary

✅ All dependencies installed  
✅ Format, lint, test, and build scripts working  
✅ GitHub Actions workflow configured  
✅ Ready to start development with CI/CD  

For more information, see:
- [`CI_QUICK_REFERENCE.md`](../CI_QUICK_REFERENCE.md) - All commands
- [`docs/CI_SETUP.md`](CI_SETUP.md) - Detailed setup guide
- [`CI_SCRIPTS_INVENTORY.md`](../CI_SCRIPTS_INVENTORY.md) - Complete inventory
