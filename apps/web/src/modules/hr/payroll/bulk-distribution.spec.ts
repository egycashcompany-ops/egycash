// P-HR-13 on the screen — a distribution, and the boundary that keeps it one.
//
// The amounts are decided outside this system and typed in. So the guards below are mostly about
// what this screen must NOT grow: a field that computes an amount, a way to skip the second
// person, a currency the user can disagree with the server about, or a batch spanning two months.
//
// The subtle one is the currency. The server derives it from each employee's own basic salary
// because the engine refuses anything else — so an editable currency box would not be a feature,
// it would be a way to author a refusal.
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

const DIALOG = stripComments(read('./components/BulkDistributionDialog.tsx'));
const PAGE = stripComments(read('./pages/PayrollAdjustmentsPage.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const QUERIES = stripComments(read('./api/payroll-queries.ts'));
const ROUTES = stripComments(read('./routes.tsx'));

describe('the amounts are entered, never computed', () => {
  it('the screen carries no calculation vocabulary', () => {
    const lower = DIALOG.toLowerCase();
    for (const word of ['pool', 'formula', 'percent', 'ratio', 'eligib', 'tenure', 'prorat', 'split(']) {
      expect(lower, word).not.toContain(word);
    }
  });

  it('and does no arithmetic on what was typed', () => {
    // `Number(row.amount)` is a parse, not a calculation. An operator would be a rule about money.
    for (const operator of [' * ', ' / ', ' % ', 'Math.', 'reduce(']) {
      expect(DIALOG, operator).not.toContain(operator);
    }
  });
});

describe('one month, one pay item, and a currency nobody types', () => {
  it('the period and the pay item are batch-level state, not per row', () => {
    expect(DIALOG).toContain('const [period, setPeriod]');
    expect(DIALOG).toContain('const [payItemId, setPayItemId]');
    // A row carries only the three things that vary per person.
    expect(DIALOG).toMatch(/interface DraftRow \{[^}]*employee[^}]*amount[^}]*reason[^}]*\}/s);
    expect(DIALOG).not.toMatch(/interface DraftRow \{[^}]*period[^}]*\}/s);
    expect(DIALOG).not.toMatch(/interface DraftRow \{[^}]*currency[^}]*\}/s);
  });

  it('the currency is displayed from the employee and never edited', () => {
    expect(DIALOG).toContain('row.employee.employment.salary?.currency');
    // No input bound to a currency, and none sent in the request body.
    expect(DIALOG).not.toMatch(/setCurrency/);
    const body = DIALOG.slice(DIALOG.indexOf('submit.mutate('), DIALOG.indexOf('onSuccess'));
    expect(body).toContain('employeeId');
    expect(body).toContain('amount');
    expect(body).toContain('reason');
    expect(body).not.toContain('currency');
    expect(body).not.toContain('kind');
  });

  it('and only an active earning item is offered — a deduction would only be refused', () => {
    expect(DIALOG).toContain("kind: 'earning'");
    expect(DIALOG).toContain("status: 'active'");
  });
});

describe('the second person is untouched', () => {
  it('the screen never approves, decides or submits', () => {
    for (const word of ['useDecide', 'decideAdjustment', 'submitAdjustment', "'approved'"]) {
      expect(DIALOG, word).not.toContain(word);
    }
  });

  it('and the entry point is behind the key that already records one adjustment', () => {
    expect(PAGE).toContain("can('payrollAdjustment.create')");
    expect(PAGE).toContain('<BulkDistributionDialog');
    expect(PAGE).not.toContain('payrollAdjustment.bulk');
  });
});

describe('it rides the existing surface', () => {
  it('adds no page and no route', () => {
    expect(ROUTES).not.toContain('bulk');
    expect(ROUTES).not.toContain('distribution');
  });

  it('and posts to the organization-wide bulk endpoint', () => {
    expect(API).toContain("post<BulkCreatePayrollAdjustmentsResultDto>('/hr/payroll/adjustments/bulk'");
  });

  /** A batch writes rows belonging to many employees, so both lists are stale afterwards. */
  it('and invalidates both adjustment lists', () => {
    const hook = QUERIES.slice(
      QUERIES.indexOf('export const useBulkCreateAdjustments'),
      QUERIES.indexOf('export const useDecideAdjustmentFromQueue'),
    );
    expect(hook).toContain('ORG_ADJUSTMENTS');
    expect(hook).toContain('ADJUSTMENTS');
  });

  it('and offers no document', () => {
    const lower = DIALOG.replace(/\bexport (const|default|interface|type)/g, '').toLowerCase();
    for (const word of ['pdf', 'csv', 'export', 'download', 'upload']) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe('the outcome of a batch is shown in full', () => {
  it('reports created, duplicates and every refusal with its reason', () => {
    expect(DIALOG).toContain('result.created');
    expect(DIALOG).toContain('result.duplicates');
    expect(DIALOG).toContain('result.rejected');
    expect(DIALOG).toContain('row.reason');
    expect(DIALOG).toContain('row.employeeId');
    expect(DIALOG).toContain("t('payroll.bulk.rejectedRow'");
  });

  /** The rows are visible and editable before anything is sent — the review step. */
  it('and shows the rows for review before submitting', () => {
    expect(DIALOG).toContain('<DataTable');
    expect(DIALOG).toContain('disabled={!ready}');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'payroll.bulk.open',
    'payroll.bulk.title',
    'payroll.bulk.hint',
    'payroll.bulk.period',
    'payroll.bulk.payItem',
    'payroll.bulk.employee',
    'payroll.bulk.amount',
    'payroll.bulk.currency',
    'payroll.bulk.reason',
    'payroll.bulk.empty',
    'payroll.bulk.submit',
    'payroll.bulk.result',
    'payroll.bulk.rejectedRow',
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

  /** The hint must say where the amounts come from — it is the phase's whole boundary. */
  it('and the hint states that the amounts are decided outside the system', () => {
    expect(translate('en', 'payroll.bulk.hint').toLowerCase()).toContain('outside this system');
    expect(translate('ar', 'payroll.bulk.hint')).toContain('خارج هذا النظام');
    // …and that a second person still stands between the batch and any money.
    expect(translate('en', 'payroll.bulk.hint').toLowerCase()).toContain('draft');
    expect(translate('ar', 'payroll.bulk.hint')).toContain('مسودة');
  });
});
