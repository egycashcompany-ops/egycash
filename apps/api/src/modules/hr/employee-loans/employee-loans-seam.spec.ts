// Where employee loans stop, and where payroll stops (P-HR-05).
//
// Several of the owner's frozen decisions are constraints on what may NOT appear in the code, and
// a constraint nobody can see is a constraint that lasts until the first deadline:
//
//   D4  — no ceiling. Not a constant, not a setting, not a percentage anybody invented.
//   D10 — no interest, no fee, no penalty. A loan is its principal.
//   the boundary — payroll reaches lending through ONE door, and the compensation engine learns
//   nothing about the debt behind a line: not its balance, not its schedule, not its status.
//
// Phase A's version of this file said "no payroll at all", which was true then and is the reason
// phase B had to come back here rather than write a second guard somewhere else. What replaced it
// is not weaker: "there is no door" became "there is exactly one door, and it is this file",
// which is the assertion that still has work to do now that the door exists.
//
// These assertions read the SOURCES, because "this side does not know about that side" is a
// property of the files rather than of any single case.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '../payroll');
const HR_MODULE = resolve(HERE, '../hr.module.ts');
const CONTRACT = resolve(HERE, '../../../../../../packages/contracts/src/modules/hr-employee-loans.ts');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — these files explain the rules in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const loanFiles = sources(HERE);
const rel = (file: string): string => file.slice(HERE.length + 1);

describe('the feature exists and is reached from one place', () => {
  it('ships the files phase A is made of', () => {
    expect(loanFiles.length).toBeGreaterThan(8);
  });

  // The models are the feature's own. Nothing outside it opens the collections directly — a rule
  // that matters most in phase B, when payroll will want to, and will have to use a port.
  it('the collections are reached from the loans feature alone', () => {
    for (const model of ['EmployeeLoanModel', 'LoanInstallmentModel']) {
      const readers = [...loanFiles, ...sources(PAYROLL)].filter((file) =>
        code(file).includes(model),
      );
      expect(readers.every((file) => file.startsWith(HERE)), model).toBe(true);
    }
  });

  /**
   * The one question loans asks payroll, asked through one file.
   *
   * `periodRange` and `frozenPeriods()` are both about the CALENDAR — what days a month has, and
   * which months have been closed. Everything else about payroll is out of reach, which is what
   * makes "how much does this feature know about pay?" a one-file answer.
   */
  it('and payroll is reached only through the period port', () => {
    const readers = loanFiles.filter((file) => code(file).includes("from '../payroll/"));
    expect(readers.map(rel).sort()).toEqual(
      ['payroll-period.port.ts', 'employee-loan.service.ts'].sort(),
    );
    // The service's single payroll import is the pure employment-span reader shared with PY-3 —
    // the same rule about who was employed when, not a second copy of it.
    expect(code(resolve(HERE, 'employee-loan.service.ts'))).toContain(
      "from '../payroll/compensation/employment-spans'",
    );
  });
});

describe('exactly one door between lending and pay (P-HR-05-B)', () => {
  const payrollFiles = sources(PAYROLL);
  const relPayroll = (file: string): string => file.slice(PAYROLL.length + 1);

  /**
   * THE assertion of this phase. Payroll may reach the loans feature from ONE file, and that file
   * is the port. Stated over the imports rather than over a naming convention, because a
   * convenient import inside a service is exactly how a boundary stops existing.
   */
  it('payroll imports the loans feature from the port and nowhere else', () => {
    const readers = payrollFiles.filter((file) => code(file).includes("from '../../employee-loans'"));
    expect(readers.map(relPayroll)).toEqual(['compensation/loan-installment.port.ts']);
  });

  // …and in the other direction: nothing in payroll opens a loan collection itself.
  it('and opens none of its collections directly', () => {
    for (const model of ['EmployeeLoanModel', 'LoanInstallmentModel', 'LoanRepaymentModel']) {
      const readers = payrollFiles.filter((file) => code(file).includes(model));
      expect(readers.map(relPayroll), model).toEqual([]);
    }
  });

  /**
   * The engine takes an amount and a sentence, and that is the whole of what it knows.
   *
   * It stamps `origin: 'loanInstallment'` — the owner's decision, and what lets a reader tell the
   * line apart — but a repayment PLAN must not live here: no balance, no schedule, no count, no
   * status. Each of those words would mean the engine had started deciding something that belongs
   * to the loan.
   */
  it('the pure engine learns nothing about the debt behind a line', () => {
    const rules = code(resolve(PAYROLL, 'compensation/compensation-rules.ts'));
    expect(rules).toContain("origin: 'loanInstallment'");
    for (const word of [
      'remaining',
      'schedule',
      'principal',
      'installmentCount',
      'repayment',
      'outstandingAtExit',
      "'planned'",
      "'deducted'",
    ]) {
      expect(rules, word).not.toContain(word);
    }
  });

  // The line vocabulary is a closed list, and this phase adds exactly one value to it.
  it('and the line origins gained one value, not a category', () => {
    const contracts = readFileSync(
      resolve(HERE, '../../../../../../packages/contracts/src/modules/hr-payroll.ts'),
      'utf8',
    );
    expect(contracts).toMatch(
      /COMPENSATION_LINE_ORIGINS = \[\s*'payItem',\s*'leaveSnapshot',\s*'adjustment',\s*'loanInstallment',\s*\] as const;/,
    );
  });

  /**
   * The loans side, from the same angle: it may know what a period is, and nothing about the
   * documents payroll writes. A run and a payslip are cited by ID through the port — which is the
   * point of citing them by ID.
   */
  it('and the loans feature names no payroll document', () => {
    for (const file of loanFiles) {
      const source = code(file);
      for (const word of ['PayslipModel', 'PayrollRunModel', 'computeCompensation', 'CompensationLineDto']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });
});

describe('an instalment becomes a fact only when a payslip takes it', () => {
  it('the vocabulary gained `deducted`, and the code that sets it', () => {
    expect(code(CONTRACT)).toContain(
      "export const LOAN_INSTALLMENT_STATUSES = ['planned', 'deducted', 'cancelled'] as const;",
    );
    const service = code(resolve(HERE, 'employee-loan.service.ts'));
    expect(service).toContain("status: 'deducted'");
    // Only from the recording path: nothing else in the feature may declare money taken.
    const setters = loanFiles.filter((file) => code(file).includes("status: 'deducted'"));
    expect(setters.map(rel)).toEqual(['employee-loan.service.ts']);
  });

  /**
   * D8 consumes the EXISTING exit event; no loan event was invented, and payroll emits none.
   *
   * The handler is registered in the HR manifest rather than here, which is where every other
   * module's subscription lives — so this asserts both halves: the feature emits nothing, and the
   * manifest wires the one event it listens to.
   */
  it('emits no event, and subscribes only to the exit that already existed', () => {
    for (const file of loanFiles) {
      expect(code(file), rel(file)).not.toContain('emit(');
    }
    const manifest = code(HR_MODULE);
    expect(manifest).toContain("handlerId: 'loans.exitSettlement'");
    expect(manifest).toContain('employeeLoanService.onEmployeeExited');
    // The event is the one Leave and Attendance already consume, not a new one beside it.
    expect(manifest).toContain("event: 'hr.employee.exited'");
  });

  // P-HR-04 is untouched: a bonus and a debt are different ledgers, and one phase may not quietly
  // become the other.
  it('and nothing here reaches the adjustments collection', () => {
    for (const file of loanFiles) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('PayrollAdjustmentModel');
      expect(source, rel(file)).not.toContain('hr_payroll_adjustments');
    }
  });
});

describe('no ceiling, no interest, no fee (D4, D10)', () => {
  it('the feature names no cap and no setting', () => {
    for (const file of [...loanFiles, CONTRACT]) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('maxAmount');
      expect(source, rel(file)).not.toContain('MAX_LOAN');
      expect(source, rel(file)).not.toContain('SettingKeys');
    }
  });

  it('and no rate, interest or fee of any kind', () => {
    for (const file of [...loanFiles, CONTRACT]) {
      const source = code(file).toLowerCase();
      for (const word of ['interest', 'apr', 'fee', 'penalty']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  // PY-10's rule, restated for the files this phase adds: the legacy list pays nobody, here either.
  it('and never reads employment.allowances', () => {
    for (const file of loanFiles) {
      expect(code(file), rel(file)).not.toContain('employment.allowances');
    }
  });
});

describe('the permission split is declared, and nothing else is', () => {
  const manifest = code(HR_MODULE);

  /**
   * THREE keys — and this assertion is about the three, not about how many surfaces they have.
   *
   * Phase A pinned `null,` here, and that was the honest reading at the time: the only surface was
   * a tab on the employee profile. P-HR-06-B built `/payroll/employee-loans`, so the page id is now
   * that page — a change of ADDRESS, not of authority. What this guard exists to catch is unchanged
   * and is asserted below: a fourth key appearing without a phase behind it.
   */
  it('declares view, create and approve — and names the page it is administered from', () => {
    const declaration = manifest.slice(
      manifest.indexOf("declarePermissions(\n  'hr',\n  'employeeLoan'"),
    );
    expect(declaration.length).toBeGreaterThan(0);
    const block = declaration.slice(0, declaration.indexOf(');') + 2);
    expect(block).toContain("['view', 'create']");
    expect(block).toContain("action: 'approve'");
    expect(block).toContain("'hr.employee-loans',");
    // …and the page it names is really declared, so the id cannot point at nothing.
    expect(manifest).toContain("id: 'hr.employee-loans'");
    expect(manifest).toContain("route: '/payroll/employee-loans'");
    // Still three. Deleting a loan, exporting one or printing one are not acts this feature has.
    for (const action of ["'delete'", "'export'", "'print'"]) {
      expect(block, action).not.toContain(action);
    }
  });

  it('and both collections are registered', () => {
    expect(manifest).toContain("'hr_employee_loans'");
    expect(manifest).toContain("'hr_loan_installments'");
  });
});
