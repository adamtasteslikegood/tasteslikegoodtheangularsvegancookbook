import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'server/**/*.spec.ts',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
    ],
    exclude: ['server/dist/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/**/*.ts'],
      exclude: [
        'server/dist/**',
        'server/**/*.test.ts',
        'server/**/*.spec.ts',
        // Startup / integration files — covered by E2E, not unit tests
        'server/index.ts',
        'server/proxy.ts',
        'server/types.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        branches: 50,
        functions: 40,
      },
    },
  },
});
