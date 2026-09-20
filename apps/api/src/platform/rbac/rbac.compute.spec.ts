// The one derivation of an effective permission set, on the axis ADR-032 added: reach PER KEY.
//
// Every site's table is its own. A person who holds «الموظفين» in two sites and «الحضور» in one
// must not see attendance in both because the union of their grants happens to cover both — so the
// walk that merges scopes also collects, for each key, exactly the sites that key was granted in.
// These cases pin that, plus the two things a delegated grant may and may not do: add a key at
// branch scope in one site, and never make its holder privileged.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { computeEffective } from './rbac.service';
import { type RoleAssignmentDoc } from './role-assignment.model';
import { type RoleDoc } from './role.model';
import { type DelegatedGrantDoc } from './delegation.model';

const B1 = '650000000000000000000001';
const B2 = '650000000000000000000002';
const B3 = '650000000000000000000003';
const NOW = new Date('2026-09-01T00:00:00Z');

const role = (id: string, keys: string[], isSystem = false): RoleDoc =>
  ({ _id: new Types.ObjectId(id), permissionKeys: keys, isSystem, name: { ar: id, en: id }, key: null }) as unknown as RoleDoc;

const assignment = (
  roleId: string,
  over: Partial<RoleAssignmentDoc> = {},
): RoleAssignmentDoc =>
  ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    roleId: new Types.ObjectId(roleId),
    scope: 'branch',
    branchId: new Types.ObjectId(B1),
    departmentId: null,
    sectionId: null,
    branchIds: [],
    departmentCatalogId: null,
    allBranches: false,
    validFrom: null,
    validTo: null,
    ...over,
  }) as RoleAssignmentDoc;

const delegated = (branchId: string, keys: string[], departmentId: string | null = null): DelegatedGrantDoc =>
  ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    branchId: new Types.ObjectId(branchId),
    departmentId: departmentId === null ? null : new Types.ObjectId(departmentId),
    permissionKeys: keys,
    grantedBy: null,
  }) as DelegatedGrantDoc;

const R1 = '650000000000000000000101';
const R2 = '650000000000000000000102';
const roles = (...list: RoleDoc[]): Map<string, RoleDoc> => new Map(list.map((r) => [String(r._id), r]));
const branchesOf = (raw: { branchIds: Set<string>; homeBranchIds: Set<string> } | undefined) => ({
  listed: [...(raw?.branchIds ?? [])].sort(),
  homes: [...(raw?.homeBranchIds ?? [])].sort(),
});

describe('reach is collected per key', () => {
  it('a key granted in two sites and a key granted in one do not share a reach', () => {
    const out = computeEffective(
      [
        assignment(R1, { branchIds: [new Types.ObjectId(B2)] }), // employee.view: home + B2
        assignment(R2), // attendance.view: home only
      ],
      roles(role(R1, ['employee.view']), role(R2, ['attendance.view'])),
      [],
      NOW,
    );
    expect(branchesOf(out.reachByKey.get('employee.view'))).toEqual({ listed: [B1, B2], homes: [] });
    expect(branchesOf(out.reachByKey.get('attendance.view'))).toEqual({ listed: [], homes: [B1] });
    // The union is what the switcher offers: both sites.
    expect([...out.reach.branchIds].sort()).toEqual([B1, B2]);
  });

  it('a delegated grant adds its one site to exactly the keys it names, at branch scope', () => {
    const out = computeEffective(
      [assignment(R1)],
      roles(role(R1, ['employee.view'])),
      [delegated(B3, ['attendance.view', 'employee.view'])],
      NOW,
    );
    expect(out.permissions).toEqual({ 'employee.view': 'branch', 'attendance.view': 'branch' });
    // employee.view: the home grant's site rides along with the delegated one.
    expect(branchesOf(out.reachByKey.get('employee.view'))).toEqual({ listed: [B3], homes: [B1] });
    // attendance.view: the delegated site only — nothing granted it at home.
    expect(branchesOf(out.reachByKey.get('attendance.view'))).toEqual({ listed: [B3], homes: [] });
    expect(out.delegations).toHaveLength(1);
  });

  it('a delegated grant never widens a wider scope and never makes anyone privileged', () => {
    const out = computeEffective(
      [assignment(R1, { scope: 'organization', branchId: null })],
      roles(role(R1, ['employee.view'])),
      [delegated(B3, ['employee.view', 'user.manageSessions'])],
      NOW,
    );
    expect(out.permissions['employee.view']).toBe('organization');
    // `user.manageSessions` is break-glass, and a delegated grant of it DOES make the holder
    // privileged — that is the break-glass rule, keyed on the permission, not on how it arrived.
    expect(out.permissions['user.manageSessions']).toBe('branch');
    expect(out.isPrivileged).toBe(true);
    const plain = computeEffective([], new Map(), [delegated(B3, ['employee.view'])], NOW);
    expect(plain.isPrivileged).toBe(false);
  });

  it('a delegation over one department covers that copy and never its branch (Gap 1)', () => {
    const D3 = '650000000000000000000033';
    const out = computeEffective([], new Map(), [delegated(B3, ['employee.view'], D3)], NOW);
    expect(out.permissions).toEqual({ 'employee.view': 'department' });
    const raw = out.reachByKey.get('employee.view');
    expect([...(raw?.departmentIds ?? [])]).toEqual([D3]);
    expect([...(raw?.branchIds ?? [])]).toEqual([]);
    expect([...out.reach.branchIds]).toEqual([]);
  });

  it('a department grant with listed branches asks for the copies there, never for the branches', () => {
    const CATALOG = '650000000000000000000501';
    const out = computeEffective(
      [
        assignment(R1, {
          scope: 'department',
          departmentId: new Types.ObjectId('650000000000000000000031'),
          departmentCatalogId: new Types.ObjectId(CATALOG),
          branchIds: [new Types.ObjectId(B2)],
        }),
      ],
      roles(role(R1, ['employee.view'])),
      [],
      NOW,
    );
    const raw = out.reachByKey.get('employee.view');
    expect([...(raw?.branchIds ?? [])]).toEqual([]);
    expect([...(raw?.homeBranchIds ?? [])]).toEqual([]);
    expect([...(raw?.catalogBranches.get(CATALOG) ?? [])].sort()).toEqual([B1, B2]);
  });

  /**
   * THE PRODUCTION OUTAGE. Grants are loaded `.lean()`, and a lean row written before the reach
   * fields existed has none of them — not `[]`, not `null`: absent. Reading `branchIds.map` on it
   * threw on every login. A row like that is a plain home grant and must be read as one.
   */
  it('reads a row written before the reach fields existed as a plain home grant', () => {
    const legacy = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      roleId: new Types.ObjectId(R1),
      scope: 'branch',
      branchId: new Types.ObjectId(B1),
      departmentId: null,
      sectionId: null,
      validFrom: null,
      validTo: null,
    } as unknown as RoleAssignmentDoc;
    const legacyDepartment = {
      ...legacy,
      _id: new Types.ObjectId(),
      roleId: new Types.ObjectId(R2),
      scope: 'department',
      departmentId: new Types.ObjectId('650000000000000000000031'),
    } as unknown as RoleAssignmentDoc;
    const legacyDelegation = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      branchId: new Types.ObjectId(B2),
      permissionKeys: ['attendance.view'],
      grantedBy: null,
    } as unknown as DelegatedGrantDoc;
    const out = computeEffective(
      [legacy, legacyDepartment],
      roles(role(R1, ['employee.view']), role(R2, ['leave.view'])),
      [legacyDelegation],
      NOW,
    );
    expect(out.permissions).toEqual({ 'employee.view': 'branch', 'leave.view': 'department', 'attendance.view': 'branch' });
    expect(branchesOf(out.reachByKey.get('employee.view'))).toEqual({ listed: [], homes: [B1] });
    expect([...(out.reachByKey.get('leave.view')?.homeDepartmentIds ?? [])]).toEqual(['650000000000000000000031']);
    expect([...(out.reachByKey.get('attendance.view')?.branchIds ?? [])]).toEqual([B2]);
  });

  it('an expired assignment contributes neither scope nor reach', () => {
    const out = computeEffective(
      [assignment(R1, { branchIds: [new Types.ObjectId(B2)], validTo: new Date('2026-01-01') })],
      roles(role(R1, ['employee.view'])),
      [],
      NOW,
    );
    expect(out.permissions).toEqual({});
    expect(out.reachByKey.size).toBe(0);
    expect(out.grants[0]?.state).toBe('expired');
  });
});
