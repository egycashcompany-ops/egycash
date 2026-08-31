// AT-D3 — the device says a number, and this is the only thing that says who that number is.
//
// THE EVIDENCE THIS PHASE WAS BUILT FROM. A confirmed export from the organization's own K40 Pro
// names people by `Ac-No`: 257 distinct ids running `1` … `702255`, with prefixes 100/101/102/200/
// 300/301/702. An ECMS `employeeNumber` is a zero-padded global sequence starting `000001`. The
// import keyed on the ECMS one, so a relay forwarding real device rows would have resolved NOBODY
// today — and the wrong person the day the sequence reached six figures. Neither failure is loud.
//
// SOURCE-LEVEL, and for the reason the scope guards beside it are: what has to stay true is a
// property of the DECLARATION. An integration test proves one path works on one day; it does not
// notice the day somebody deletes a `branchField` or lets the importer fall back from one identity
// to the other. Those are the changes that widen access and mis-attribute pay while every test
// stays green.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportPunchRowSchema, normalizeEnrollmentNo } from '@ecms/contracts';

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');
const model = () => read('enrollments', 'attendance-enrollment.model.ts');
const repo = () => read('enrollments', 'attendance-enrollment.repository.ts');
const service = () => read('enrollments', 'attendance-enrollment.service.ts');
const punchService = () => read('punches', 'punch.service.ts');

describe('a row carries exactly one identity', () => {
  const base = { at: new Date('2026-08-20T09:00:00.000Z'), deviceId: 'HQ-1' };

  it('accepts an employee number alone', () => {
    expect(ImportPunchRowSchema.safeParse({ ...base, employeeNumber: '000125' }).success).toBe(true);
  });

  it('accepts an enrolment number alone', () => {
    expect(ImportPunchRowSchema.safeParse({ ...base, enrollmentNo: '100311' }).success).toBe(true);
  });

  /**
   * THE ASSERTION THE WHOLE CONTRACT CHANGE EXISTS FOR.
   *
   * A row with both identities has two answers to «who is this», and the day they disagreed the
   * importer would have to pick one silently. That is how a punch lands on the wrong person's
   * month with nothing recording the choice — so the row is refused at the door instead.
   */
  it('REFUSES a row carrying both', () => {
    expect(
      ImportPunchRowSchema.safeParse({ ...base, employeeNumber: '000125', enrollmentNo: '100311' })
        .success,
    ).toBe(false);
  });

  it('refuses a row carrying neither', () => {
    expect(ImportPunchRowSchema.safeParse(base).success).toBe(false);
  });
});

describe('the enrolment number is trimmed and NOTHING else', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeEnrollmentNo('  100311 ')).toBe('100311');
  });

  /**
   * A device code is uppercased because `hq-gate-1` and `HQ-GATE-1` are one wall somebody named
   * twice. An enrolment number is an opaque token the device compares byte for byte: `01` and `1`
   * may be two different people, and folding them together would merge two employees' attendance
   * with nothing to show it happened.
   */
  it('does NOT strip leading zeros — `01` and `1` stay two enrolments', () => {
    expect(normalizeEnrollmentNo('01')).toBe('01');
    expect(normalizeEnrollmentNo('01')).not.toBe(normalizeEnrollmentNo('1'));
  });

  it('does not uppercase — the device is not case-folding its own ids', () => {
    expect(normalizeEnrollmentNo('a1')).toBe('a1');
  });
});

describe('the mapping is keyed per device, never globally', () => {
  it('the unique index names both the device and the enrolment', () => {
    expect(model()).toContain('{ deviceId: 1, enrollmentNo: 1 }');
    expect(model()).toContain('unique: true');
  });

  /**
   * Two devices are two enrolment namespaces until somebody proves otherwise. A per-device key
   * that turns out to be globally unique costs one redundant row; a global key that turns out to
   * be per-device attributes one person's punches to another, silently and permanently.
   */
  it('the resolver takes the device as well as the number', () => {
    expect(repo()).toContain('findByEnrollmentSystem(\n    deviceId: Types.ObjectId,\n    enrollmentNo: string,');
  });

  it('the key is freed by a soft delete, so an id can be re-mapped', () => {
    expect(model()).toContain('partialFilterExpression: { isDeleted: false }');
  });
});

describe('the scope axis is declared, and it is the employee’s', () => {
  /**
   * `BaseRepository.scopeFilter` answers an UNDECLARED field with an empty filter and `baseFilter`
   * drops the empty clause — so a collection carrying a branch that forgets to say so serves the
   * whole organization to a branch-scoped reader, with nothing failing and nothing warning. This
   * defect shipped twice in this codebase before anyone caught it.
   */
  it('declares branchField on the repository', () => {
    expect(repo()).toContain("branchField: 'employeeBranchId'");
  });

  /**
   * The EMPLOYEE's branch, not the device's, and the difference is who gets to read a name: a
   * branch manager listing every enrolment on a shared device would learn the names of people
   * filed elsewhere.
   */
  it('scopes by the employee’s branch rather than the device’s', () => {
    expect(repo()).not.toContain("branchField: 'branchId'");
    expect(model()).toContain('employeeBranchId');
  });
});

describe('what the import does with an identity it cannot resolve', () => {
  it('quarantines an unmapped enrolment by name, so the fix is a job somebody can do', () => {
    expect(punchService()).toContain('unmapped enrollmentNo');
  });

  /**
   * NO FALLBACK, and this is the guard that matters most in this file.
   *
   * If an unresolved enrolment quietly retried as an employee number, a mistyped enrolment would
   * resolve to whichever employee happened to carry that number — a punch attributed to a real
   * person who was never there, indistinguishable from a real one. The contract refuses a row
   * with both identities precisely so this branch can be a CHOICE and never a fallback.
   */
  it('chooses between the two lookups and never falls back from one to the other', () => {
    const src = punchService();
    expect(src).toContain('if (row.enrollmentNo !== undefined) {');
    // The employee-number lookup is reachable only through the `else`, not after a failed mapping.
    const enrolBlock = src.slice(src.indexOf('if (row.enrollmentNo !== undefined) {'), src.indexOf('} else {'));
    expect(enrolBlock).not.toContain('findByEmployeeNumberSystem');
  });

  /**
   * A mapping that exists but points at nobody is its OWN outcome, not a missing mapping.
   * «unmapped» would send somebody to create a mapping that is already there, so the two reasons
   * stay distinct and each names the job it actually implies.
   */
  it('separates an orphaned mapping from an absent one', () => {
    expect(punchService()).toContain('maps to an employee that no longer exists');
    expect(punchService()).toContain("'orphaned'");
  });

  /**
   * One read per PERSON, not per row. A device batch is a few hundred people repeated across
   * thousands of rows, and the employee re-read that keeps the branch current sits inside the
   * cache fill rather than the loop body — the difference between ~200 queries and 5,000.
   */
  it('re-reads the employee once per enrolment, inside the cache fill', () => {
    const src = punchService();
    const fill = src.slice(src.indexOf('if (!byEnrollment.has(key)) {'), src.indexOf('const resolved ='));
    expect(fill).toContain('employeeRepository.findById');
    const after = src.slice(src.indexOf('const resolved ='), src.indexOf('} else {'));
    expect(after).not.toContain('employeeRepository.findById');
  });

  /**
   * The device is resolved BEFORE the person, and that ordering is load-bearing rather than
   * cosmetic: `{deviceId, enrollmentNo}` is the key, so an enrolment number means nothing until
   * the namespace it belongs to is known.
   */
  it('resolves the device before the person', () => {
    const src = punchService();
    expect(src.indexOf('findByCodeSystem')).toBeLessThan(src.indexOf('findByEnrollmentSystem'));
  });

  /**
   * A mapping made before a transfer carries the branch of that moment. The punch's
   * `employeeBranchId` is the READER's axis, so stamping it from a stale copy would hide the punch
   * from the branch that now owns the person — the AT-D1 finding, one hop further along.
   */
  it('stamps the punch with the employee’s CURRENT branch, not the mapping’s copy', () => {
    expect(punchService()).toContain('current.employment.branchId');
  });
});

describe('both sides of a mapping are validated on write', () => {
  it('refuses a mapping to a device that does not exist', () => {
    expect(service()).toContain('no such device:');
  });

  it('refuses a mapping to an employee that does not exist', () => {
    expect(service()).toContain('no such employee:');
  });

  it('refuses a second mapping for an enrolment already mapped', () => {
    expect(service()).toContain('is already mapped');
  });
});
