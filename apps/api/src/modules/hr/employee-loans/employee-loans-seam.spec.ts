// What phase A is, and everything it deliberately is not (P-HR-05).
//
// Three of the owner's frozen decisions are constraints on what may NOT appear in the code, and a
// constraint nobody can see is a constraint that lasts until the first deadline:
//
//   D4  — no ceiling. Not a constant, not a setting, not a percentage anybody invented.
//   D10 — no interest, no fee, no penalty. A loan is its principal.
//   §8  — no payroll integration AT ALL in phase A: no port into the engine, no compensation line,
//         no repayment ledger, and therefore no vocabulary for a deduction that cannot happen yet.
//
// These assertions read the SOURCES, because "this feature does not know about X" is a property of
// the files rather than of any single case. They are also the guard that phase B will have to
// widen rather than delete: when the payroll side arrives it arrives through one named door, and
// this file is where that door gets named.
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

describe('phase A adds nothing to payroll (§8)', () => {
  /**
   * The compensation engine must not learn that this feature exists. Naming a loan there would be
   * the whole boundary gone, and it is one convenient import wide.
   */
  it('the payroll module names no loan, instalment or repayment', () => {
    for (const file of sources(PAYROLL)) {
      const source = code(file).toLowerCase();
      for (const word of ['loan', 'installment', 'instalment', 'repayment']) {
        expect(source, `${file.slice(PAYROLL.length + 1)}: ${word}`).not.toContain(word);
      }
    }
  });

  // The line vocabulary is a closed list, and phase A adds no origin to it: there is no line.
  it('and the compensation line origins are still the three PY-5 and P-HR-04 left', () => {
    const contracts = readFileSync(
      resolve(HERE, '../../../../../../packages/contracts/src/modules/hr-payroll.ts'),
      'utf8',
    );
    expect(contracts).toContain(
      "export const COMPENSATION_LINE_ORIGINS = ['payItem', 'leaveSnapshot', 'adjustment'] as const;",
    );
  });

  /**
   * Phase B's word, and phase A must not have promised it. An installment here is `planned` or
   * `cancelled` — an intention, or one that was withdrawn — because nothing in this phase can
   * deduct anything.
   *
   * The assertion is on the VALUE rather than on the word: a message that explains a currency
   * mismatch by saying a loan "could not be deducted" is prose about the future, while
   * `status: 'deducted'` would be a state the code claims to reach.
   */
  it('and no installment can claim to have been deducted', () => {
    expect(code(CONTRACT)).toContain(
      "export const LOAN_INSTALLMENT_STATUSES = ['planned', 'cancelled'] as const;",
    );
    for (const file of [...loanFiles, CONTRACT]) {
      expect(code(file), rel(file)).not.toMatch(/['"]deducted['"]/);
    }
  });

  // D8's integration is phase B. A subscription here would be a promise with nothing behind it.
  it('and nothing subscribes to an event', () => {
    for (const file of loanFiles) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('EmployeeExited');
      expect(source, rel(file)).not.toContain('eventSubscriptions');
      expect(source, rel(file)).not.toContain('emit(');
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

  it('declares view, create and approve — and no page of its own', () => {
    const declaration = manifest.slice(
      manifest.indexOf("declarePermissions(\n  'hr',\n  'employeeLoan'"),
    );
    expect(declaration.length).toBeGreaterThan(0);
    const block = declaration.slice(0, declaration.indexOf(');') + 2);
    expect(block).toContain("['view', 'create']");
    expect(block).toContain("action: 'approve'");
    // Null on purpose: the surface is a profile tab, so there is no administration screen to name.
    // The page registry's spec states the same fact from the other end.
    expect(block).toContain('null,');
    for (const action of ["'delete'", "'export'", "'print'"]) {
      expect(block, action).not.toContain(action);
    }
  });

  it('and both collections are registered', () => {
    expect(manifest).toContain("'hr_employee_loans'");
    expect(manifest).toContain("'hr_loan_installments'");
  });
});
