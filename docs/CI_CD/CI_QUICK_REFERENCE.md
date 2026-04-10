# CI Quick Reference

## Pre-Commit Checklist

Run these before committing/pushing:

```bash
# 1. Format your code
npm run format

# 2. Lint your code
npm run lint

# 3. Run tests
npm run test

# 4. Build the project
npm run build
```

## All CI Scripts

| Command | Description | Use in CI |
|---------|-------------|-----------|
| `npm run build` | Build Angular + server | ✅ Yes |
| `npm run lint` | ESLint check (max 0 warnings) | ✅ Yes |
| `npm run lint:fix` | Auto-fix ESLint issues | ❌ No (local only) |
| `npm run format` | Format code with Prettier | ❌ No (local only) |
| `npm run format:check` | Check formatting | ✅ Yes |
| `npm run test` | Run tests (watch mode) | ❌ No (local only) |
| `npm run test:ci` | Run tests once + coverage | ✅ Yes |
| `npm run test:watch` | Run tests in watch mode | ❌ No (local only) |
| `npm run type-check` | TypeScript type checking | ✅ Yes |
| `npm run dev` | Start dev server | ❌ No (local only) |
| `npm run preview` | Preview production build | ❌ No (local only) |
| `npm start` | Start production server | ❌ No (runtime) |

## One-Liner: Run All CI Checks Locally

```bash
npm run format && npm run lint && npm run test:ci && npm run build
```

## GitHub Actions Status

View CI status: Go to your repo → **Actions** tab

The workflow runs on:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`

## Configuration Files

- `eslint.config.js` - ESLint rules (flat config format)
- `.prettierrc` - Prettier formatting rules
- `.prettierignore` - Prettier ignore patterns
- `vitest.config.ts` - Vitest test configuration
- `.github/workflows/ci.yml` - GitHub Actions workflow

## Troubleshooting

### "Command not found" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### ESLint/Prettier conflicts
```bash
npm run format
npm run lint
```

### Tests failing
```bash
# Run in watch mode to debug
npm run test
```

### CI failing but local passes
- Check Node.js version (CI uses Node 20)
- Ensure you committed all files
- Check for environment variable issues
