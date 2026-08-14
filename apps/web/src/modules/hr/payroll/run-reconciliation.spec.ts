// P-HR-15-A on the screen — and the reports half staying blocked.
//
// WHAT THIS TRACK IS. The reconciliation shipped as an API with no user interface. Showing it
// decides nothing new: the endpoint, its permission, its audience and its columns were all merged
// already, and this surface renders that DTO where a month is actually settled.
//
// WHAT IT MUST NOT BECOME, and what these guards are really for: the moment a screen exists,
// "while we are here" turns it into a report — a column somebody thought sensible, a total across
// currencies, a grouping nobody asked for, an export button. Each of those is a REQUIREMENT, none
// of them has been given, and a report built on a guess is worse than none because people act on it.
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

const PANEL = stripComments(read('./components/RunReconciliation.tsx'));
const RUNS_PAGE = stripComments(read('./pages/PayrollRunsPage.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const QUERIES = stripComments(read('./api/payroll-queries.ts'));
const ROUTES = stripComments(read('./routes.tsx'));

describe('it renders the endpoint that already shipped', () => {
  it('reads the merged route, and adds no query parameter of its own', () => {
    expect(API).toContain('`/hr/payroll/runs/${runId}/reconciliation`');
    // No period selector, no grouping, no filter — every one of those would be a definition.
    expect(API).not.toMatch(/reconciliation\$\{buildQuery/);
  });

  it('and states every part of the DTO rather than a chosen subset', () => {
    for (const field of ['totals', 'coverage', 'adjustments']) {
      expect(PANEL, field).toContain(`data.${field}`);
    }
    for (const figure of ['netMinor', 'totalEarningsMinor', 'totalDeductionsMinor']) {
      expect(PANEL, figure).toContain(figure);
    }
    for (const figure of ['approvedMinor', 'onPayslipsMinor', 'differenceMinor']) {
      expect(PANEL, figure).toContain(figure);
    }
  });

  it('is refetched when payslips are issued, because that changes every figure in it', () => {
    const issuing = QUERIES.slice(
      QUERIES.indexOf('export const useGeneratePayslips'),
      QUERIES.indexOf('export const useMyPayslips'),
    );
    expect(issuing).toContain('RECONCILIATION_FEATURE');
  });
});

describe('it defines nothing — the reports half stays blocked', () => {
  it('adds no page and no permission: it lives inside a dialog that is already gated', () => {
    expect(RUNS_PAGE).toContain('<RunReconciliation runId={run.id} />');
    expect(PANEL).not.toContain("can('");
    expect(PANEL).not.toContain('useCan');
    expect(PANEL).not.toContain('RequirePermission');
    expect(ROUTES).not.toContain('reconciliation');
  });

  /** PY-12 is closed by decision, and a "report" with a download button is how it reopens. */
  it('offers no document — no export, no PDF, no CSV, no print', () => {
    // The module keyword is stripped first: `export const RunReconciliation` is how the file is
    // declared, and matching it would make this guard permanently red for the wrong reason.
    const lower = PANEL.replace(/\bexport (const|default|function|type|interface|\{)/g, '')
      .toLowerCase();
    for (const word of ['pdf', 'csv', 'export', 'download', 'print(', 'window.open', 'blob']) {
      expect(lower, word).not.toContain(word);
    }
  });

  /**
   * The defect this most easily becomes. The engine refuses a mixed-currency employee, but nothing
   * says two employees share a currency — so one summed number across currencies would be wrong in
   * a way that looks tidy.
   */
  it('never collapses currencies into one number', () => {
    expect(PANEL).toContain('data.totals.map');
    expect(PANEL).toContain('row.currency');
    expect(PANEL).not.toContain('reduce(');
  });

  /** It restates figures. Deriving one could disagree with the payslip it is reconciling. */
  it('does no arithmetic of its own, and converts through the shared helper', () => {
    expect(PANEL).toContain('fromMinorUnits(minor)');
    expect(PANEL).not.toContain('/ 100');
    for (const operator of [' * ', ' - ', ' + ', 'Math.']) {
      expect(PANEL, operator).not.toContain(operator);
    }
  });

  it('and is a read: no mutation, no run transition', () => {
    for (const word of ['useMutation', '.mutate(', 'useFreeze', 'useApprove', 'usePay']) {
      expect(PANEL, word).not.toContain(word);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'payroll.reconciliation.title',
    'payroll.reconciliation.hint',
    'payroll.reconciliation.nothingIssued',
    'payroll.reconciliation.coverage',
    'payroll.reconciliation.difference',
    'payroll.reconciliation.differenceHint',
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

  /** A difference is a fact, not a failure — so no string here calls it one. */
  it('and never calls a difference an error', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      const text = `${translate(locale, 'payroll.reconciliation.difference')} ${translate(
        locale,
        'payroll.reconciliation.differenceHint',
      )}`.toLowerCase();
      for (const word of ['error', 'wrong', 'invalid', 'خطأ', 'خاطئ']) {
        expect(text, `${locale}:${word}`).not.toContain(word);
      }
    }
  });
});
