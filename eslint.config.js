// Flat ESLint config for the whole monorepo.
// Layer/module boundary rules follow docs/01-business/module-hierarchy.md §1
// and are machine-enforced here (ADR-001, ADR-003).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/postcss.config.cjs',
      'apps/web/tailwind.config.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware rules for TS sources.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='console']",
          message: 'console.* is banned — use the Pino logger (ADR-012).',
        },
      ],
    },
  },

  // Backend layer boundaries (Layer 1 platform · Layer 2 modules · Layer 3 shared · Layer 4 infrastructure).
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'boundaries/elements': [
        { type: 'shared', pattern: 'apps/api/src/shared/**' },
        { type: 'infrastructure', pattern: 'apps/api/src/infrastructure/**' },
        { type: 'platform', pattern: 'apps/api/src/platform/**' },
        { type: 'modules', pattern: 'apps/api/src/modules/**' },
        { type: 'app', pattern: 'apps/api/src/*.ts', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            '${file.type} may not import ${dependency.type} — see docs/01-business/module-hierarchy.md §1',
          rules: [
            { from: 'shared', allow: ['shared'] },
            { from: 'infrastructure', allow: ['infrastructure', 'shared'] },
            { from: 'platform', allow: ['platform', 'shared', 'infrastructure'] },
            { from: 'modules', allow: ['modules', 'platform', 'shared'] },
            { from: 'app', allow: ['app', 'platform', 'modules', 'shared', 'infrastructure'] },
          ],
        },
      ],
    },
  },

  // Scripts and config files run under Node without the app logger.
  {
    files: ['scripts/**', '*.config.{js,ts}', '**/*.config.{js,ts}', '**/vite.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Tests may use non-null assertions and looser typing ergonomics.
  {
    files: ['**/*.spec.ts', 'apps/api/tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
