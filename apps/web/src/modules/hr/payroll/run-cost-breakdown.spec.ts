// P-HR-14 / U14-1 on the screen — and the ledger staying unbuilt.
//
// The figures here are exactly the ones a journal would post, which is what makes the screen
// useful and also what makes it the most likely place for an accounting decision to appear without
// anybody making one. So these guards are mostly about words that must NOT be here, and about the
// two arithmetic mistakes this shape invites: netting earnings against deductions, and adding two
// currencies together.
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

const PANEL = stripComments(read('./components/RunCostBreakdown.tsx'));
const RUNS_PAGE = stripComments(read('./pages/PayrollRunsPage.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const QUERIES = stripComments(read('./api/payroll-queries.ts'));
const ROUTES = stripComments(read('./routes.tsx'));

describe('it renders the endpoint, and asks it nothing', () => {
  it('reads the run’s cost-breakdown route with no query parameter', () => {
    expect(API).toContain('`/hr/payroll/runs/${runId}/cost-breakdown`');
    // A grouping or a filter would be a report definition — P-HR-15's blocked half.
    expect(API).not.toMatch(/cost-breakdown\$\{buildQuery/);
  });

  it('and states all three splits rather than a chosen one', () => {
    for (const split of ['byOrigin', 'byPayItem', 'byBranch']) {
      expect(PANEL, split).toContain(`data.${split}`);
    }
  });

  it('and is refetched when payslips are issued, because that writes the very lines it groups', () => {
    const issuing = QUERIES.slice(
      QUERIES.indexOf('export const useGeneratePayslips'),
      QUERIES.indexOf('export const useRunCostBreakdown'),
    );
    expect(issuing).toContain('COST_BREAKDOWN_FEATURE');
  });
});

describe('it names no account and posts nothing', () => {
  it('carries no accounting vocabulary', () => {
    const lower = PANEL.toLowerCase();
    for (const word of ['account', 'ledger', 'journal', 'posting', 'debit', 'credit', 'voucher']) {
      expect(lower, word).not.toContain(word);
    }
  });

  it('and neither do the strings it shows, in either locale', () => {
    const KEYS = [
      'payroll.cost.title',
      'payroll.cost.hint',
      'payroll.cost.byOrigin',
      'payroll.cost.byPayItem',
      'payroll.cost.byBranch',
    ];
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of KEYS) {
        const text = translate(locale, key).toLowerCase();
        for (const word of ['account', 'ledger', 'journal', 'حساب', 'قيد', 'دفتر']) {
          expect(text, `${locale}:${key}:${word}`).not.toContain(word);
        }
      }
    }
  });
});

describe('the arithmetic stays the server’s', () => {
  it('does none of its own, and converts through the shared helper', () => {
    expect(PANEL).toContain('fromMinorUnits(minor)');
    expect(PANEL).not.toContain('/ 100');
    for (const operator of [' * ', ' - ', ' + ', 'Math.', 'reduce(']) {
      expect(PANEL, operator).not.toContain(operator);
    }
  });

  /** Direction is what `kind` means; subtracting one from the other would be an accounting choice. */
  it('never nets earnings against deductions', () => {
    expect(PANEL).toContain('payroll.cost.kind.');
    expect(PANEL).not.toContain('net');
  });

  /** No exchange rate exists, so every row is printed with its own currency beside it. */
  it('and prints a currency on every row', () => {
    expect((PANEL.match(/row\.currency/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe('and nothing else was added', () => {
  it('no page and no permission — it lives in a dialog that is already gated', () => {
    expect(RUNS_PAGE).toContain('<RunCostBreakdown runId={run.id} />');
    expect(PANEL).not.toContain("can('");
    expect(PANEL).not.toContain('useCan');
    expect(PANEL).not.toContain('RequirePermission');
    expect(ROUTES).not.toContain('cost-breakdown');
  });

  it('and it is a read: no mutation, no run transition', () => {
    for (const word of ['useMutation', '.mutate(', 'useFreeze', 'useApprove', 'usePay']) {
      expect(PANEL, word).not.toContain(word);
    }
  });

  /** PY-12 stays closed, and "the figures a ledger needs" is exactly how it would reopen. */
  it('and offers no document', () => {
    const lower = PANEL.replace(/\bexport (const|default|function|type|interface)/g, '')
      .toLowerCase();
    for (const word of ['pdf', 'csv', 'export', 'download', 'print(', 'window.open']) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'payroll.cost.title',
    'payroll.cost.hint',
    'payroll.cost.nothingIssued',
    'payroll.cost.byOrigin',
    'payroll.cost.byPayItem',
    'payroll.cost.byBranch',
    'payroll.cost.noBranch',
    'payroll.cost.kind.earning',
    'payroll.cost.kind.deduction',
    'payroll.compensation.origin.payItem',
    'payroll.compensation.origin.leaveSnapshot',
    'payroll.compensation.origin.adjustment',
    'payroll.compensation.origin.loanInstallment',
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
