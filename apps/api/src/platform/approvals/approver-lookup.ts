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
// four rungs; a delegation only on the two it can express (ADR-032, Gap 1).
import { Types } from 'mongoose';
import { type ApprovalLevel } from '@ecms/contracts';
import { roleAssignmentRepository, roleRepository } from '../rbac/rbac.repository';
import { delegatedGrantRepository } from '../rbac/delegation.repository';
import { delegationMeetsLevel, grantMeetsLevel, type Unit } from './approver-level';

export type { Unit } from './approver-level';

/** The accounts standing on one rung, in no particular order and without duplicates. */
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

  // A delegation is always written in one branch, so a request with no branch has none to read.
  if (unit.branchId !== null && (level === 'unit' || level === 'branch')) {
    const grants = await delegatedGrantRepository.findByKeyInBranch(permissionKey, unit.branchId);
    for (const g of grants) {
      const shape = {
        branchId: String(g.branchId),
        departmentId: g.departmentId === null ? null : String(g.departmentId),
      };
      if (delegationMeetsLevel(shape, level, unit)) found.add(String(g.userId));
    }
  }

  return [...found];
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
