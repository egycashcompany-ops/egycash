// The id → name mapping behind the employees list, tested where it is pure.
//
// Two properties are load-bearing. A reference that resolves to nothing must become `null` rather
// than throw — one hard-deleted section must not 500 a registry page. And the lookup must be
// built from the catalogues it was handed, never from a per-row read: the whole point is one read
// per catalogue per page.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { placementLookup, type NamedUnit } from './employee-placement';
import { type EmployeeDoc } from './employee.model';

const unit = (code: string, ar: string, en: string): NamedUnit => ({
  _id: new Types.ObjectId(),
  code,
  name: { ar, en },
});

const BRANCH = unit('010', 'المهندسين', 'Mohandessin');
const DEPARTMENT = unit('DEP-0001', 'العمليات', 'Operations');
const SECTION = unit('SEC-0001', 'النقل', 'Transport');
const JOB = unit('JOB-0001', 'سائق', 'Driver');

const employee = (over: Partial<EmployeeDoc['employment']> = {}): EmployeeDoc =>
  ({
    employment: {
      branchId: BRANCH._id,
      departmentId: DEPARTMENT._id,
      sectionId: SECTION._id,
      jobTitleId: JOB._id,
      ...over,
    },
  }) as unknown as EmployeeDoc;

const lookup = placementLookup({
  branches: [BRANCH],
  departments: [DEPARTMENT],
  sections: [SECTION],
  jobTitles: [JOB],
});

describe('resolving a placement to names', () => {
  it('names all four units, with id and code, in both languages', () => {
    expect(lookup.for(employee())).toEqual({
      branch: { id: String(BRANCH._id), code: '010', name: { ar: 'المهندسين', en: 'Mohandessin' } },
      department: { id: String(DEPARTMENT._id), code: 'DEP-0001', name: { ar: 'العمليات', en: 'Operations' } },
      section: { id: String(SECTION._id), code: 'SEC-0001', name: { ar: 'النقل', en: 'Transport' } },
      jobTitle: { id: String(JOB._id), code: 'JOB-0001', name: { ar: 'سائق', en: 'Driver' } },
    });
  });

  /** 7% of the imported workforce has no section — a fact, not a failure. */
  it('gives null for an employee with no section', () => {
    expect(lookup.for(employee({ sectionId: null })).section).toBeNull();
  });

  /** THE ONE THAT KEEPS A PAGE UP: a dangling reference is null, never a throw. */
  it('gives null, not an error, for an id the catalogue does not hold', () => {
    const gone = new Types.ObjectId();
    const dto = lookup.for(employee({ departmentId: gone }));
    expect(dto.department).toBeNull();
    // The other three are unaffected by the one that failed to resolve.
    expect(dto.branch?.code).toBe('010');
    expect(dto.jobTitle?.code).toBe('JOB-0001');
  });

  it('copies the name rather than aliasing the catalogue object', () => {
    const dto = lookup.for(employee());
    expect(dto.branch?.name).not.toBe(BRANCH.name);
    expect(dto.branch?.name).toEqual(BRANCH.name);
  });
});
