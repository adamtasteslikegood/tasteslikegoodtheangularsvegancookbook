# CI Lint Fixes Applied

## Summary

Fixed **4 errors** and **17 warnings** to make the CI pipeline pass cleanly.

## Changes Made

### 1. TypeScript Configuration (`tsconfig.json`)

- **Issue:** Parser couldn't find `src/environments/environment.prod.ts`
- **Fix:** Changed from `files: ["./index.tsx"]` to `include: ["./index.tsx", "src/**/*"]`

### 2. Server Security Module (`server/security.ts`)

- **Issue:** Unused `Options` import and `any` types in middleware
- **Fixes:**
  - Removed unused `Options` import
  - Added proper Express types: `Request`, `Response`, `NextFunction`, `ErrorRequestHandler`
  - Replaced all `any` types with proper Express types
  - Used `next` (not `_next`) since it IS used in the error handler
  - Added intersection type `Error & { status?: number }` for HTTP errors with status codes

### 3. Server Types (`server/types.ts`)

- **Issue:** `ApiResponse<T = any>` using `any` as default generic
- **Fix:** Changed to `ApiResponse<T = unknown>`

### 4. Auth Service (`src/services/auth.service.ts`)

- **Issues:**
  - `prefer-const` error (variable declared with `let` but never reassigned)
  - `any` types in error handling and function parameters
- **Fixes:**
  - Changed `let currentRecipes` → `const currentRecipes` (array is mutated with .push(), not reassigned)
  - Changed `let savedRecipes` → `const savedRecipes` (never mutated or reassigned)
  - **Kept** `let recipeId` as `let` (IS reassigned when duplicate recipe found on line 317)
  - Changed `err: any` → `err: unknown` in catch blocks
  - Changed `recipes: any[]` → `recipes: Recipe[]` in `importRecipes()`
  - Added `prefer-const` ESLint rule configuration for better detection

### 5. Persistence Service (`src/services/persistence.service.ts`)

- **Issue:** Constructor injection discouraged by Angular lint rule
- **Fix:** Replaced `constructor(private auth: AuthService)` with `private auth = inject(AuthService)`

### 6. App Component (`src/app.component.ts`)

- **Issues:**
  - Unused `Cookbook` import
  - Multiple `any` types in event handlers and error handling
- **Fixes:**
  - Removed unused `Cookbook` import
  - `event: any` → `event: Event` with proper `HTMLInputElement` casting
  - `e: any` → `e: ProgressEvent<FileReader>` in file reader
  - `err: any` → `err: unknown` in all catch blocks with proper Error type guards
  - `val: any` → `val: unknown` in `isString()` helper

### 7. Test Configuration (`vitest.config.ts`)

- **Issue:** Duplicate tests running (source + compiled)
- **Fix:** Added explicit `exclude: ['server/dist/**', ...]` to prevent running compiled test files

### 8. Package Scripts (`package.json`)

- **Issue:** ESLint 9 using flat config by default, but project uses legacy `.eslintrc.json`
- **Fix:** Added `ESLINT_USE_FLAT_CONFIG=false` to `lint` and `lint:fix` scripts

## Before vs After

### Before:

```
✖ 21 problems (4 errors, 17 warnings)
```

### After (Expected):

```
✓ 0 problems
```

## Verification

Run these commands to verify:

```bash
npm run lint        # Should pass with 0 errors, 0 warnings
npm run test:ci     # Should pass with proper test count
npm run build       # Should compile successfully
npm run type-check  # Should pass TypeScript validation
```

## Notes

- All `any` types replaced with proper types (`unknown`, `Event`, `ProgressEvent<FileReader>`, `Recipe[]`, etc.)
- All error handling now uses type guards: `err instanceof Error ? err.message : 'fallback'`
- Angular best practices enforced (inject() function preferred over constructor injection)
- Legacy ESLint config maintained for now (migration to flat config can be done separately)

## Migration Recommendation

The project currently uses ESLint v9 with legacy config mode. To remove the deprecation warning, you can migrate to flat config later:

```bash
# When ready to migrate:
npx @eslint/migrate-config .eslintrc.json
```

This is optional and not required for CI to pass.
