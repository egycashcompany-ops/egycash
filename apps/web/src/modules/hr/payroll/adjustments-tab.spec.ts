// Structural invariants of the Payroll Adjustments tab (P-HR-04).
//
// The web suite runs in `node`, so nothing here renders — and it does not need to. What must hold
// about this tab is a property of its SOURCE: that it is lazy-loaded like every additive tab, that
// it is behind the compensation answer the server already gave, that the two-person rule is
// visible in which buttons exist, and that it asks for a MONTH rather than an interval — because
// "one-off" is the whole difference from the Pay Items tab beside it.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const TAB = stripComments(read('./components/EmployeeAdjustmentsTab.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const PROFILE = stripComments(
  read('../employee-management/employees/pages/EmployeeProfilePage.tsx'),
);

describe('wired into the profile the way every additive tab is', () => {
  it('is registered as a tab', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'adjustments'/);
  });

  // A static import would pull payroll into the employees chunk for every user who never opens it.
  it('is loaded through a dynamic import(), not a static one', () => {
    expect(PROFILE).toContain("lazy(\n  () => import('../../../payroll/components/EmployeeAdjustmentsTab'),\n)");
    expect(PROFILE).not.toMatch(/^import .*EmployeeAdjustmentsTab.* from/m);
  });

  it('exports a default component, which is what lazy() requires', () => {
    expect(TAB).toMatch(/export default EmployeeAdjustmentsTab;/);
  });

  // Money is redacted server-side; the tab follows that same answer rather than inventing a second
  // rule for when a figure may be shown.
  it('appears only when the server says compensation is visible', () => {
    expect(PROFILE).toContain("{tab === 'adjustments' && e.compensationVisible && (");
    // The shape changed in P-HR-11 (a filter with branches, not a ternary) because Settlement is
    // gated on an exit as well as on compensation. The rule this asserts is the same one.
    // P-HR-20 added the Payslips tab to the same branch — the rule is unchanged, and the
    // condition it is asserted against grew by one name.
    // Matched whitespace-insensitively: P-HR-20 added `payslips` to the same branch, which
    // wrapped the condition onto two lines. Where a formatter puts the break is its business; the
    // rule — no money tab without the compensation answer — is unchanged.
    expect(PROFILE).toMatch(
      /if \(k === 'payItems' \|\| k === 'adjustments' \|\| k === 'loans' \|\| k === 'payslips'\)\s*return compensationVisible;/,
    );
  });
});

describe('the two-person rule is visible in the screen (D1)', () => {
  it('records under one key and decides under another', () => {
    expect(TAB).toContain("can('payrollAdjustment.create')");
    expect(TAB).toContain("can('payrollAdjustment.approve')");
  });

  it('and offers no key this phase did not declare', () => {
    const used = new Set([...TAB.matchAll(/can\('([^']+)'\)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(['payrollAdjustment.approve', 'payrollAdjustment.create']);
  });

  // The decision belongs to the pending state — offering "approve" on a draft would advertise an
  // action the server refuses.
  it('shows the decision only while an entry is awaiting one', () => {
    expect(TAB).toContain("r.status === 'pendingApproval' && canApprove");
    expect(TAB).toContain("r.status === 'draft' && canRecord");
  });
});

describe('one month, one amount (D5)', () => {
  // A month input, not two dates — the screen cannot express an interval, which is the point.
  it('asks for a period, not a date range', () => {
    expect(TAB).toContain('type="month"');
    expect(TAB).not.toContain('effectiveFrom');
    expect(TAB).not.toContain('effectiveTo');
  });

  // The amount is always positive; `kind` carries the direction. A minus sign here would be a
  // second way to say the same thing, and the two would eventually disagree.
  it('takes a positive amount and a kind, never a signed one', () => {
    expect(TAB).toContain('min="0"');
    expect(TAB).toContain('PAYROLL_ADJUSTMENT_KINDS.map');
  });

  it('and carries no instalment or recurrence vocabulary', () => {
    for (const word of ['installment', 'instalment', 'recurring', 'months', 'schedule']) {
      expect(TAB.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe('it talks to the endpoints the server exposes', () => {
  it('posts to the per-employee adjustment routes', () => {
    expect(API).toContain('/adjustments');
    expect(API).toContain('/submit');
    expect(API).toContain('/decide');
    expect(API).toContain('/cancel');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'employees.tabs.adjustments',
    'payroll.adjustments.add',
    'payroll.adjustments.kind.bonus',
    'payroll.adjustments.kind.penalty',
    'payroll.adjustments.status.pendingApproval',
    'payroll.adjustments.approve',
    'payroll.adjustments.reject',
  ];

  it('resolves in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('and says something different in each', () => {
    for (const key of KEYS) {
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });
});
