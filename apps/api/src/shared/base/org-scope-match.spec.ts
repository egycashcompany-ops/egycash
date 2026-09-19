// One rule for every hand-written `$match`: the fragment a hierarchical scope implies.
//
// The repository's `scopeFilter` delegates here, and so do the aggregations that cannot call it
// (dashboards, reports, the export, the roles list joined to its holders). The properties worth
// pinning are the ones a copy tends to lose: a reach is a `$in` over every unit it names, a caller
// placed nowhere matches NOTHING, an empty reach never widens, and a collection without the finer
// field either widens (the repository's reading) or narrows to the branch when asked to.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type ScopeSelector } from '../types';
import { NEVER_MATCH, orgScopeMatch } from './org-scope-match';

const B1 = '650000000000000000000001';
const B2 = '650000000000000000000002';
const D1 = '650000000000000000000011';
const D2 = '650000000000000000000012';
const S1 = '650000000000000000000021';

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: '650000000000000000000099',
  branchId: B1,
  departmentId: D1,
  sectionId: S1,
  ...over,
});

const ALL = { branch: 'branchId', department: 'departmentId', section: 'sectionId' };
const ids = (clause: unknown): string[] =>
  ((clause as { $in: Types.ObjectId[] }).$in ?? []).map(String);

describe('the scopes that do not narrow by unit', () => {
  it('organization matches everything', () => {
    expect(orgScopeMatch(selector({ scope: 'organization' }), ALL)).toEqual({});
  });

  it('own is not answered here — each collection spells "mine" itself', () => {
    expect(orgScopeMatch(selector({ scope: 'own' }), ALL)).toBeUndefined();
  });
});

describe('a branch scope', () => {
  it('is the home branch when the grant reaches nowhere else', () => {
    expect(orgScopeMatch(selector({}), ALL)).toEqual({ branchId: new Types.ObjectId(B1) });
  });

  it('is every branch the grant reaches, as one $in', () => {
    const m = orgScopeMatch(selector({ branchIds: [B1, B2] }), ALL);
    expect(ids(m?.branchId)).toEqual([B1, B2]);
  });

  it('matches nothing for a caller placed in no branch', () => {
    expect(orgScopeMatch(selector({ branchId: null }), ALL)).toEqual(NEVER_MATCH);
  });

  it('never widens on a reach that resolved to nothing valid', () => {
    expect(orgScopeMatch(selector({ branchIds: ['not-an-id'] }), ALL)).toEqual(NEVER_MATCH);
    // An EMPTY list is "no reach listed", so the home branch answers — the selector's contract.
    expect(orgScopeMatch(selector({ branchIds: [] }), ALL)).toEqual({ branchId: new Types.ObjectId(B1) });
  });

  it('widens over a collection that carries no branch', () => {
    expect(orgScopeMatch(selector({}), { department: 'departmentId' })).toEqual({});
  });
});

describe('a department scope', () => {
  it('is the home department when the grant reaches nowhere else', () => {
    expect(orgScopeMatch(selector({ scope: 'department' }), ALL)).toEqual({
      departmentId: new Types.ObjectId(D1),
    });
  });

  it('is every department copy the grant reaches, narrowed to the branches it reaches', () => {
    const m = orgScopeMatch(
      selector({ scope: 'department', departmentIds: [D1, D2], branchIds: [B1, B2] }),
      ALL,
    ) as { $and: Record<string, unknown>[] };
    expect(ids(m.$and[0]?.departmentId)).toEqual([D1, D2]);
    expect(ids(m.$and[1]?.branchId)).toEqual([B1, B2]);
  });

  it('asks only for the departments when the collection carries no branch', () => {
    const m = orgScopeMatch(
      selector({ scope: 'department', departmentIds: [D1, D2], branchIds: [B1, B2] }),
      { department: 'departmentId' },
    );
    expect(ids(m?.departmentId)).toEqual([D1, D2]);
    expect(m?.$and).toBeUndefined();
  });

  it('matches nothing for a caller placed in no department', () => {
    expect(orgScopeMatch(selector({ scope: 'department', departmentId: null }), ALL)).toEqual(
      NEVER_MATCH,
    );
  });

  it('widens over a branch-only collection by default (the repository reading)', () => {
    expect(orgScopeMatch(selector({ scope: 'department' }), { branch: 'branchId' })).toEqual({});
  });

  it('narrows to the branches it reaches over a branch-only collection when asked', () => {
    const home = orgScopeMatch(selector({ scope: 'department' }), { branch: 'branchId' }, {
      finerNarrowsToBranch: true,
    });
    expect(home).toEqual({ branchId: new Types.ObjectId(B1) });
    const reach = orgScopeMatch(
      selector({ scope: 'department', departmentIds: [D1, D2], branchIds: [B1, B2] }),
      { branch: 'branchId' },
      { finerNarrowsToBranch: true },
    );
    expect(ids(reach?.branchId)).toEqual([B1, B2]);
  });
});

describe('a section scope', () => {
  it('is the home section', () => {
    expect(orgScopeMatch(selector({ scope: 'section' }), ALL)).toEqual({
      sectionId: new Types.ObjectId(S1),
    });
  });

  it('matches nothing for a caller placed in no section', () => {
    expect(orgScopeMatch(selector({ scope: 'section', sectionId: null }), ALL)).toEqual(NEVER_MATCH);
  });

  it('narrows to the branch over a branch-only collection when asked, else widens', () => {
    expect(orgScopeMatch(selector({ scope: 'section' }), { branch: 'branchId' })).toEqual({});
    expect(
      orgScopeMatch(selector({ scope: 'section' }), { branch: 'branchId' }, { finerNarrowsToBranch: true }),
    ).toEqual({ branchId: new Types.ObjectId(B1) });
  });
});

describe('a prefixed field map (a joined read)', () => {
  it('names the joined fields', () => {
    const m = orgScopeMatch(selector({ branchIds: [B1, B2] }), { branch: 'holder.organization.branchId' });
    expect(ids(m?.['holder.organization.branchId'])).toEqual([B1, B2]);
  });
});
