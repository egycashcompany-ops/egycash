// Structural invariants of the loans administration screen (P-HR-06-B).
//
// The web suite runs in `node`, so nothing here renders — and it does not need to. What must hold
// about this screen is a property of its SOURCE, and the properties worth holding are the ones the
// phase was defined by:
//
//   • it adds no API — it calls the organization-wide read that phase A already mounted, and the
//     acts it performs are the per-employee endpoints the tab already posts to;
//   • it adds no permission — `employeeLoan.view / create / approve`, and nothing else exists;
//   • it does NOT replace the tab, and it does not try to do the tab's job: every act that reshapes
//     a SCHEDULE stays where the schedule is visible;
//   • the declared page `hr.employee-loans` resolves to a routed screen, which is the exact defect
//     P-HR-06-A found in the adjustments queue and which no gate can catch.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Code only — this screen explains its own restraint in prose, and prose must not prove it. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const PAGE = stripComments(read('./pages/EmployeeLoansAdminPage.tsx'));
const API = stripComments(read('./api/employee-loans-api.ts'));
const ROUTES = read('../payroll/routes.tsx');
const MANIFEST = read('../../../../../api/src/modules/hr/hr.module.ts');
const SEED = read('../../../../../api/src/seed-navigation.ts');
const SECTIONS = read('../../../../../api/src/seed-application-sections.ts');
const TAB = stripComments(read('./components/EmployeeLoansTab.tsx'));

describe('the page the module declares is the page that is routed', () => {
  /**
   * `employeeLoan.*` shipped with `pageId: null` and a comment saying, correctly, that there was no
   * administration screen to point at. This phase built one, so the null became wrong. Both halves
   * are asserted together because either alone is a lie: a page id pointing at nothing, or a screen
   * no permission claims.
   */
  it('declares the page, points the keys at it, and routes it', () => {
    expect(MANIFEST).toContain("id: 'hr.employee-loans'");
    expect(MANIFEST).toContain("route: '/payroll/employee-loans'");
    expect(MANIFEST).toContain("'hr.employee-loans',\n);");
    expect(ROUTES).toContain('path="employee-loans"');
  });

  // D5's posture, repeated: the row is an invitation to act, so it belongs to whoever can act.
  it('is in the sidebar under the approve key, and in the payroll section', () => {
    expect(SEED).toContain("route: '/payroll/employee-loans'");
    expect(SEED).toContain("permission: 'employeeLoan.approve'");
    expect(SECTIONS).toContain("'/payroll/employee-loans'");
  });

  it('is gated on the key the server requires for the list it reads', () => {
    expect(ROUTES).toContain('<RequirePermission permission="employeeLoan.view">');
  });
});

describe('it adds nothing to the server', () => {
  it('reads the organization-wide endpoint phase A already mounted', () => {
    expect(API).toContain("`/hr/employee-loans${buildQuery(params)}`");
    expect(PAGE).toContain('useAllLoans');
  });

  /**
   * The two acts, and only the two.
   *
   * Deciding and disbursing are what an approver owes somebody who is waiting; both post to the
   * per-employee endpoints the tab already uses, with the employee taken from the row. Nothing here
   * is a new route.
   */
  it('acts through the endpoints that already existed', () => {
    expect(PAGE).toContain('useDecideLoanFromList');
    expect(PAGE).toContain('useDisburseLoanFromList');
  });

  it('and uses no key beyond the three this feature declared', () => {
    const used = new Set([...PAGE.matchAll(/can\('([^']+)'\)/g)].map((m) => m[1]));
    for (const key of used) {
      expect(['employeeLoan.view', 'employeeLoan.create', 'employeeLoan.approve']).toContain(key);
    }
  });
});

describe('it does not try to do the tab’s job', () => {
  /**
   * THE RESTRAINT THAT MATTERS. The organization-wide read returns a loan WITHOUT its instalments,
   * so this screen cannot show a schedule — and every one of these acts is about a schedule.
   * Offering to reshape a plan the screen cannot display would be an invitation to guess.
   */
  it('offers no act that needs a schedule it cannot show', () => {
    for (const forbidden of [
      'useRescheduleLoan',
      'useAccelerateLoan',
      'useSettleLoanExternally',
      'useCreateLoan',
      'useCancelLoan',
      'installments',
    ]) {
      expect(PAGE, forbidden).not.toContain(forbidden);
    }
  });

  // …and it says where those live, rather than leaving the reader at a dead end.
  it('links every row to the employee file where the schedule is', () => {
    expect(PAGE).toContain('/employees/${r.employeeId}');
  });

  // The tab is untouched by this phase: it still records, reschedules, accelerates and settles.
  it('leaves the profile tab exactly where it was', () => {
    expect(TAB).toContain('useRescheduleLoan');
    expect(TAB).toContain('useAccelerateLoan');
    expect(TAB).toContain('useSettleLoanExternally');
    expect(TAB).toMatch(/export default EmployeeLoansTab;/);
  });
});

describe('the worklist is a worklist', () => {
  /**
   * `approved` is the tab worth naming. Phase A's design says it is the MIDDLE of this machine —
   * the obligation begins at disbursement — so a loan sitting there is money promised and not yet
   * handed over, and until this screen nothing told anybody it was waiting.
   */
  it('names the two states an approver owes an answer for', () => {
    expect(PAGE).toContain("queue: 'pendingApproval'");
    expect(PAGE).toContain("toDisburse: 'approved'");
  });

  // Fixed, not a preselected dropdown: a filter can be changed and a worklist should not drift.
  it('fixes each worklist tab to one status rather than filtering it', () => {
    expect(PAGE).toContain('TAB_STATUS[tab]');
  });

  // The labels come from the server (P-HR-06-A / D7) and are never stored on the loan.
  it('shows the employee by name, never by id', () => {
    expect(PAGE).toContain('employeeName');
    expect(PAGE).toContain('employeeCode');
    expect(PAGE).not.toMatch(/\{r\.employeeId\}</);
  });

  // The contract refuses an amount at disbursement — a second figure there is a second principal.
  it('records a disbursement as a date and nothing else', () => {
    const dialog = PAGE.slice(PAGE.indexOf('const DisburseDialog'));
    expect(dialog.length).toBeGreaterThan(0);
    expect(dialog).toContain('disbursedAt');
    expect(dialog).not.toContain('amount');
    expect(dialog).not.toContain('principal');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'loans.admin.title',
    'loans.admin.subtitle',
    'loans.admin.tab.queue',
    'loans.admin.tab.toDisburse',
    'loans.admin.tab.all',
    'loans.admin.empty.queue',
    'loans.admin.empty.toDisburse',
    'loans.admin.empty.all',
    'loans.employee',
    'loans.allStatuses',
    'loans.allTypes',
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
