// Structural invariants for the Payroll surface (PY-1, widened in PY-6 and again in P-HR-06).
//
// Two of them exist because PY-1 was the FIRST payroll phase, and the shape it set is the shape
// the rest inherit: every route is permission-gated, and nothing statutory or monetary has crept
// into a catalog screen that has neither. The route list is stated exactly rather than counted, so
// a surface that ships without a phase behind it fails here by name.
//
// P-HR-06 widened it in the OTHER direction, which is worth naming: `hr.payroll-adjustments` was
// declared as a page in P-HR-04 and pointed at `/payroll/adjustments`, a route that resolved to
// nothing for two phases. `validatePageRegistry` cannot catch that — it checks a page's id, its
// module and that it has a permission, never that its route reaches a screen — so the assertion
// that the declared page and the routed screen agree lives here, next to the route list.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
const PAGE = readFileSync(resolve(HERE, 'pages/PayItemsPage.tsx'), 'utf8');
const SEED = readFileSync(resolve(HERE, '../../../../../api/src/seed-navigation.ts'), 'utf8');
const SECTIONS = readFileSync(
  resolve(HERE, '../../../../../api/src/seed-application-sections.ts'),
  'utf8',
);

const declaredPaths = (): string[] =>
  [...ROUTES.matchAll(/path="([^"*]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

describe('Payroll routes', () => {
  it('routes the shipped surface and nothing unshipped', () => {
    // pay-items (PY-1), runs (PY-6), the employee's own payslips (PY-11) and their own loans
    // (P-HR-18), the adjustments queue (P-HR-06-A) and the loans administration (P-HR-06-B). No
    // tax and no run calculation — neither exists.
    expect(declaredPaths()).toEqual([
      'payslips/me',
      'employee-loans/me',
      'adjustments/me',
      'pay-items',
      'runs',
      'adjustments',
      'employee-loans',
    ]);
  });

  /**
   * Everything an ADMINISTRATOR reaches is behind a key; the one self-service route is not, and
   * that is the design rather than a gap.
   *
   * `/payslips/me`, `/employee-loans/me` (P-HR-18) and `/adjustments/me` (P-HR-19) resolve their
   * rows from the caller's own login link on the server, so there is no wider reach a permission
   * could gate — the posture My Attendance has as its module's index.
   *
   * P-HR-18 added the second one, so "exactly ONE may be unguarded" became untrue. What replaced
   * it is STRONGER rather than looser: the unguarded set is now stated BY NAME, so a future page
   * cannot join it by accident — which is the thing the old count was protecting.
   */
  it('gates every route except the ones that are own-scope by construction', () => {
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]);
    expect(guarded).toEqual([
      'payItem.view',
      'payrollRun.view',
      'payrollAdjustment.view',
      'employeeLoan.view',
    ]);
    const unguarded = declaredPaths().filter((p) => p.endsWith('/me'));
    expect(unguarded).toEqual(['payslips/me', 'employee-loans/me', 'adjustments/me']);
    expect(guarded).toHaveLength(declaredPaths().length - unguarded.length);
    // …and the index route renders that same self-service page, never a guarded one.
    expect(ROUTES).toMatch(/<Route index element=\{<MyPayslipsPage \/>\} \/>/);
  });

  it('uses only the keys the payroll phases declare', () => {
    const used = new Set(
      [...`${ROUTES}${PAGE}`.matchAll(/permission="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const key of used) {
      expect([
        'payItem.view',
        'payItem.create',
        'payItem.edit',
        'payItem.delete',
        'payrollRun.view',
        'payrollAdjustment.view',
        'employeeLoan.view',
      ]).toContain(key);
    }
  });

  // No run, no payslip, no calculation and above all no statutory rule: PY-1 is a vocabulary
  // editor. A currency field or a tax control here would be the first crack in that.
  it('shows no money and no statutory field', () => {
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
    expect(stripComments(PAGE)).not.toMatch(
      /formatMoney|currency|EGP|\btax\b|insurance|payslip|netPay/i,
    );
  });

  it('is reachable from navigation, under the Payroll section', () => {
    expect(SEED).toContain("route: '/payroll/pay-items'");
    expect(SEED).toContain("permission: 'payItem.view'");
    // Organized through the section system that landed with #186, not a payroll-specific one.
    expect(SECTIONS).toContain("en: 'Payroll'");
    expect(SECTIONS).toContain("'/payroll/pay-items'");
  });
});

// ── P-HR-06 — the adjustments queue ─────────────────────────────────────────

describe('the payroll adjustments queue', () => {
  const MANIFEST = readFileSync(
    resolve(HERE, '../../../../../api/src/modules/hr/hr.module.ts'),
    'utf8',
  );
  // Code only — this page explains its own restraint in prose, and prose must not be what
  // satisfies an assertion that it exercises none.
  const QUEUE = readFileSync(resolve(HERE, 'pages/PayrollAdjustmentsPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

  /**
   * The defect this phase closed, stated so it cannot reopen.
   *
   * P-HR-04 declared `hr.payroll-adjustments` pointing at `/payroll/adjustments` and then routed
   * nothing there: for two phases the page registry, the permission matrix and every gate passed
   * while the route resolved to the module's 404. Nothing checks a page's route for a screen, so
   * this does.
   */
  it('the page the module declares resolves to a routed screen', () => {
    expect(MANIFEST).toContain("id: 'hr.payroll-adjustments'");
    expect(MANIFEST).toContain("route: '/payroll/adjustments'");
    expect(declaredPaths()).toContain('adjustments');
  });

  /**
   * D5 — the worklist belongs to whoever can end the wait.
   *
   * The navigation row is deliberately NARROWER than the route: `approve` puts it in the sidebar
   * of the people it is addressed to, while `view` still opens it for anyone the API answers.
   */
  it('is reachable from navigation under the approve key', () => {
    expect(SEED).toContain("route: '/payroll/adjustments'");
    expect(SEED).toContain("permission: 'payrollAdjustment.approve'");
    expect(SECTIONS).toContain("'/payroll/adjustments'");
  });

  /**
   * NO NEW API, and no second way to create money.
   *
   * The queue decides, through the same nested endpoint the profile tab posts to. Recording an
   * adjustment stays on the employee's file, where the person and the currency are already known —
   * a create form here would be a second entry point to the same decision with less context.
   */
  it('decides through the endpoint that already existed, and records nothing', () => {
    expect(QUEUE).toContain('useDecideAdjustmentFromQueue');
    for (const forbidden of ['useCreateAdjustment', 'useSubmitAdjustment', 'Dialog', 'toMinorUnits']) {
      expect(QUEUE, forbidden).not.toContain(forbidden);
    }
  });

  // D7 — the labels are enriched on the read, so the screen shows a name rather than an id. An id
  // rendered as the employee column is the failure this replaced, not a fallback for it.
  it('shows the employee from the enriched label, never from an id', () => {
    expect(QUEUE).toContain('employeeName');
    expect(QUEUE).toContain('employeeCode');
    expect(QUEUE).not.toMatch(/\{r\.employeeId\}/);
  });
});

// ── PY-11 — my payslips ─────────────────────────────────────────────────────

describe('the employee self-service payslip surface', () => {
  // Code only — this page explains in prose that it carries no permission, and prose must not
  // be what satisfies the assertion that it carries none.
  const PAGE_ME = readFileSync(resolve(HERE, 'pages/MyPayslipsPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

  it('asks the server for the caller, never for an employee id', () => {
    expect(PAGE_ME).not.toMatch(/employeeId/);
    expect(PAGE_ME).toContain('useMyPayslips');
  });

  it('carries no permission of its own — a key would gate a reach that does not exist', () => {
    expect(PAGE_ME).not.toContain('RequirePermission');
    expect(PAGE_ME).not.toContain('<Can ');
  });

  it('shows the STORED document rather than recomputing one', () => {
    for (const forbidden of ['toMinorUnits', 'scaleMinorUnits', '/ 100', '* 100', 'reduce(']) {
      expect(PAGE_ME, forbidden).not.toContain(forbidden);
    }
    expect(PAGE_ME).toContain('slip.totalEarnings');
    expect(PAGE_ME).toContain('slip.net');
  });

  it('says the figures do not change afterwards, in both locales', () => {
    expect(translate('en', 'payroll.payslips.mineHint')).toMatch(/do not change/i);
    expect(translate('ar', 'payroll.payslips.mineHint')).toContain('لا تتغيّر');
  });
});
