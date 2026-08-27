// D14 — the two axes across Training, held in place by source.
//
// THE THIRD COPY OF A SPEC THAT HAS NOW CAUGHT THE SAME DEFECT TWICE. Payroll wrote it after
// F-B1-1 survived four phases of review; Recruitment wrote it after F-REQ-1 did the same. Both
// times the failure was invisible: `BaseRepository.scopeFilter` answers a scope whose field is
// undeclared with an EMPTY filter, `baseFilter` drops the empty clause, and a department-scoped
// reader is served the whole organization without anything failing or warning.
//
// Nothing in the type system can require the field — it is optional by design (ADR-017), so finer
// scopes stay opt-in per collection. So it is required here, for the collections that carry a
// PERSON, and explicitly NOT required for the two that do not.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

/** The rows that are about a PERSON. Each is readable by whoever may read that person. */
const PERSONAL = [
  {
    name: 'nominations',
    model: 'nominations/training-nomination.model.ts',
  },
  {
    name: 'enrollments',
    model: 'nominations/training-enrollment.model.ts',
  },
] as const;

const REPOSITORY = 'nominations/training-nomination.repository.ts';

describe('every training row about a person carries both axes', () => {
  it.each(PERSONAL)('$name stores them', ({ model }) => {
    const source = read(model);
    expect(source).toContain('branchId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: Types.ObjectId | null;');
    expect(source).toContain('departmentId: { type: Schema.Types.ObjectId, default: null }');
  });

  it.each(PERSONAL)('$name indexes the department axis', ({ model }) => {
    expect(code(model)).toContain("index({ departmentId: 1, status: 1 }");
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. Both repositories live in one file, so both declarations
   * are counted rather than merely found — one of the two going missing would otherwise pass.
   */
  it('both repositories declare both axes to the base repository', () => {
    const source = code(REPOSITORY);
    expect(source.split("branchField: 'branchId'").length - 1).toBe(2);
    expect(source.split("departmentField: 'departmentId'").length - 1).toBe(2);
  });

  /** D-DEPT-5's counterpart: the section rung is not opened here either. */
  it('adds no section axis', () => {
    expect(code(REPOSITORY)).not.toContain('sectionField');
  });
});

/**
 * The stamp comes from the EMPLOYEE, never from the request.
 *
 * A caller who could name their own department could nominate into another department's session
 * and read the answer. `subjectOf` reads the employee through the CALLER'S scope, so nominating
 * somebody you may not see is a 404 rather than a way to learn they exist.
 */
describe('the axes are read off the employee', () => {
  const SERVICE = code('nominations/training-nomination.service.ts');

  it('takes both from the employee record', () => {
    expect(SERVICE).toContain('branchId: employee.branchId,');
    expect(SERVICE).toContain('departmentId: employee.departmentId,');
  });

  it('never from the request or the caller', () => {
    expect(SERVICE).not.toMatch(/departmentId: input\.departmentId/);
    expect(SERVICE).not.toMatch(/branchId: input\.branchId/);
    expect(SERVICE).not.toMatch(/departmentId: ctx\./);
  });

  it('and reads the employee through the caller’s scope', () => {
    expect(SERVICE).toContain('employeeService.getById(employeeId, scope)');
  });
});

/**
 * THE COLLECTIONS THAT ARE NOT ABOUT A PERSON, asserted as deliberately unscoped on that axis.
 *
 * A course belongs to the company; a session belongs to a branch because that is where it is held,
 * and to no department because the people in the room come from several. Writing this down is what
 * stops somebody "fixing" the asymmetry by adding a field with nothing to put in it.
 */
describe('what deliberately carries no department', () => {
  it('the catalogue is organization-wide', () => {
    const source = code('courses/training-course.repository.ts');
    expect(source).not.toContain('branchField');
    expect(source).not.toContain('departmentField');
  });

  it('a session carries its branch and no department', () => {
    const source = code('sessions/training-session.repository.ts');
    expect(source).toContain("branchField: 'branchId'");
    expect(source).not.toContain('departmentField');
  });
});

/**
 * D5 — capacity is counted UNSCOPED, and that is the one place a scope must not reach.
 *
 * A department-scoped approver must not be told there is space because the people already in the
 * room are somebody else's department. Scope decides what a reader may SEE; it may not decide how
 * many chairs there are.
 */
describe('capacity is a property of the room, not of the reader', () => {
  it('counts occupied seats without a scope', () => {
    const source = code(REPOSITORY);
    const start = source.indexOf('async countOccupied');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('async findLive', start));
    expect(body).toContain('countDocuments');
    expect(body).not.toContain('scope');
    expect(body).not.toContain('baseFilter');
  });
});
