// Structural invariants for the Payroll surface (PY-1, widened once in PY-6).
//
// Two of them exist because PY-1 was the FIRST payroll phase, and the shape it set is the shape
// the rest inherit: every route is permission-gated, and nothing statutory or monetary has crept
// into a catalog screen that has neither. The route list is stated exactly rather than counted, so
// a surface that ships without a phase behind it fails here by name.
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
    // pay-items (PY-1), runs (PY-6) and the employee's own payslips (PY-11). No tax and no run
    // calculation — neither exists.
    expect(declaredPaths()).toEqual(['payslips/me', 'pay-items', 'runs']);
  });

  /**
   * Everything an ADMINISTRATOR reaches is behind a key; the one self-service route is not, and
   * that is the design rather than a gap.
   *
   * `/payslips/me` resolves its rows from the caller's own login link on the server, so there is
   * no wider reach a permission could gate — the posture My Attendance has as its module's index.
   * The count assertion is what keeps this honest: exactly ONE route may be unguarded, and it must
   * be that one, so a future page cannot join it by accident.
   */
  it('gates every route except the one that is own-scope by construction', () => {
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]);
    expect(guarded).toEqual(['payItem.view', 'payrollRun.view']);
    expect(guarded).toHaveLength(declaredPaths().length - 1);
    expect(declaredPaths().filter((p) => p.endsWith('/me'))).toEqual(['payslips/me']);
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
