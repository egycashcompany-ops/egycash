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

  // PY-10 — the legacy `employment.allowances[]` list may not re-enter the payroll CALCULATION.
  //
  // The decisions are frozen (docs/12-planning/payroll-legacy-allowances-migration.md): the list is
  // historical/audit data, it is never a payroll source, and Pay Items are the operational single
  // source of truth. Payroll has in fact never read these amounts — it reads only whether the list
  // is non-empty, to raise `legacyAllowancesIgnored`.
  //
  // That distinction is one property access wide. `employee.employment.allowances.length > 0` is a
  // fact about the record; `.reduce((sum, a) => sum + a.amount, 0)` is money nobody decided to pay.
  // A rule rather than a convention, because the array sits on the same document the salary does
  // and the tempting line is a short one.
  {
    files: ['apps/api/src/modules/hr/payroll/**/*.ts'],
    ignores: [
      // One door: the service that turns "is the list non-empty?" into the warning. What it may
      // do there is pinned in compensation/legacy-allowances-seam.spec.ts.
      'apps/api/src/modules/hr/payroll/compensation/compensation.service.ts',
    ],
    rules: {
      // Flat config REPLACES a rule's options rather than merging them, so the base block's
      // console ban is restated here — omitting it would quietly switch it off for payroll.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='console']",
          message: 'console.* is banned — use the Pino logger (ADR-012).',
        },
        {
          selector: "MemberExpression[property.name='allowances'][object.property.name='employment']",
          message:
            'PY-10: employment.allowances[] is historical data and never a payroll source. Pay Items are the operational SSoT; the only permitted read is the presence check in compensation.service.ts.',
        },
        {
          selector: "MemberExpression[property.name='allowances'][object.name='employment']",
          message:
            'PY-10: employment.allowances[] is historical data and never a payroll source. Pay Items are the operational SSoT; the only permitted read is the presence check in compensation.service.ts.',
        },
      ],
    },
  },

  // A gold customer's company id is the ONE value that keeps one customer from reading another's
  // metal, so the type that carries it — `PortalCompany` — has exactly one producer: the cast
  // inside `requireGoldPortal`, which mints it only after proving the binding against the database.
  //
  // A second cast anywhere would defeat the whole scheme quietly, because the tempting line is
  // short and reads as a formality: `req.query.companyId as PortalCompany`. It is banned as syntax
  // rather than left to review, and the one legitimate site is the only file exempted.
  {
    files: ['apps/api/src/modules/gold/**/*.ts'],
    ignores: ['apps/api/src/modules/gold/portal/portal-scope.ts'],
    rules: {
      // Flat config REPLACES a rule's options rather than merging them, so the base block's
      // console ban is restated here.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='console']",
          message: 'console.* is banned — use the Pino logger (ADR-012).',
        },
        {
          selector: "TSAsExpression > TSTypeReference[typeName.name='PortalCompany']",
          message:
            'PortalCompany is minted only by requireGoldPortal, after the binding is proved against the database. Take one as a parameter instead of casting.',
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

  // The service worker ships from `public/` verbatim — no bundler, no TypeScript — so it is plain
  // JS running in a worker global scope rather than a window one.
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
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
