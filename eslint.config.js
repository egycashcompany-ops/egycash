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

  // Automation seam (ADR-018 decision 1, design D-A2). Business modules — and the Automation
  // module itself — reach an automation runtime through `platform/automation`'s barrel and no
  // other path. Deep imports would let a module take a dependency on a provider, which is the one
  // coupling the whole seam exists to prevent; ADR-018 permits n8n on a scope condition, and a
  // condition that can change must not be load-bearing in twenty modules.
  //
  // Scoped to files OUTSIDE platform/automation, so the seam's own internals import each other
  // freely. This is a rule rather than a convention because a seam everyone has to remember is a
  // seam that lasts until the first deadline.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/platform/automation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/platform/automation/*', '**/platform/automation/*/**'],
              message:
                "Import from 'platform/automation' (the barrel) — never a provider or internal. See ADR-018 and docs/02-architecture/automation-service.md.",
            },
          ],
        },
      ],
    },
  },

  // The Attendance → Payroll seam (PY-4, attendance design §15.1 / D-PR-07 Option A). Payroll may
  // read attendance ONLY through the frozen feed, and only from its one port file. Raw day rows,
  // punches and the freeze call are all out of reach.
  //
  // This is a rule rather than a convention because the attendance barrel exports the day model
  // itself: one convenient import inside a service, and Payroll would be pricing a month whose
  // truth was still moving — the exact failure the freeze exists to prevent. A seam everyone has
  // to remember is a seam that lasts until the first deadline.
  {
    files: ['apps/api/src/modules/hr/payroll/**/*.ts'],
    ignores: [
      // Exactly two doors, and both are named here: the read port that prices a period (PY-4)
      // and the freeze port the payroll run calls (PY-6). Nothing else in payroll may reach
      // attendance at all.
      'apps/api/src/modules/hr/payroll/compensation/attendance-quantity.port.ts',
      'apps/api/src/modules/hr/payroll/runs/attendance-freeze.port.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/attendance', '**/attendance/**'],
              message:
                "Payroll reaches attendance through two ports only: compensation/attendance-quantity.port.ts (reads the frozen feed) and runs/attendance-freeze.port.ts (calls the freeze). See the attendance design §15.1, PY-4 and PY-6.",
            },
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
        // Node 18+ ships these as globals; scripts that talk HTTP use them directly.
        fetch: 'readonly',
        AbortSignal: 'readonly',
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
