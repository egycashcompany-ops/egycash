// Structural invariants of My Adjustments (P-HR-19).
//
// The screen exists because P-HR-07's decision notice addresses the employee's own login — "the
// adjustment for {{period}} is now: approved" — and pointed at nothing they could open. Between
// that notice and the payslip that eventually carries the line, there was a window in which
// somebody had been told about their own money and could see none of it.
//
// What must hold is short, and every item is invisible at runtime: it asks for the CALLER, it
// carries no permission, it offers no action, and it says out loud that drafts are not shown —
// because an absence nobody explains reads as a bug.
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

const PAGE = stripComments(read('./pages/MyAdjustmentsPage.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const ROUTES = stripComments(read('./routes.tsx'));

describe('it answers for the caller, and for nobody else', () => {
  it('asks the server for `me`, never for an employee id', () => {
    expect(API).toContain('`/hr/payroll/adjustments/me${buildQuery(params)}`');
    // Bounded to this function: other reads in the same file legitimately take an employee id,
    // and an unbounded slice would pick one of them up and fail for the wrong reason.
    const from = API.indexOf('export const listMyAdjustments');
    const next = API.indexOf('export const', from + 1);
    const call = API.slice(from, next === -1 ? undefined : next);
    expect(call).toContain('/hr/payroll/adjustments/me');
    expect(call).not.toContain('employeeId');
  });

  it('and is routed without a permission, like My Payslips and My Loans beside it', () => {
    expect(ROUTES).toContain('<Route path="adjustments/me" element={<MyAdjustmentsPage />} />');
    const at = ROUTES.indexOf('path="adjustments/me"');
    expect(ROUTES.slice(Math.max(0, at - 200), at)).not.toContain('RequirePermission');
  });

  it('and declares no permission check of its own', () => {
    expect(PAGE).not.toContain("can('");
    expect(PAGE).not.toContain('useCan');
    expect(PAGE).not.toContain('RequirePermission');
  });
});

describe('it reads, and offers nothing to do', () => {
  /**
   * D1 is a two-person rule: `payrollAdjustment.create` records and `payrollAdjustment.approve`
   * decides. Neither is the employee's, so a button here — even one that only opened a dialog —
   * would suggest a path that does not exist for them.
   */
  it('has no mutation, no dialog and no form', () => {
    for (const word of ['useMutation', '.mutate(', '<Dialog', '<Textarea', 'onSubmit']) {
      expect(PAGE, word).not.toContain(word);
    }
  });

  it('and offers no export, print or document', () => {
    const lower = PAGE.toLowerCase();
    for (const word of ['pdf', 'csv', 'download', 'print(']) {
      expect(lower, word).not.toContain(word);
    }
  });

  it('and computes nothing of its own', () => {
    for (const operator of [' * ', ' / ', ' % ', 'Math.', 'reduce(']) {
      expect(PAGE, operator).not.toContain(operator);
    }
  });
});

describe('the absence of drafts is explained, not just enforced', () => {
  /**
   * The server excludes drafts; this screen SAYS so. An employee who knows a bonus was being
   * discussed and sees an empty table would otherwise read the silence as a fault — and the honest
   * answer is that a draft is not yet a decision about them.
   */
  it('tells the reader why an entry may not be here yet', () => {
    expect(PAGE).toContain("t('payroll.adjustments.mine.hint')");
    for (const locale of ['ar', 'en'] as Locale[]) {
      expect(translate(locale, 'payroll.adjustments.mine.hint').length).toBeGreaterThan(20);
    }
  });

  /** …and the screen does not filter on its own — a client-side filter is not an API guarantee. */
  it('and does not filter drafts in the browser', () => {
    expect(PAGE).not.toContain("!== 'draft'");
    expect(PAGE).not.toContain('.filter(');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'payroll.adjustments.mine.title',
    'payroll.adjustments.mine.subtitle',
    'payroll.adjustments.mine.hint',
    'payroll.adjustments.mine.empty',
    'payroll.adjustments.decidedAt',
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
