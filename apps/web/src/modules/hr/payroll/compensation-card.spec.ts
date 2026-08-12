// Structural invariants for the compensation card (PY-3).
//
// The web suite runs in `node`, so this reads the source rather than rendering it — and the things
// that must hold about this card are things the source can be held to: it shows a derivation and
// not just a figure, it never calls the result take-home pay, and it contains no control for a
// tax, a contribution, an attendance figure or a payroll run, because none of those exist.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPENSATION_WARNINGS,
  PAY_ITEM_QUANTITY_SOURCES,
  PAYROLL_RUN_STATUSES,
  type Locale,
} from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD = readFileSync(resolve(HERE, 'components/CompensationCard.tsx'), 'utf8');
const TAB = readFileSync(resolve(HERE, 'components/EmployeePayItemsTab.tsx'), 'utf8');
const API = readFileSync(resolve(HERE, 'api/payroll-api.ts'), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

describe('where the card lives', () => {
  it('sits inside the existing Pay Items tab, not on a page of its own', () => {
    expect(TAB).toContain('<CompensationCard employee={employee} />');
    expect(TAB).toContain("import { CompensationCard } from './CompensationCard'");
  });

  // PY-3 added no route and no navigation row of its own — the card lives inside a tab. The two
  // routes below belong to PY-1 and PY-6; a third would mean a surface shipped without a phase.
  it('adds no route of its own to the payroll surface', () => {
    const routes = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');
    expect([...routes.matchAll(/path="([^"*]+)"/g)].map((m) => m[1])).toEqual([
      'pay-items',
      'runs',
    ]);
  });

  it('reads compensation under the employee, and touches nothing unshipped', () => {
    expect(API).toContain('`/hr/employees/${employeeId}/compensation');
    // Runs ship with PY-6; payslips and tax rules still do not exist at all.
    expect(API).not.toMatch(/payroll\/(payslips|tax)/);
  });
});

describe('what the card shows', () => {
  // A figure an employee will ask about has to be able to answer: base, fraction, day counts.
  it('shows each line’s derivation, not only its result', () => {
    for (const key of [
      'payroll.compensation.base',
      'payroll.compensation.inForce',
      'payroll.compensation.amount',
    ]) {
      expect(CARD, key).toContain(`'${key}'`);
    }
    expect(CARD).toContain('l.daysInForce');
    expect(CARD).toContain('l.daysInPeriod');
  });

  it('separates earnings, deductions and the lines with no quantity yet', () => {
    for (const key of [
      'payroll.compensation.earnings',
      'payroll.compensation.deductions',
      'payroll.compensation.deferred',
    ]) {
      expect(CARD, key).toContain(`'${key}'`);
    }
  });

  it('renders a pending line as pending rather than as zero', () => {
    expect(CARD).toContain("l.amount === null");
    expect(CARD).toContain("'payroll.compensation.pending'");
  });

  // The label is the guard: calling this "net pay" would be a claim about legislation.
  it('never calls the result take-home or net pay', () => {
    expect(translate('en', 'payroll.compensation.net')).toBe('Earnings minus deductions');
    expect(stripComments(CARD)).not.toMatch(/take[- ]?home|netPay|grossPay|salarySlip/i);
  });

  it('shows no tax, insurance, attendance, punch, run or payslip control', () => {
    expect(stripComments(CARD)).not.toMatch(
      /\btax\b|taxable|insurance|contribution|payslip|payrollRun|overtime|attendance|punch/i,
    );
  });

  it('renders figures in LTR boxes without forcing the page direction', () => {
    expect(CARD).toMatch(/dir="ltr"/);
    expect(CARD).not.toMatch(/dir="rtl"|direction:\s*rtl/);
  });
});

// ── PY-5 — the leave lines ──────────────────────────────────────────────────
//
// The card gained the first rows nobody assigned. What they are worth is settled in the API's
// pure specs; what this file holds is that the card can SHOW one — that it no longer keys rows by
// a field that is now nullable, that it tells the two pending states apart, and that it reports
// the leave even in the month where the leave cost nothing.

describe('the card can render a line that has no assignment behind it', () => {
  const code = stripComments(CARD);

  it('never keys a row by a field that can be null', () => {
    expect(code).not.toContain('rowKey={(l) => l.sourceAssignmentId}');
    expect(code).toContain('rowKey={lineKey}');
  });

  it('builds that key from what makes a leave line unique', () => {
    expect(code).toContain('line.leaveTypeCode');
    expect(code).toContain('line.leavePayRate');
  });

  it('tells the two unknowns apart instead of calling both pending', () => {
    expect(code).toContain("'pendingLeaveSnapshot'");
    expect(code).toContain('payroll.compensation.pendingLeave');
    expect(code).toContain('payroll.compensation.pending');
  });

  it('labels a leave line by its type and rate, not by an attendance source', () => {
    expect(code).toContain('payroll.compensation.leaveAtRate');
    expect(code).toContain("l.origin === 'leaveSnapshot'");
  });

  it('reports the leave days even when they produced no deduction', () => {
    expect(code).toContain('payroll.compensation.leaveFacts');
    expect(code).toContain('effects.leave');
  });

  it('shows the run stamp for leave and the freeze stamp for attendance separately', () => {
    expect(code).toContain('payroll.compensation.leaveSnapshotAt');
    expect(code).toContain('payroll.compensation.frozenAt');
  });

  // The card still computes nothing. Every figure on it arrives priced.
  it('does no arithmetic of its own on a leave figure', () => {
    for (const forbidden of ['payRate /', '/ 100', 'daysInPeriod *', '* basicSalary']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the leave sentences carry their placeholders in both locales', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`keeps every one — ${locale}`, () => {
      expect(translate(locale, 'payroll.compensation.leaveFacts')).toContain('{days}');
      expect(translate(locale, 'payroll.compensation.leaveFacts')).toContain('{paid}');
      expect(translate(locale, 'payroll.compensation.leaveFacts')).toContain('{unpaid}');
      expect(translate(locale, 'payroll.compensation.leaveAtRate')).toContain('{rate}');
      expect(translate(locale, 'payroll.compensation.leaveAtRate')).toContain('{type}');
      expect(translate(locale, 'payroll.compensation.leaveSnapshotAt')).toContain('{at}');
    });
  }
});

describe('every label the card asks for resolves in both locales', () => {
  const literals = [
    ...new Set(
      [...CARD.matchAll(/\bt\(\s*'((?:payroll|common)\.[a-zA-Z0-9_.]+)'/g)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      ),
    ),
  ];
  // Rendered through a template key, so the literal scan above cannot see them.
  const templated = COMPENSATION_WARNINGS.map((w) => `payroll.compensation.warning.${w}`);
  const keys = [...literals, ...templated].sort();

  it('finds the keys to check', () => {
    expect(keys.length).toBeGreaterThan(12);
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`resolves all of them — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }

  it('does not ship English text as the Arabic label', () => {
    expect(keys.filter((key) => translate('ar', key) === translate('en', key))).toEqual([]);
  });

  it('keeps the placeholders of the employed-days sentence in both locales', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      const sentence = translate(locale, 'payroll.compensation.employed');
      expect(sentence, locale).toContain('{days}');
      expect(sentence, locale).toContain('{of}');
    }
  });
});

// ── PY-4 — the quantity surface ─────────────────────────────────────────────

const CATALOG = readFileSync(resolve(HERE, 'pages/PayItemsPage.tsx'), 'utf8');

describe('the catalog asks what a quantity item counts', () => {
  it('offers a source picker driven by the unit tables, not a hand-written list', () => {
    expect(CATALOG).toContain('CALC_BASIS_UNITS[calcBasis]');
    expect(CATALOG).toContain('QUANTITY_SOURCE_UNITS[source] === neededUnit');
    expect(CATALOG).toContain("'payroll.payItems.quantitySource'");
  });

  it('will not let a per-day item be created without one', () => {
    expect(CATALOG).toContain("neededUnit !== null && quantitySource === ''");
  });

  it('clears the source when the basis changes, so a stale unit cannot be submitted', () => {
    expect(CATALOG).toMatch(/setCalcBasis\([^)]*\);\s*\n\s*setQuantitySource\(''\)/);
  });

  it('shows it read-only on an existing item — the meaning is set once', () => {
    expect(CATALOG).toContain("t('payroll.payItems.immutable')");
    expect(stripComments(CATALOG)).not.toMatch(/UpdatePayItem[^;]*quantitySource/);
  });
});

describe('the card shows what was counted', () => {
  it('renders the quantity, its unit and its source', () => {
    expect(CARD).toContain("'payroll.compensation.quantity'");
    expect(CARD).toContain('payroll.compensation.unit.');
    expect(CARD).toContain('payroll.quantitySource.');
  });

  // The rule the phase turns on, asserted where a reader would look for it.
  it('shows the frozen stamp, so a figure can name the truth it priced', () => {
    expect(CARD).toContain('feedFrozenAt');
    expect(CARD).toContain("'payroll.compensation.frozenAt'");
  });

  it('still shows nothing about a payroll run, a payslip or a statutory rule', () => {
    expect(stripComments(CARD)).not.toMatch(
      /\btax\b|taxable|insurance|contribution|payslip|payrollRun/i,
    );
  });
});

describe('every quantity label resolves in both locales', () => {
  const keys = [
    ...PAY_ITEM_QUANTITY_SOURCES.map((s) => `payroll.quantitySource.${s}`),
    'payroll.compensation.quantity',
    'payroll.compensation.unit.days',
    'payroll.compensation.unit.minutes',
    'payroll.compensation.frozenAt',
    'payroll.payItems.quantitySource',
    'payroll.payItems.quantitySourceHint',
    'payroll.payItems.pickQuantitySource',
  ];

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`resolves all of them — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }

  it('does not ship English text as the Arabic label', () => {
    expect(keys.filter((key) => translate('ar', key) === translate('en', key))).toEqual([]);
  });

  it('keeps the placeholder of the frozen-stamp sentence in both locales', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      expect(translate(locale, 'payroll.compensation.frozenAt'), locale).toContain('{at}');
    }
  });
});

// ── PY-6 — the payroll run screen ───────────────────────────────────────────

const RUNS = readFileSync(resolve(HERE, 'pages/PayrollRunsPage.tsx'), 'utf8');
const ROUTES = readFileSync(resolve(HERE, 'routes.tsx'), 'utf8');

describe('the payroll run screen', () => {
  it('is routed, and behind the view key', () => {
    expect([...ROUTES.matchAll(/path="([^"*]+)"/g)].map((m) => m[1])).toEqual(['pay-items', 'runs']);
    expect(ROUTES).toContain('<RequirePermission permission="payrollRun.view">');
  });

  it('gates every action behind the manage key, not the view one', () => {
    const gated = [...RUNS.matchAll(/permission="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(gated)).toEqual(new Set(['payrollRun.manage']));
  });

  // Freezing cannot be undone anywhere in this system, so the screen has to say so before it
  // happens — not after, and not only in a tooltip.
  it('warns in words before the irreversible act', () => {
    expect(RUNS).toContain("'payroll.runs.freezeWarning'");
    expect(translate('en', 'payroll.runs.freezeWarning')).toMatch(/cannot be undone/i);
    expect(translate('ar', 'payroll.runs.freezeWarning')).toContain('لا رجعة');
  });

  it('shows the receipt — a "frozen" with no numbers behind it is just a word', () => {
    expect(RUNS).toContain('r.attendanceFrozenRows');
    expect(RUNS).toContain('r.leaveSnapshotRows');
  });

  it('says that cancelling does not unfreeze', () => {
    expect(RUNS).toContain("'payroll.runs.cancelFrozenHint'");
    expect(translate('en', 'payroll.runs.cancelFrozenHint')).toMatch(/stays frozen/i);
  });

  // A run pins facts; it prices nothing. No total, no payslip, no statutory control.
  it('shows no figure, no payslip and no statutory control', () => {
    expect(stripComments(RUNS)).not.toMatch(
      /\btax\b|insurance|contribution|payslip|formatMoney|netPay|grossPay/i,
    );
  });

  it('renders the period LTR without forcing the page direction', () => {
    expect(RUNS).toMatch(/dir="ltr"/);
    expect(RUNS).not.toMatch(/dir="rtl"|direction:\s*rtl/);
  });
});

describe('every run label resolves in both locales', () => {
  const keys = [
    ...new Set(
      [...RUNS.matchAll(/\bt\(\s*'((?:payroll|common)\.[a-zA-Z0-9_.]+)'/g)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      ),
    ),
    ...PAYROLL_RUN_STATUSES.map((s) => `payroll.runs.status.${s}`),
  ];

  it('finds the keys to check', () => {
    expect(keys.length).toBeGreaterThan(15);
  });

  for (const locale of ['en', 'ar'] as Locale[]) {
    it(`resolves all of them — ${locale}`, () => {
      expect(keys.filter((key) => translate(locale, key) === key)).toEqual([]);
    });
  }

  it('does not ship English text as the Arabic label', () => {
    expect(keys.filter((key) => translate('ar', key) === translate('en', key))).toEqual([]);
  });

  it('keeps the placeholders of the templated sentences in both locales', () => {
    for (const locale of ['en', 'ar'] as Locale[]) {
      expect(translate(locale, 'payroll.runs.freezeTitle'), locale).toContain('{period}');
      expect(translate(locale, 'payroll.runs.cancelTitle'), locale).toContain('{period}');
      expect(translate(locale, 'payroll.runs.attendanceRows'), locale).toContain('{rows}');
      expect(translate(locale, 'payroll.runs.leaveRows'), locale).toContain('{rows}');
    }
  });
});
