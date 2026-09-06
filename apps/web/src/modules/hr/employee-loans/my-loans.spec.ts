// Structural invariants of My Loans (P-HR-18).
//
// The screen exists because P-HR-07 told the employee twice — their request was decided, and the
// money was handed over with instalments beginning in a named month — and left them nowhere to
// look. So what must hold about it is a short list, and every item is invisible at runtime:
//
//   * it asks the server for THE CALLER, never for an employee id;
//   * it carries no permission, because there is no wider reach one could gate;
//   * it offers no action at all — requesting and deciding a loan are a two-person rule (D2) that
//     this screen must not appear to shortcut;
//   * and it shows the SCHEDULE, which is the whole question an employee repaying out of their
//     salary actually has.
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

const PAGE = stripComments(read('./pages/MyLoansPage.tsx'));
const API = stripComments(read('./api/employee-loans-api.ts'));
const ROUTES = stripComments(read('../payroll/routes.tsx'));

describe('it answers for the caller, and for nobody else', () => {
  /**
   * THE assertion. The endpoint resolves the employee from the login link server-side; a screen
   * that sent an id would be asking a different question, and one whose answer depends on what the
   * client chose to send.
   */
  it('asks the server for `me`, never for an employee id', () => {
    expect(API).toContain("`/hr/employee-loans/me${buildQuery(params)}`");
    const call = API.slice(API.indexOf('export const listMyLoans'));
    expect(call).not.toContain('employeeId');
  });

  /** No permission — a key here would gate a reach that does not exist. */
  it('and is routed without a permission, like My Payslips beside it', () => {
    expect(ROUTES).toContain('<Route path="employee-loans/me" element={<MyLoansPage />} />');
    // The guarded routes are named individually elsewhere; what matters here is that this one is
    // not wrapped, which is only legible as an absence.
    const at = ROUTES.indexOf('path="employee-loans/me"');
    const before = ROUTES.slice(Math.max(0, at - 200), at);
    expect(before).not.toContain('RequirePermission');
  });

  /**
   * The route stays open; the ASKING is what carries a key.
   *
   * This asserted that the page declared no permission check at all, on the reasoning that a
   * button here "would suggest a path that does not exist for them" — true while the only loan
   * keys anyone held were the decider's. An employee may now ask for their own loan
   * (`employeeLoan.create`, `own`-scoped), so the path exists and the screen may show it.
   *
   * What must NOT come back is a gate on the route or the reading: every employee reaches their
   * own loans, with or without the key to ask for another.
   */
  it('gates the ASK on employeeLoan.create, and gates nothing else', () => {
    expect(PAGE, 'the ask is the only thing behind a key').toContain("can('employeeLoan.create')");
    expect(PAGE, 'the page itself is not permission-gated').not.toContain('RequirePermission');
    // One key, checked once. A second `can(` here would be a second rule about the same screen.
    expect([...PAGE.matchAll(/can\('/g)]).toHaveLength(1);
  });
});

describe('it reads and it asks — it never decides', () => {
  /**
   * D2 is a two-person rule: `employeeLoan.create` proposes and `employeeLoan.approve` decides.
   * The employee holds the first and never the second, so this screen may offer the request and
   * must offer nothing beyond it.
   *
   * The form itself is not here — it is `RequestLoanDialog`, the same one HR fills in on the
   * employee's Loans tab, so the two paths cannot ask different questions. What this asserts is
   * that the page did not grow a second form of its own along the way.
   */
  it('has no mutation and no form of its own', () => {
    for (const word of ['useMutation', '.mutate(', '<Dialog', '<Input', '<Textarea', 'onSubmit']) {
      expect(PAGE, word).not.toContain(word);
    }
  });

  it('and calls none of the DECIDING endpoints this feature has', () => {
    // Everything that moves money or closes a request. `createLoan` is deliberately absent from
    // this list now — but it is absent from the page too, because the dialog owns the call.
    for (const word of ['submitLoan', 'decideLoan', 'disburseLoan', 'cancelLoan', 'accelerate']) {
      expect(PAGE, word).not.toContain(word);
    }
    expect(PAGE, 'the page delegates the write instead of making it').not.toContain('useCreateLoan');
  });

  /** No export either — PY-12 is closed, and a personal screen is not the place to reopen it. */
  it('and offers no export, print or document', () => {
    const lower = PAGE.toLowerCase();
    for (const word of ['pdf', 'csv', 'download', 'print(', 'iban', 'wps']) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe('it shows what the employee actually needs to know', () => {
  /** The schedule is the point: which months are affected, and how much each one takes. */
  it('shows the instalments, their months and their state', () => {
    expect(PAGE).toContain('open.installments');
    expect(PAGE).toContain('INSTALLMENT_TONE');
    expect(PAGE).toContain("t('loans.noSchedule')");
  });

  it('and what is still owed against what has been repaid', () => {
    expect(PAGE).toContain('l.remaining');
    expect(PAGE).toContain('l.repaid');
    expect(PAGE).toContain('l.principal');
  });

  /** Figures are quoted from the server; the browser adds nothing up. */
  it('and computes nothing of its own', () => {
    for (const operator of [' * ', ' / ', ' % ', 'Math.', 'reduce(']) {
      expect(PAGE, operator).not.toContain(operator);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'loans.mine.title',
    'loans.mine.subtitle',
    'loans.mine.empty',
    'loans.mine.schedule',
    'loans.mine.scheduleHint',
    'loans.mine.disbursedOn',
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
