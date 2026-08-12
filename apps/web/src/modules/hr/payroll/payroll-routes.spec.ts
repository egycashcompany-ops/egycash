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
    // pay-items (PY-1) and runs (PY-6). No payslip, no tax, no run calculation — none exist.
    expect(declaredPaths()).toEqual(['pay-items', 'runs']);
  });

  it('gates every route behind a payroll permission', () => {
    const guarded = [...ROUTES.matchAll(/<RequirePermission permission="([^"]+)">/g)].map((m) => m[1]);
    expect(guarded).toEqual(['payItem.view', 'payrollRun.view']);
    expect(guarded).toHaveLength(declaredPaths().length);
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
