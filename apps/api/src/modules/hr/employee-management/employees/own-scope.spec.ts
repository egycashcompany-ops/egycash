// `own` scope on an employee means THIS PERSON'S OWN RECORD.
//
// It did not. `BaseRepository` builds the `own` filter from three optional sources — `createdBy`,
// an assignees array, and a declared `ownerUserField` — and the employee repository declared none
// of them. So `own` collapsed to `{ createdBy: <caller> }`, which for an employee record is the HR
// officer who registered them and never the person themselves.
//
// Nothing failed loudly. Employees simply could not reach anything that had to LOAD their own
// record: applying for a loan asked for the caller's own file and got a 404, because the only
// employee they "owned" was one they had created for somebody else. The self-service reads all
// worked, which is what hid it — they resolve the employee from the token and never take a scope.
//
// Asserted against the REAL repository rather than a fixture: the bug was a missing line in its
// constructor options, so a test that built its own options could not have caught it.
import { type Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { employeeRepository } from './employee.repository';

/** `scopeFilter` is `protected` — compile-time only. This is the real method on the real object. */
const filterFor = (scope: string, userId: string): Record<string, unknown> =>
  (
    employeeRepository as unknown as {
      scopeFilter: (s: unknown) => Record<string, unknown>;
    }
  ).scopeFilter({ scope, userId, branchId: null, departmentId: null, sectionId: null });

const ME = '650000000000000000000001';

describe('own scope on the employee registry', () => {
  it('matches the employee whose LOGIN is the caller', () => {
    const ors = filterFor('own', ME).$or as Record<string, Types.ObjectId>[];
    const fields = ors.map((clause) => Object.keys(clause)[0]);
    expect(fields, 'the link to the login account has to be one of the ways in').toContain('userId');
    expect(String(ors.find((c) => 'userId' in c)?.userId)).toBe(ME);
  });

  it('still matches what the caller CREATED, which is what it meant before', () => {
    // Widening, not replacing: an HR officer scoped to `own` keeps seeing the records they made.
    const fields = (filterFor('own', ME).$or as Record<string, unknown>[]).map(
      (clause) => Object.keys(clause)[0],
    );
    expect(fields).toContain('createdBy');
  });

  it('can only ever ADD the caller — never another person', () => {
    // The whole safety argument. `userId` is unique per employee (ADR-017), so this clause selects
    // exactly one row: the caller's own. Every clause in the `$or` is keyed on the caller's id.
    const ors = filterFor('own', ME).$or as Record<string, Types.ObjectId>[];
    for (const clause of ors) {
      const value = Object.values(clause)[0];
      expect(String(value), 'a clause that is not about the caller would widen `own`').toBe(ME);
    }
  });

  it('leaves the hierarchical scopes alone', () => {
    // `own` is the only scope this touched; branch/department/section still filter by placement,
    // and `organization` still narrows nothing.
    expect(filterFor('organization', ME)).toEqual({});
    expect(Object.keys(filterFor('branch', ME))).not.toContain('$or');
  });
});
