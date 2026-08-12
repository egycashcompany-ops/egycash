// Structural invariants for the employee Pay Items tab (PY-2).
//
// The web suite runs in `node`, so nothing here renders — and it does not need to. What must be
// guaranteed about this tab is guaranteed by its SOURCE: that it is lazy-loaded like every other
// additive tab, that it is behind the compensation answer the server already gave, that it uses
// no permission key this phase did not already have, and that it shows nothing about tax,
// attendance or a payroll run — none of which exist.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAB = readFileSync(resolve(HERE, 'components/EmployeePayItemsTab.tsx'), 'utf8');
const API = readFileSync(resolve(HERE, 'api/payroll-api.ts'), 'utf8');
const PROFILE = readFileSync(
  resolve(HERE, '../employee-management/employees/pages/EmployeeProfilePage.tsx'),
  'utf8',
);

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

describe('the Pay Items tab is wired into the profile the way every additive tab is', () => {
  it('is registered as a tab', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'payItems'/);
  });

  // A static import would pull payroll into the employees chunk for every user who never opens
  // it — the same seam Leave, Attendance and Contracts use.
  it('is loaded through a dynamic import(), not a static one', () => {
    expect(PROFILE).toContain("lazy(\n  () => import('../../../payroll/components/EmployeePayItemsTab'),\n)");
    expect(PROFILE).not.toMatch(/^import .*EmployeePayItemsTab.* from/m);
  });

  it('exports a default component, which is what lazy() requires', () => {
    expect(TAB).toMatch(/export default EmployeePayItemsTab;/);
  });

  // Compensation is redacted server-side; the tab follows that same answer rather than inventing
  // a second rule for when a salary figure may be shown.
  it('appears only when the server says compensation is visible', () => {
    expect(PROFILE).toContain("TABS.filter((k) => k !== 'payItems')");
    expect(PROFILE).toContain("{tab === 'payItems' && e.compensationVisible && (");
  });
});

describe('the tab reuses the compensation keys and declares none of its own', () => {
  it('gates writing on employee.manageCompensation', () => {
    expect(TAB).toContain("can('employee.manageCompensation')");
  });

  // PY-2 added no permission. Any key here must be one that already existed.
  it('names no key outside the ones this phase already had', () => {
    const used = new Set(
      [...stripComments(TAB).matchAll(/can\('([^']+)'\)|permission="([^"]+)"/g)].map(
        (m) => m[1] ?? m[2],
      ),
    );
    expect([...used].sort()).toEqual(['employee.manageCompensation', 'payItem.view']);
  });

  it('reads and writes under the employee, where the compensation scope is spent', () => {
    expect(API).toContain('`/hr/employees/${employeeId}/pay-items');
    // Runs ship with PY-6 and payslips with PY-7; a tax or statutory rule still does not exist.
    expect(API).not.toMatch(/payroll\/(tax|statutory|contributions)/);
  });
});

describe('the tab shows the assignment and nothing that does not exist', () => {
  const REQUIRED = [
    'payroll.employeeItems.item',
    'payroll.employeeItems.amount',
    'payroll.employeeItems.effectiveFrom',
    'payroll.employeeItems.effectiveTo',
    'payroll.employeeItems.note',
    'payroll.employeeItems.add',
    'payroll.employeeItems.remove',
  ];

  it('renders every column the phase specifies, plus add and remove', () => {
    for (const key of REQUIRED) expect(TAB, key).toContain(`'${key}'`);
  });

  // Taxes and social insurance are out of Payroll v1; runs and payslips do not exist. A control
  // for any of them here would be a claim, not a feature — and this is where one would appear.
  it('shows no tax, insurance, attendance, run or payslip control', () => {
    expect(stripComments(TAB)).not.toMatch(
      /\btax\b|taxable|insurance|payslip|payrollRun|netPay|grossPay|overtime|attendance|punch/i,
    );
  });

  // An amount is read left-to-right even in an Arabic layout; the surrounding page stays RTL.
  it('renders the figure in an LTR box without forcing the page direction', () => {
    expect(TAB).toMatch(/dir="ltr"/);
    expect(TAB).not.toMatch(/dir="rtl"|direction:\s*rtl/);
  });
});

describe('every label the tab asks for resolves in both locales', () => {
  const keys = [
    ...new Set(
      [...TAB.matchAll(/\bt\(\s*'((?:payroll|common)\.[a-zA-Z0-9_.]+)'/g)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      ),
    ),
  ].sort();

  // The removal outcomes are rendered through a template key, so the literal scan cannot see them.
  const OUTCOME_KEYS = ['removed', 'ended', 'alreadyEnded'].map(
    (outcome) => `payroll.employeeItems.removed.${outcome}`,
  );

  it('finds the keys to check', () => {
    expect(keys.length).toBeGreaterThan(10);
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`resolves all of them — ${locale}`, () => {
      const missing = [...keys, ...OUTCOME_KEYS].filter((key) => translate(locale, key) === key);
      expect(missing).toEqual([]);
    });
  }

  it('does not ship English text as the Arabic label', () => {
    const untranslated = [...keys, ...OUTCOME_KEYS].filter(
      (key) => translate('ar', key) === translate('en', key),
    );
    expect(untranslated).toEqual([]);
  });

  it('translates the profile tab label itself in both locales', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      expect(translate(locale, 'employees.tabs.payItems')).not.toBe('employees.tabs.payItems');
    }
    expect(translate('ar', 'employees.tabs.payItems')).not.toBe(
      translate('en', 'employees.tabs.payItems'),
    );
  });
});
