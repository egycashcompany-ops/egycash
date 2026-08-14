// Structural invariants of the employee's Payslips tab (P-HR-20).
//
// The tab exists because `ListPayslipsQuery` has carried an `employeeId` filter since PY-7 that
// only the RUN's list applied — and inside one run an employee has at most one payslip, so the
// filter answered nothing worth asking. The profile showed the INPUTS to somebody's pay (items,
// adjustments, loans, and for a leaver the settlement) and never the documents themselves.
//
// What must hold: it is behind the compensation answer like every money tab, it recomputes
// nothing, and it does not reopen PY-12 by growing a print button.
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

const TAB = stripComments(read('./components/EmployeePayslipsTab.tsx'));
const API = stripComments(read('./api/payroll-api.ts'));
const PROFILE = stripComments(
  read('../employee-management/employees/pages/EmployeeProfilePage.tsx'),
);

describe('wired into the profile the way every additive tab is', () => {
  it('is registered as a tab and lazy-loaded', () => {
    expect(PROFILE).toMatch(/const TABS = \[[^\]]*'payslips'/);
    expect(PROFILE).toContain(
      "lazy(\n  () => import('../../../payroll/components/EmployeePayslipsTab'),\n)",
    );
    expect(TAB).toMatch(/export default EmployeePayslipsTab;/);
  });

  /**
   * The same gate as the three money tabs beside it, and for the same reason: reading what
   * somebody was paid is reading their pay. It adds no key of its own.
   */
  it('appears only when the server says compensation is visible', () => {
    expect(PROFILE).toContain("{tab === 'payslips' && e.compensationVisible && (");
    expect(TAB).not.toContain("can('");
    expect(TAB).not.toContain('useCan');
  });

  it('and reads through the employee-scoped endpoint', () => {
    expect(API).toContain('`/hr/employees/${employeeId}/payslips${buildQuery(params)}`');
  });
});

describe('it shows the stored document, and recomputes nothing', () => {
  /**
   * A payslip is a deliberate copy of what somebody was paid. A screen that recalculated it could
   * disagree with the paper the employee was handed — and then neither would be authoritative.
   */
  it('does no arithmetic of its own', () => {
    for (const operator of [' * ', ' / ', ' % ', 'Math.', 'reduce(']) {
      expect(TAB, operator).not.toContain(operator);
    }
  });

  it('and reads the totals the payslip stored', () => {
    expect(TAB).toContain('s.totalEarnings');
    expect(TAB).toContain('s.totalDeductions');
    expect(TAB).toContain('s.net');
  });

  /** PY-5's rule, kept: a line with no figure says so rather than showing a zero. */
  it('and renders a pending line as pending rather than as zero', () => {
    expect(TAB).toContain('line.amount === null');
    expect(TAB).toContain("t('payroll.compensation.pending')");
  });
});

describe('it is a read, and PY-12 stays closed', () => {
  it('has no mutation, and issues nothing', () => {
    for (const word of ['useMutation', '.mutate(', 'generatePayslips', 'useGeneratePayslips']) {
      expect(TAB, word).not.toContain(word);
    }
  });

  /** No print, no PDF, no export — the decision that closed PY-12 is not reopened by a tab. */
  it('and offers no document of any kind', () => {
    const lower = TAB.toLowerCase();
    for (const word of ['pdf', 'csv', 'download', 'print(', 'window.open']) {
      expect(lower, word).not.toContain(word);
    }
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'employees.tabs.payslips',
    'payroll.payslips.issuedAt',
    'payroll.payslips.noneForEmployee',
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
