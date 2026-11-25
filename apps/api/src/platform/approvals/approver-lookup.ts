// «Who is on this rung?» — asked of the permission layer, never of a stored list.
//
// The engine holds no approvers. It holds a key and a level, and every time it needs a name it
// goes and looks, so the answer follows the org: somebody promoted this morning is on the rung this
// afternoon, somebody who left is off it, and a delegation a manager wrote an hour ago counts.
// A workflow that stored people would be stale the first time anybody changed jobs, and would then
// route requests to a desk nobody sits at — silently, because a stale name looks exactly like a
// current one.
//
// Two sources, and both of them, because the owner named both: «المرجع الأساسي يكون Department +
// Branch + Role/Scope + Delegated Permissions». A role assignment can put somebody on any of the
// four rungs; a delegation on the three its own shapes can express (ADR-032, Gap 1).
//
// Who counts is the same at both ends: a grant in force now, held by an account that can sign in.
// A grant before its `validFrom` or past its `validTo` gives no authority anywhere else in the
// platform, and a suspended or archived account opens no session, so neither stands on a rung
// (ADR-041 decisions 5 and 8). The reader's own end checks only the first: authentication refuses
// every request from an account that is not active, so none reaches it.
import { Types } from 'mongoose';
import { type ApprovalLevel } from '@ecms/contracts';
import { roleAssignmentRepository, roleRepository } from '../rbac/rbac.repository';
import { delegatedGrantRepository } from '../rbac/delegation.repository';
import { type DelegatedGrantDoc } from '../rbac/delegation.model';
import { userRepository } from '../users/user.repository';
import { delegationMeetsLevel, grantMeetsLevel, type Unit } from './approver-level';

export type { Unit } from './approver-level';

/**
 * The accounts standing on one rung, in no particular order and without duplicates.
 *
 * Only `active` accounts, read through `activeIdsAmong`, the predicate the last-Super-Admin guard
 * and sign-in share (ADR-026 SA-6). An archived or suspended account keeps its role assignments and
 * delegations by design, so the grants alone would keep it on the rung: the chain would wait on it,
 * notify it and never step over it, although nobody can sign in as it to decide.
 */
export const approversFor = async (
  permissionKey: string,
  level: ApprovalLevel,
  unit: Unit,
): Promise<string[]> => {
  const found = new Set<string>();

  const roles = await roleRepository.findGrantingPermission(permissionKey);
  const assignments = await roleAssignmentRepository.findActiveForRoles(
    roles.map((role) => new Types.ObjectId(String(role._id))),
  );
  for (const a of assignments) {
    const shape = {
      scope: String(a.scope),
      branchId: a.branchId === null ? null : String(a.branchId),
      branchIds: (a.branchIds ?? []).map(String),
      departmentCatalogId: a.departmentCatalogId === null ? null : String(a.departmentCatalogId),
      departmentId: a.departmentId === null ? null : String(a.departmentId),
      allBranches: a.allBranches === true,
    };
    if (grantMeetsLevel(shape, level, unit)) found.add(String(a.userId));
  }

  // Two reads rather than one, because the two delegation shapes are stored under different keys
  // and neither index can serve the other: a branch grant has a branch to look under, and an
  // «every branch» grant deliberately has none. Each is asked only for the levels it can answer,
  // so no rung costs a query that cannot return anybody.
  const delegations: DelegatedGrantDoc[] = [];
  if (unit.branchId !== null && (level === 'unit' || level === 'branch')) {
    delegations.push(
      ...(await delegatedGrantRepository.findByKeyInBranch(permissionKey, unit.branchId)),
    );
  }
  if (level === 'department' && unit.departmentCatalogId !== null) {
    delegations.push(
      ...(await delegatedGrantRepository.findByKeyForDepartmentEverywhere(
        permissionKey,
        unit.departmentCatalogId,
      )),
    );
  }
  for (const g of delegations) {
    const shape = {
      branchId: g.branchId === null ? null : String(g.branchId),
      departmentId: g.departmentId === null ? null : String(g.departmentId),
      departmentCatalogId: g.departmentCatalogId === null ? null : String(g.departmentCatalogId),
      allBranches: g.allBranches === true,
    };
    if (delegationMeetsLevel(shape, level, unit)) found.add(String(g.userId));
  }

  // One id-only read for every holder found, by assignment or delegation alike: the account's
  // status is the same question whichever grant put it here.
  return userRepository.activeIdsAmong([...found]);
};

/**
 * Is there anybody at all on this rung?
 *
 * Its own function rather than `approversFor(...).length > 0` at the call site, because the two
 * questions are asked in different places for different reasons — this one decides whether a rung
 * is stepped over, and it is asked about every rung of a chain on every read of a request. The
 * caller memoizes per (key, level) within one resolution; see `approval.service`.
 */
export const hasApprovers = async (
  permissionKey: string,
  level: ApprovalLevel,
  unit: Unit,
): Promise<boolean> => (await approversFor(permissionKey, level, unit)).length > 0;

/**
 * The rungs of one chain that ONE account stands on — the reader's own steps.
 *
 * Asked from the other end than `approversFor`, and deliberately so. A screen showing a request
 * asks «what may I do here», and answering it by fanning out every rung to every holder in the
 * company and then looking for one name in the result would make one man's inbox cost the whole
 * org chart. This reads his own grants once — his role assignments, the roles behind them, his
 * delegations — and measures each rung against them, so the cost is three queries whatever the
 * chain's length.
 */
export const ownStepsOf = async (
  userId: string,
  steps: readonly { permissionKey: string; level: ApprovalLevel }[],
  unit: Unit,
): Promise<number[]> => {
  if (steps.length === 0) return [];
  // Grants in force only: the window RBAC's effective permissions apply, and the one staffing
  // already reads (`findActiveForRoles`). `findActiveForUser` also returns a grant that has ended
  // or not yet started, which SA-4's screen lists to explain it; read here, such a grant would still
  // decide, on its own rung or early over the rungs below it. Delegations carry no validity window,
  // so their read is unchanged.
  const assignments = await roleAssignmentRepository.findInForceForUsers([
    new Types.ObjectId(userId),
  ]);
  const roles = await roleRepository.findByIds(
    assignments.map((a) => new Types.ObjectId(String(a.roleId))),
  );
  const keysByRole = new Map(
    roles.map((role) => [String(role._id), new Set(role.permissionKeys ?? [])]),
  );
  const delegations = await delegatedGrantRepository.findForUser(userId);

  const standsOn = (permissionKey: string, level: ApprovalLevel): boolean => {
    for (const a of assignments) {
      if (keysByRole.get(String(a.roleId))?.has(permissionKey) !== true) continue;
      const shape = {
        scope: String(a.scope),
        branchId: a.branchId === null ? null : String(a.branchId),
        branchIds: (a.branchIds ?? []).map(String),
        departmentCatalogId: a.departmentCatalogId === null ? null : String(a.departmentCatalogId),
        departmentId: a.departmentId === null ? null : String(a.departmentId),
        allBranches: a.allBranches === true,
      };
      if (grantMeetsLevel(shape, level, unit)) return true;
    }
    for (const g of delegations) {
      if (!(g.permissionKeys ?? []).includes(permissionKey)) continue;
      const shape = {
        branchId: g.branchId === null ? null : String(g.branchId),
        departmentId: g.departmentId === null ? null : String(g.departmentId),
        departmentCatalogId: g.departmentCatalogId === null ? null : String(g.departmentCatalogId),
        allBranches: g.allBranches === true,
      };
      if (delegationMeetsLevel(shape, level, unit)) return true;
    }
    return false;
  };

  return steps.flatMap((step, index) => (standsOn(step.permissionKey, step.level) ? [index] : []));
};
