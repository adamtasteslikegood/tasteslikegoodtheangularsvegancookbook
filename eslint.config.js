import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import angularPlugin from '@angular-eslint/eslint-plugin';
import angularTemplatePlugin from '@angular-eslint/eslint-plugin-template';
import angularTemplateParser from '@angular-eslint/template-parser';
import prettierConfig from 'eslint-config-prettier';

// Normalize flat-config exports that may be a single object or an array.
const collectRules = (configEntry, preferredName) => {
  if (!configEntry) return {};
  const entries = Array.isArray(configEntry) ? configEntry : [configEntry];

  if (preferredName) {
    const preferred = entries.find((entry) => entry?.name === preferredName);
    if (preferred?.rules) return preferred.rules;
  }

  return entries.reduce((rules, entry) => ({ ...rules, ...(entry?.rules ?? {}) }), {});
};

// Locate the TypeScript-specific rules from the flat config by name rather than
// by positional index so the config stays correct if the array order changes.
const tsRecommendedRules = collectRules(
  tsPlugin.configs['flat/recommended'],
  'typescript-eslint/recommended',
);
const angularRecommendedRules = collectRules(
  angularPlugin.configs?.recommended,
  '@angular-eslint/recommended',
);
const angularTemplateRecommendedRules = collectRules(
  angularTemplatePlugin.configs?.recommended,
  '@angular-eslint/template/recommended',
);
const angularTemplateAccessibilityRules = collectRules(
  angularTemplatePlugin.configs?.accessibility,
  '@angular-eslint/template/accessibility',
);

export default [
  // Global ignores (replaces .eslintignore)
  {
    ignores: ['dist/**', 'node_modules/**', 'server/dist/**', 'Backend/**'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // Frontend TypeScript files (Angular source)
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        project: ['tsconfig.json'],
        createDefaultProgram: true,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      '@angular-eslint': angularPlugin,
    },
    rules: {
      ...tsRecommendedRules,
      ...angularRecommendedRules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': ['error', { destructuring: 'all' }],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },

  // Server TypeScript files (Node.js / Express)
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        project: ['server/tsconfig.server.json'],
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsRecommendedRules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Angular HTML templates
  {
    files: ['**/*.html'],
    languageOptions: {
      parser: angularTemplateParser,
    },
    plugins: {
      '@angular-eslint/template': angularTemplatePlugin,
    },
    rules: {
      ...angularTemplateRecommendedRules,
      ...angularTemplateAccessibilityRules,
    },
  },

  // Prettier — must be last to disable conflicting ESLint formatting rules
  prettierConfig,
];
