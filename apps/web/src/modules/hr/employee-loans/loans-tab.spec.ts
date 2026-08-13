// Structural invariants of the Loans tab (P-HR-05, phase A).
//
// The web suite runs in `node`, so nothing here renders — and it does not need to. What must hold
// about this tab is a property of its SOURCE: that it is lazy-loaded like every additive tab, that
// it is behind the compensation answer the server already gave, that the permission split is
// visible in which buttons exist, and that it shows a SCHEDULE — the second level this feature has
// and the adjustments tab beside it does not.
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

const TAB = stripComments(read('./components/EmployeeLoansTab.tsx'));
const API = stripComments(read('./api/employee-loans-api.ts'));
const PROFILE = stripComments(
  read('../employee-management/employees/pages/EmployeeProfilePage.tsx'),
);

describe('wired into the profile the way every additive tab is', () => {
  it('is registered as a tab', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'loans'/);
  });

  // A static import would pull this feature into the employees chunk for every user who never
  // opens it — including everybody at an organization that lends nobody anything.
  it('is loaded through a dynamic import(), not a static one', () => {
    expect(PROFILE).toContain(
      "lazy(\n  () => import('../../../employee-loans/components/EmployeeLoansTab'),\n)",
    );
    expect(PROFILE).not.toMatch(/^import .*EmployeeLoansTab.* from/m);
  });

  it('exports a default component, which is what lazy() requires', () => {
    expect(TAB).toMatch(/export default EmployeeLoansTab;/);
  });

  // A debt is compensation: it follows the same server answer the salary on the Overview tab does,
  // rather than inventing a second rule for when a figure may be shown.
  it('appears only when the server says compensation is visible', () => {
    expect(PROFILE).toContain("{tab === 'loans' && e.compensationVisible && (");
    expect(PROFILE).toContain("k !== 'payItems' && k !== 'adjustments' && k !== 'loans'");
  });
});

describe('the permission split is visible in the screen (D2)', () => {
  it('records under one key and decides under another', () => {
    expect(TAB).toContain("can('employeeLoan.create')");
    expect(TAB).toContain("can('employeeLoan.approve')");
  });

  it('and offers no key this phase did not declare', () => {
    const used = new Set([...TAB.matchAll(/can\('([^']+)'\)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(['employeeLoan.approve', 'employeeLoan.create']);
  });

  // Every act that moves money is behind `approve` — deciding, paying out, rescheduling, closing.
  // Proposing one is not.
  it('puts the money-moving actions behind the approve key', () => {
    expect(TAB).toContain("loan.status === 'pendingApproval' && canApprove");
    expect(TAB).toContain("loan.status === 'approved' && canApprove");
    expect(TAB).toContain("loan.status === 'active' && canApprove");
    expect(TAB).toContain("loan.status === 'draft' && canRecord");
  });

  // The server refuses to cancel a disbursed loan; a button offering it would advertise a refusal.
  it('offers cancellation only before the money moved', () => {
    expect(TAB).toContain(
      "loan.status === 'draft' || loan.status === 'pendingApproval' || loan.status === 'approved'",
    );
  });
});

describe('an obligation and its schedule (D5, D6)', () => {
  it('shows the schedule and what is still owed', () => {
    expect(TAB).toContain('loan.installments');
    expect(TAB).toContain("t('loans.remaining')");
    expect(TAB).toContain("t('loans.noSchedule')");
  });

  // The reschedule dialog takes a COUNT and a MONTH and no amount at all — the server re-splits
  // what is left. An amount field here would be a second place the debt could change.
  it('reschedules without an amount field', () => {
    const dialog = TAB.slice(
      TAB.indexOf('const RescheduleDialog'),
      TAB.indexOf('const AccelerateDialog'),
    );
    expect(dialog.length).toBeGreaterThan(0);
    expect(dialog).toContain('installmentCount');
    expect(dialog).toContain('firstPeriod');
    expect(dialog).not.toContain('setPrincipal');
    expect(dialog).not.toContain("t('loans.principal')");
  });

  // D7-1 closes the loan, so its amount IS the balance: shown, never typed.
  it('settles the balance rather than an amount somebody types', () => {
    const dialog = TAB.slice(TAB.indexOf('const SettleDialog'));
    expect(dialog).toContain('amount: loan.remaining');
    expect(dialog).toContain('readOnly');
  });

  /**
   * D7-2 — the payroll path, and the screen keeps it distinct from D7-1's.
   *
   * One names a month and an extra amount to take out of a salary; the other records money that
   * arrived some other way. Offering them as one button would be the conflation the whole decision
   * exists to prevent.
   */
  it('offers acceleration as its own action, separate from settling', () => {
    expect(TAB).toContain("t('loans.accelerate')");
    expect(TAB).toContain("t('loans.settleExternal')");
    const dialog = TAB.slice(
      TAB.indexOf('const AccelerateDialog'),
      TAB.indexOf('const SettleDialog'),
    );
    expect(dialog).toContain('extraAmount');
    expect(dialog).toContain('period');
    // It is not a cash receipt: nothing here says an amount was collected.
    expect(dialog).not.toContain('loan.remaining');
  });

  // The ledger's sum, shown beside what is left — both derived, neither stored.
  it('shows what payroll has taken so far', () => {
    expect(TAB).toContain("t('loans.repaid')");
    expect(TAB).toContain('loan.repaid');
  });

  // An instalment that a payslip took reads differently from one that is still an intention.
  it('and tells a deducted instalment apart from a planned one', () => {
    expect(TAB).toContain('INSTALLMENT_TONE');
    expect(TAB).toContain('deducted:');
  });
});

describe('it talks to the endpoints the server exposes, and to no payroll', () => {
  it('posts to the per-employee loan routes', () => {
    expect(API).toContain('/loans');
    expect(API).toContain('/submit');
    expect(API).toContain('/decide');
    expect(API).toContain('/disburse');
    expect(API).toContain('/reschedule');
    expect(API).toContain('/accelerate');
    expect(API).toContain('/settle-external');
    expect(API).toContain('/cancel');
  });

  /**
   * Even now that payroll deducts instalments, the SCREEN never calls payroll.
   *
   * The deduction happens server-side when a payslip is issued; this tab reads the loan and its
   * ledger. A call to `/hr/payroll` from here would mean the browser had opinions about when a
   * repayment counts.
   */
  it('and calls nothing under /hr/payroll', () => {
    expect(API).not.toContain('/hr/payroll');
    expect(TAB).not.toContain('payslip');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'employees.tabs.loans',
    'loans.add',
    'loans.type.advance',
    'loans.type.loan',
    'loans.status.active',
    'loans.status.settled',
    'loans.disburse',
    'loans.reschedule',
    'loans.settleExternal',
    'loans.remaining',
    'loans.installment.planned',
    'loans.installment.deducted',
    'loans.repaid',
    'loans.accelerate',
    'loans.extraAmount',
    'loans.status.outstandingAtExit',
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
