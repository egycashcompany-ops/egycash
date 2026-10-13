// DEC-29 / DEC-27 — the register's ONE scope rule, pinned on the same selectors both ways: the
// `$match` every register read applies, and the branch set the Data Report shows. They must say the
// same thing for every scope, or Section 1 and Section 2 of the report would disagree; and a
// department or section scope must NEVER come out as `{}` (company-wide) over this branch-only
// collection — the IDOR the review found (F-1).
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ScopeSelector } from '../../../shared/types';
import { registerScopeBranches, registerScopeMatch } from './register.repository';

const ALEX = new Types.ObjectId().toHexString();
const TANTA = new Types.ObjectId().toHexString();
const CAIRO = new Types.ObjectId().toHexString();
const DEPT_ALEX = new Types.ObjectId().toHexString();
const DEPT_TANTA = new Types.ObjectId().toHexString();
const USER = new Types.ObjectId().toHexString();
const NEVER = '000000000000000000000000';

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: USER,
  branchId: ALEX,
  departmentId: DEPT_ALEX,
  sectionId: new Types.ObjectId().toHexString(),
  ...over,
});

/**
 * The branches a register `$match` can return — read off the match itself: `'all'` when it does
 * not narrow by branch (organization, or own = `createdBy`), else the branch ids it names.
 */
const branchesOfMatch = (match: Record<string, unknown>): 'all' | string[] => {
  if (Object.keys(match).length === 0 || 'createdBy' in match) return 'all';
  if ('_id' in match) return String(match._id) === NEVER ? [] : 'all';
  if ('$or' in match) {
    const parts = (match.$or as Record<string, unknown>[]).map(branchesOfMatch);
    if (parts.includes('all')) return 'all';
    return [...new Set(parts.flat() as string[])];
  }
  const branch = match.branchId as Types.ObjectId | { $in: Types.ObjectId[] } | undefined;
  if (branch === undefined) return 'all';
  if (branch instanceof Types.ObjectId) return [branch.toHexString()];
  return branch.$in.map((id) => id.toHexString());
};

const sorted = (value: 'all' | string[]): 'all' | string[] =>
  value === 'all' ? value : [...value].sort();

const CASES: [string, ScopeSelector][] = [
  ['organization', selector({ scope: 'organization' })],
  ['own', selector({ scope: 'own' })],
  ['branch, home only', selector({ scope: 'branch' })],
  ['branch with a reach', selector({ scope: 'branch', branchIds: [ALEX, TANTA] })],
  ['department, home only', selector({ scope: 'department' })],
  [
    'department with a reach (copies in two branches)',
    selector({
      scope: 'department',
      departmentIds: [DEPT_ALEX, DEPT_TANTA],
      departmentBranchIds: [ALEX, TANTA],
    }),
  ],
  [
    'department reaching another branch only — the home is NOT in it',
    selector({ scope: 'department', departmentIds: [DEPT_TANTA], departmentBranchIds: [TANTA] }),
  ],
  [
    'branch reach plus department copies',
    selector({
      scope: 'branch',
      branchIds: [CAIRO],
      departmentIds: [DEPT_TANTA],
      departmentBranchIds: [TANTA],
    }),
  ],
  ['section', selector({ scope: 'section' })],
  [
    'section with a branch reach (sections ignore it)',
    selector({ scope: 'section', branchIds: [TANTA] }),
  ],
  ['branch, placed nowhere', selector({ scope: 'branch', branchId: null })],
  ['department, placed nowhere', selector({ scope: 'department', branchId: null })],
  ['section, placed nowhere', selector({ scope: 'section', branchId: null })],
];

describe('registerScopeMatch ↔ registerScopeBranches (DEC-27, DEC-29)', () => {
  it.each(CASES)('%s: the branch set equals the branches the match can return', (_name, s) => {
    expect(sorted(registerScopeBranches(s))).toEqual(
      sorted(branchesOfMatch(registerScopeMatch(s))),
    );
  });

  it('organization matches everything and shows every branch', () => {
    const s = selector({ scope: 'organization' });
    expect(registerScopeMatch(s)).toEqual({});
    expect(registerScopeBranches(s)).toBe('all');
  });

  it('own narrows by creator, not by branch', () => {
    const s = selector({ scope: 'own' });
    expect(registerScopeMatch(s)).toEqual({ createdBy: new Types.ObjectId(USER) });
    expect(registerScopeBranches(s)).toBe('all');
  });

  it('department and section NARROW to the home branch — never `{}` over a branch-only collection', () => {
    for (const scope of ['department', 'section'] as const) {
      const match = registerScopeMatch(selector({ scope }));
      expect(match).not.toEqual({});
      expect(branchesOfMatch(match)).toEqual([ALEX]);
    }
  });

  it('a department reach that leaves out the home branch shows only the reached branch', () => {
    const s = selector({
      scope: 'department',
      departmentIds: [DEPT_TANTA],
      departmentBranchIds: [TANTA],
    });
    expect(registerScopeBranches(s)).toEqual([TANTA]);
  });

  it('a caller placed nowhere matches nothing and shows nothing (fail closed)', () => {
    for (const scope of ['branch', 'department', 'section'] as const) {
      const s = selector({ scope, branchId: null });
      expect(branchesOfMatch(registerScopeMatch(s))).toEqual([]);
      expect(registerScopeBranches(s)).toEqual([]);
    }
  });
});
