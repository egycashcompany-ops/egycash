// P-SCOPE-1 — the department axis, held in place by source.
//
// The defect this phase closed was invisible: `BaseRepository.scopeFilter` answers a scope whose
// field is undeclared with an EMPTY filter, and `baseFilter` then drops the empty clause. So a
// collection that forgets `departmentField` does not fail, does not warn, and does not narrow —
// it silently serves the whole organization to a department-scoped reader. That is exactly how
// F-B1-1 survived four phases of review.
//
// Nothing in the type system can catch it, because the option is optional by design. So it is
// caught here: each collection that stamps a department must also DECLARE it, and each must stamp
// it from the employee rather than from anything a request could influence.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, '..');
const read = (file: string): string => readFileSync(resolve(HR, file), 'utf8');

/** The four collections D-DEPT-1 put in scope, each as its model / repository / stamping service. */
const COLLECTIONS = [
  {
    name: 'payslips',
    model: 'payroll/payslips/payslip.model.ts',
    repository: 'payroll/payslips/payslip.repository.ts',
    service: 'payroll/payslips/payslip.service.ts',
    stamp: 'departmentId: employee.employment.departmentId',
  },
  {
    name: 'adjustments',
    model: 'payroll/adjustments/payroll-adjustment.model.ts',
    repository: 'payroll/adjustments/payroll-adjustment.repository.ts',
    service: 'payroll/adjustments/payroll-adjustment.service.ts',
    stamp: 'departmentId: employee.departmentId',
  },
  {
    name: 'employee pay items',
    model: 'payroll/employee-pay-items/employee-pay-item.model.ts',
    repository: 'payroll/employee-pay-items/employee-pay-item.repository.ts',
    service: 'payroll/employee-pay-items/employee-pay-item.service.ts',
    stamp: 'departmentId: employee.employment.departmentId',
  },
  {
    name: 'employee loans',
    model: 'employee-loans/employee-loan.model.ts',
    repository: 'employee-loans/employee-loan.repository.ts',
    service: 'employee-loans/employee-loan.service.ts',
    stamp: 'departmentId: employee.departmentId',
  },
] as const;

describe('the department axis exists on every collection D-DEPT-1 named', () => {
  it.each(COLLECTIONS)('$name stores it', ({ model }) => {
    const source = read(model);
    expect(source).toContain('departmentId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: { type: Schema.Types.ObjectId, default: null }');
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. A field nobody declares narrows nothing, and nothing else
   * in the codebase would notice.
   */
  it.each(COLLECTIONS)('$name declares it to the base repository', ({ repository }) => {
    expect(read(repository)).toContain("departmentField: 'departmentId'");
  });

  it.each(COLLECTIONS)('$name stamps it from the employee, beside the branch', ({ service, stamp }) => {
    const source = read(service);
    expect(source).toContain(stamp);
    // Never from a request: the axis is a fact about the person, not an argument a caller supplies.
    expect(source).not.toMatch(/departmentId: input\./);
    expect(source).not.toMatch(/departmentId: ctx\./);
  });
});

describe('what the phase deliberately did not do', () => {
  /** D-DEPT-5 — the section rung stays where it was, and §8 of the design says so. */
  it('adds no section axis to any of them', () => {
    for (const { repository } of COLLECTIONS) {
      expect(read(repository), repository).not.toContain('sectionField');
    }
  });

  /**
   * D-DEPT-2 — the stamp is a snapshot. An update path that touched it would let a transfer
   * recorded tomorrow move a payslip that was already paid.
   */
  it('never updates the stamp after the row is written', () => {
    for (const { service } of COLLECTIONS) {
      const source = read(service);
      expect(source, service).not.toMatch(/\$set:\s*\{[^}]*departmentId/);
    }
  });
});

// ── Stage 3 — the backfill ──────────────────────────────────────────────────

describe('the backfill only ever adds', () => {
  const WORKER = readFileSync(resolve(HR, 'shared/department-backfill.ts'), 'utf8');

  /**
   * IDEMPOTENT BY FILTER, not by a flag somebody must remember to check. Both the read and the
   * write name `departmentId: null`, so a second run finds nothing and a row somebody corrected by
   * hand between the two is never overwritten.
   */
  it('reads and writes only rows that carry no department', () => {
    expect(WORKER).toContain('.find({ departmentId: null })');
    expect(WORKER).toContain("{ _id: row['_id'], departmentId: null }");
  });

  /** It fills one field. A backfill that could touch a paid figure would be a different thing. */
  it('sets the department and nothing else', () => {
    const sets = [...WORKER.matchAll(/\$set: \{([^}]*)\}/g)].map((m) => m[1]?.trim());
    expect(sets).toEqual(['departmentId: new Types.ObjectId(resolved)']);
  });

  /**
   * D-DEPT-3 — the whole reason this is not a one-line copy of today's department. Reading the
   * employee's CURRENT department as the answer would attribute a 2025 payslip to a department
   * they joined in 2026, and it would look right.
   */
  it('derives the date-correct department rather than copying today’s', () => {
    expect(WORKER).toContain('departmentAt(');
    expect(WORKER).toContain("'changes.field': 'departmentId'");
    expect(WORKER).toContain("status: 'applied'");
  });

  /** An unplaceable row stays null — which D-DEPT-4 already renders invisible, not visible. */
  it('leaves a row it cannot place alone, and counts it', () => {
    expect(WORKER).toContain('unattributed');
  });
});

/**
 * THE SEAMS THE FIRST ATTEMPT BROKE, asserted so the shape cannot quietly revert.
 *
 * Stage 3 was first written as ONE migration reaching all four collections. Three guards failed at
 * once: payroll may not name a loan collection (P-HR-05-B), and the adjustments model is reachable
 * from three files inside its own feature. The guards were right and the design was wrong — so the
 * rule and the mechanics moved to `shared/` (which names no collection) and each feature kept the
 * one import only it may make.
 */
describe('the backfill respects the seams rather than crossing them', () => {
  const WORKER = readFileSync(resolve(HR, 'shared/department-backfill.ts'), 'utf8');
  const RULE = readFileSync(resolve(HR, 'shared/department-at.ts'), 'utf8');

  it('the shared halves name no collection at all', () => {
    for (const [name, source] of [
      ['department-backfill.ts', WORKER],
      ['department-at.ts', RULE],
    ] as const) {
      for (const model of [
        'PayslipModel',
        'PayrollAdjustmentModel',
        'EmployeePayItemModel',
        'EmployeeLoanModel',
      ]) {
        expect(source, `${name}: ${model}`).not.toContain(model);
      }
    }
  });

  it('and the rule touches no database whatsoever', () => {
    for (const forbidden of ['mongoose', 'Model', 'find(', 'updateOne', 'Repository']) {
      expect(RULE, forbidden).not.toContain(forbidden);
    }
  });

  it.each([
    ['payroll/payslips/payslip-department.backfill.ts', 'PayslipModel'],
    ['payroll/adjustments/adjustment-department.backfill.ts', 'PayrollAdjustmentModel'],
    [
      'payroll/employee-pay-items/employee-pay-item-department.backfill.ts',
      'EmployeePayItemModel',
    ],
    ['employee-loans/employee-loan-department.backfill.ts', 'EmployeeLoanModel'],
  ])('%s names its own model and no other', (file, own) => {
    const source = readFileSync(resolve(HR, file), 'utf8');
    expect(source).toContain(own);
    const others = [
      'PayslipModel',
      'PayrollAdjustmentModel',
      'EmployeePayItemModel',
      'EmployeeLoanModel',
    ].filter((m) => m !== own);
    for (const other of others) expect(source, other).not.toContain(other);
  });
});
