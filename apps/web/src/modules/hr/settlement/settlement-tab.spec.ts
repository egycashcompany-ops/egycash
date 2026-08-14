// Structural invariants of the Settlement tab (P-HR-11).
//
// The web suite runs in `node`, so nothing here renders — and it does not need to. What must hold
// about this screen is a property of its SOURCE, and it is an unusual list, because most of this
// phase's design is about what the screen must NOT do:
//
//   * it must not compute. Every figure is quoted from the feature that owns it, so a total
//     assembled in the browser would be a second answer about somebody's last salary.
//   * it must not write. There is no settlement lifecycle, by decision (design §5.4).
//   * it must not state a severance, notice or encashment amount, because no rule for one exists
//     in this repository — it names them as unresolved instead.
//   * and it must not offer itself for somebody who has not left, because the server refuses that
//     as a matter of fact rather than of permission.
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

const TAB = stripComments(read('./components/EmployeeSettlementTab.tsx'));
const API = stripComments(read('./api/settlement-api.ts'));
const QUERIES = stripComments(read('./api/settlement-queries.ts'));
const PROFILE = stripComments(
  read('../employee-management/employees/pages/EmployeeProfilePage.tsx'),
);

describe('wired into the profile the way every additive tab is', () => {
  it('is registered as a tab', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'settlement'/);
  });

  it('is loaded through a dynamic import(), not a static one', () => {
    expect(PROFILE).toContain(
      "lazy(\n  () => import('../../../settlement/components/EmployeeSettlementTab'),\n)",
    );
    expect(PROFILE).not.toMatch(/^import .*EmployeeSettlementTab.* from/m);
  });

  it('exports a default component, which is what lazy() requires', () => {
    expect(TAB).toMatch(/export default EmployeeSettlementTab;/);
  });

  /**
   * TWO conditions, not one — and the second is what makes this tab different from the three money
   * tabs beside it.
   *
   * A settlement summary exists only once somebody has left: the server refuses it for a serving
   * employee because there is no exit month to state. A tab that appeared anyway could only ever
   * show an error, so it appears exactly when the answer exists.
   */
  it('appears only when compensation is visible AND the employee has exited', () => {
    expect(PROFILE).toContain(
      "if (k === 'settlement') return compensationVisible && exited;",
    );
    expect(PROFILE).toContain(
      "{tab === 'settlement' && e.compensationVisible && e.exit !== null && (",
    );
    expect(PROFILE).toContain('visibleTabs(e.compensationVisible, e.exit !== null)');
  });
});

describe('it quotes; it does not compute', () => {
  /**
   * No arithmetic in the browser.
   *
   * The screen reads totals the compensation engine produced and a balance the loans feature
   * derived. Adding them up here — a "total settlement" line — would be this screen inventing a
   * figure no service stands behind, and it would be the one number on the page nobody could
   * reconcile against another screen.
   */
  it('does no arithmetic on any amount', () => {
    for (const operator of [' * ', ' / ', ' % ', 'Math.', 'reduce(']) {
      expect(TAB, operator).not.toContain(operator);
    }
  });

  it('reads the totals the server already computed', () => {
    expect(TAB).toContain('s.finalPeriod.totalEarnings');
    expect(TAB).toContain('s.finalPeriod.totalDeductions');
    expect(TAB).toContain('s.finalPeriod.net');
    expect(TAB).toContain('s.outstandingLoan.remaining');
  });
});

describe('it is a read, and offers no act', () => {
  /** One GET, no mutation hook, and no mutation to hang one on. */
  it('calls one endpoint and no other', () => {
    expect(API).toContain('/settlement');
    const calls = [...API.matchAll(/\b(get|post|patch|del|put)</g)].map((m) => m[1]);
    expect(calls).toEqual(['get']);
  });

  it('and has no mutation, so nothing on the screen can change anything', () => {
    expect(QUERIES).not.toContain('useMutation');
    expect(QUERIES).not.toContain('invalidateQueries');
    expect(TAB).not.toContain('.mutate(');
    expect(TAB).not.toContain('<Dialog');
  });

  /**
   * NO permission of its own, in the screen either.
   *
   * Reading a leaver's money is reading pay: the server gated the route on
   * `employee.viewCompensation`, and the profile hub already asked that question once —
   * `compensationVisible`. A `can(...)` here would be a second, quieter rule about the same money.
   */
  it('declares no permission key of its own', () => {
    expect(TAB).not.toContain("can('");
    expect(TAB).not.toContain('useCan');
  });
});

describe('the amounts nobody has a rule for stay absent (design §5)', () => {
  /**
   * Named, and empty. The screen renders `unresolved` as it arrives from the server rather than
   * from a list of its own, so an item cannot be dropped from the UI while the server still
   * reports it — which is exactly how an incomplete settlement would start looking complete.
   */
  it('renders the server’s unresolved list rather than one of its own', () => {
    expect(TAB).toContain('s.unresolved.map(');
    expect(TAB).toContain('t(`settlement.unresolved.${item}`)');
  });

  it('and hard-codes no severance, notice or encashment figure', () => {
    const lower = TAB.toLowerCase();
    for (const word of ['severance', 'gratuityamount', 'noticepay', 'daysperyear', 'halfmonth']) {
      expect(lower, word).not.toContain(word);
    }
  });

  /** C and D, restated on the client: no bank file, no PDF, no export button. */
  it('and offers no bank file, export or printable document', () => {
    const lower = TAB.toLowerCase();
    for (const word of ['iban', 'wps', 'pdf', 'csv', 'print(', 'download']) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'employees.tabs.settlement',
    'settlement.exit.title',
    'settlement.exit.period',
    'settlement.exit.frozen',
    'settlement.frozen.yes',
    'settlement.frozen.no',
    'settlement.finalPeriod.title',
    'settlement.finalPeriod.hint',
    'settlement.finalPeriod.net',
    'settlement.finalPeriod.days',
    'settlement.finalPeriod.daysValue',
    'settlement.loan.title',
    'settlement.loan.none',
    'settlement.loan.remaining',
    'settlement.leave.title',
    'settlement.leave.none',
    'settlement.leave.days',
    'settlement.pending.title',
    'settlement.pending.hint',
    'settlement.pending.none',
    'settlement.unresolved.title',
    'settlement.unresolved.hint',
    'settlement.unresolved.endOfServiceGratuity',
    'settlement.unresolved.endOfServiceGratuity.why',
    'settlement.unresolved.leaveEncashment',
    'settlement.unresolved.leaveEncashment.why',
    'settlement.unresolved.noticePeriod',
    'settlement.unresolved.noticePeriod.why',
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
