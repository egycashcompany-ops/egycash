// The Employee Code has exactly three write sites, and each derives it (HR3-A).
//
// The code is `<BranchCode><GlobalEmployeeNumber>` (ADR-017) — derived, but STORED, which is what
// makes a fourth writer dangerous rather than merely untidy: one place assigning a literal, or
// building the string by hand, and two employees can disagree about what their own code is.
//
// So this file reads the sources. A rule enforced in a few places is only a rule if those are the
// only ones, and that is a property of the FILES, not of any single case.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '../../../../');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — these files explain the rule in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const apiFiles = sources(API_SRC);
const rel = (file: string): string => file.slice(API_SRC.length + 1);

describe('who may write an employee code', () => {
  /**
   * Three writers, and each is a branch prefix moving:
   *   • transfer — the employee moves to another branch;
   *   • rehire   — the returning employee's code is re-derived from their branch;
   *   • HR3-A    — the branch's own code changed under everybody standing in it.
   */
  it('is written from exactly two files — three sites, one meaning', () => {
    const writers = apiFiles.filter((file) =>
      /employee\.code\s*=(?!=)|\{\s*\$set:\s*\{\s*code:/.test(code(file)),
    );
    expect(writers.map(rel).sort()).toEqual(
      [
        'modules/hr/employee-management/employee-actions/employee-action.service.ts',
        'modules/hr/employee-management/employees/branch-code-seams.ts',
      ].sort(),
    );
  });

  it('and every one of them DERIVES it rather than composing a string', () => {
    for (const file of [
      'modules/hr/employee-management/employee-actions/employee-action.service.ts',
      'modules/hr/employee-management/employees/branch-code-seams.ts',
    ]) {
      expect(code(resolve(API_SRC, file)), file).toContain('buildEmployeeCode(');
    }
  });

  // The one derivation, in one place. A second implementation is how two codes drift apart.
  it('derives through a single shared function', () => {
    const builders = apiFiles.filter((file) => /export const buildEmployeeCode/.test(code(file)));
    expect(builders.map(rel)).toEqual([
      'modules/hr/employee-management/employees/employee-number.ts',
    ]);
  });
});

describe('what a branch-code change may and may not touch', () => {
  const seam = code(resolve(API_SRC, 'modules/hr/employee-management/employees/branch-code-seams.ts'));

  it('repairs the employee and the employee file — the same reach a transfer has', () => {
    expect(seam).toContain('EmployeeModel.updateOne');
    expect(seam).toContain('employeeFileService.syncEmployeeIdentity');
  });

  /**
   * ISSUED RECORDS ARE NOT REPAIRED, and this is the assertion that says so.
   *
   * A contract, a hiring document, a payslip and a leave request each carry the code they were
   * made with; the personnel-action log carries the code each action happened under. Rewriting
   * any of them would restate a document somebody was handed.
   */
  it('never rewrites a record that was issued with a code', () => {
    for (const forbidden of [
      'ContractModel',
      'HiringDocumentModel',
      'PayslipModel',
      'LeaveRequestModel',
      'EmployeeActionModel',
    ]) {
      expect(seam, forbidden).not.toContain(forbidden);
    }
  });

  it('creates no personnel action — nobody was promoted, moved or re-hired', () => {
    expect(seam).not.toContain('employeeActionService');
    expect(seam).not.toContain('createAction');
  });

  it('emits no event — there is no consumer for one', () => {
    expect(seam).not.toContain('emit(');
  });
});

/**
 * PY-8's precondition, guarded here because HR3-A is the first phase to write to an employee from
 * outside the personnel-action engine.
 *
 * PY-8 reconstructs a past month's basic salary by walking the action log backwards, and that is
 * only sound while the engine is the ONLY thing that writes `employment.salary`. HR3-A writes
 * `code` and nothing else; this is what keeps it that way.
 */
describe('the personnel-action engine is still the only writer of the salary', () => {
  it('assigns employment.salary in exactly one file', () => {
    const writers = apiFiles.filter((file) =>
      // `=` not followed by `=` — an ASSIGNMENT, not a `=== null` read.
      /employee\.employment\.salary\s*=(?!=)/.test(code(file)),
    );
    expect(writers.map(rel)).toEqual([
      'modules/hr/employee-management/employee-actions/employee-action.service.ts',
    ]);
  });

  it('and the branch-code seam does not go near it', () => {
    const seam = code(
      resolve(API_SRC, 'modules/hr/employee-management/employees/branch-code-seams.ts'),
    );
    expect(seam).not.toContain('salary');
    expect(seam).not.toContain('allowances');
  });
});
