// What a reconciliation may and may not be (P-HR-15-A).
//
// This phase is one half of P-HR-15. The other half — WHICH reports exist, for whom, with which
// columns — is a requirement nobody has given, and the risk this file exists to manage is that the
// blocked half arrives quietly through the buildable one: a "report" endpoint, an export button, a
// tax column, a total nobody can trace to a payslip.
//
// So the assertions are mostly about absence, and they are read from the SOURCES, because "this
// never happens" is a property of the files rather than of any single request.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — this feature explains itself at length, and prose must not satisfy a guard. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const featureFiles = sources(HERE);
const rel = (file: string): string => file.slice(HERE.length + 1);
const SERVICE = code(resolve(HERE, 'reconciliation.service.ts'));
const ROUTES = code(resolve(HERE, 'reconciliation.routes.ts'));

describe('it is a read, and adds nothing to the registry', () => {
  it('ships four files and no model, repository or mapper', () => {
    expect(featureFiles.map(rel).sort()).toEqual([
      'index.ts',
      'reconciliation.controller.ts',
      'reconciliation.routes.ts',
      'reconciliation.service.ts',
    ]);
  });

  it('exposes one GET and no mutating verb', () => {
    const verbs = [...ROUTES.matchAll(/router\.(get|post|patch|put|delete)\(/g)].map((m) => m[1]);
    expect(verbs).toEqual(['get']);
  });

  /** No key of its own: the sum is governed by the key that governs its terms. */
  it('and sits behind the compensation key, adding none', () => {
    const gates = [...ROUTES.matchAll(/authorize\('([^']+)'\)/g)].map((m) => m[1]);
    expect(gates).toEqual(['employee.viewCompensation']);
    const manifest = code(resolve(HERE, '../../hr.module.ts'));
    expect(manifest).not.toMatch(/declarePermissions\(\s*'hr',\s*'reconciliation'/);
    expect(manifest).not.toMatch(/declarePermissions\(\s*'hr',\s*'report'/);
    expect(manifest).toContain('buildReconciliationRouter()');
  });

  it('and writes nothing, stores nothing, publishes nothing', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const call of ['.create(', '.updateById(', '.save(', 'emit(', 'notificationsService']) {
        expect(source, `${rel(file)}: ${call}`).not.toContain(call);
      }
    }
  });
});

describe('the blocked half stays blocked', () => {
  /**
   * PY-12 is closed by decision. A reporting phase is exactly where a document would reappear —
   * "just a printable summary" — so the absence is asserted rather than intended.
   */
  it('produces no export, PDF, CSV or attachment', () => {
    for (const file of featureFiles) {
      const lower = code(file).toLowerCase();
      for (const word of ['pdf', 'csv', 'export(', 'attachment', 'content-disposition', 'stream']) {
        expect(lower, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  /** No statutory or accounting view: those are P-HR-12 and P-HR-14, blocked on their own rules. */
  it('and states no tax, insurance, GL or profit-share figure', () => {
    for (const file of featureFiles) {
      const lower = code(file).toLowerCase();
      for (const word of ['tax', 'socialinsurance', 'ledgeraccount', 'journal', 'profitshar']) {
        expect(lower, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });
});

describe('it sums; it does not compute', () => {
  /**
   * A reconciliation that re-derived a figure could disagree with the payslip it was reconciling,
   * and then neither would be authoritative. So the only arithmetic allowed is addition and
   * subtraction of stored minor units — no rate, no proration, no multiplication.
   */
  it('performs no multiplication, division or rounding', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const operator of [' * ', ' / ', ' % ', 'Math.round', 'Math.floor']) {
        expect(source, `${rel(file)}: ${operator}`).not.toContain(operator);
      }
    }
  });

  /** …and the engine is never called: a reconciliation reads documents, it does not price. */
  it('and never invokes the compensation engine', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const word of ['compensationService', 'computeCompensation', 'effectsFor']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  /**
   * ONE definition of "employed in this month". The coverage check reuses the pure function PY-7
   * issues from, so a gap it reports is the gap that batch left rather than a second opinion.
   */
  it('and reuses PY-7’s own population test', () => {
    expect(SERVICE).toContain('employedDuring(employmentSpansOf(employee), window)');
  });
});

describe('the loans seam is untouched (design §4)', () => {
  /**
   * The loan-repayment identity would be the most valuable check here, and it is deliberately
   * absent: payroll may not read the loan ledger, and widening the P-HR-05-B port is an
   * architectural decision rather than a reporting one.
   */
  it('names no loan collection anywhere in payroll', () => {
    for (const file of sources(PAYROLL)) {
      const source = code(file);
      for (const model of ['LoanRepaymentModel', 'LoanInstallmentModel', 'EmployeeLoanModel']) {
        expect(source, `${file.slice(PAYROLL.length + 1)}: ${model}`).not.toContain(model);
      }
    }
  });

  it('and this feature reaches the loans side not at all', () => {
    for (const file of featureFiles) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('employeeLoan');
      expect(source, rel(file)).not.toContain('loanInstallmentPort');
    }
  });
});

describe('currencies are never added together', () => {
  /**
   * The engine refuses a mixed-currency EMPLOYEE; nothing says two employees must share a currency.
   * A single total across currencies would be a defect wearing the costume of a summary, so both
   * aggregates group by it and the DTO carries a row per currency.
   */
  it('groups every total by currency', () => {
    const payslipRepo = code(resolve(PAYROLL, 'payslips/payslip.repository.ts'));
    expect(payslipRepo).toContain("$group: {\n          _id: '$currency',");
    const adjustmentRepo = code(resolve(PAYROLL, 'adjustments/payroll-adjustment.repository.ts'));
    expect(adjustmentRepo).toContain("$group: { _id: '$currency'");
    // …and nothing in the service collapses those rows into one.
    expect(SERVICE).not.toContain('grandTotal');
    expect(SERVICE).not.toMatch(/totals\.reduce\(/);
  });
});
