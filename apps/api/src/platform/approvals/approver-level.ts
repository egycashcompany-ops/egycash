// Reading a grant back as a LEVEL — the one translation the engine and the permission layer meet at.
//
// A step says «whoever holds this key, at this level, over this unit». A grant says «this account
// holds these keys, at this scope, reaching this far». Both sentences are about the same fact from
// opposite ends, and this file is where one is read as the other. It is pure and separate from the
// query that fetches the grants, because the query is a database detail and this is the rule.
//
// The mapping, and why each line is that line and not a wider one:
//
//   unit          scope `department`, this department, reaching this branch, NOT every branch.
//                 «مدير حركة المهندسين». The exclusion matters: a general manager also reaches
//                 this branch, and if he counted here the rung above him would be his own.
//   department    scope `department`, this department, every branch. «مدير عام الحركة».
//   branch        scope `branch`, reaching this branch — every department in it. «مدير الفرع».
//   organization  scope `organization`. «الموارد البشرية».
//
// A delegated grant reaches three of the four, matching the three shapes a delegation can take
// (ADR-032, Gap 1): one department in one branch is `unit`, one whole branch is `branch`, and one
// department in EVERY branch is `department` — the shape a general manager hands to a deputy, and
// his own reach exactly: «هيدى نفس اللى هو ماسك، ليه، نايب يعتبر». Only `organization` is out of
// reach, because nobody hands down the whole company; that one an administrator assigns.
import { type ApprovalLevel } from '@ecms/contracts';

/** A role assignment, reduced to what the level question needs. */
export interface GrantShape {
  scope: string;
  /** The holder's own branch, which every grant reaches. */
  branchId: string | null;
  /** Branches ADDED to the holder's own. */
  branchIds: readonly string[];
  /** The company-wide department a `department` grant is about. */
  departmentCatalogId: string | null;
  /** The holder's own department, for a grant written before the catalog existed. */
  departmentId: string | null;
  allBranches: boolean;
}

/** The unit a request belongs to: its requester's branch, and the company-wide department. */
export interface Unit {
  branchId: string | null;
  departmentCatalogId: string | null;
  /** This branch's copy of that department, which is what an older grant names. */
  departmentId: string | null;
}

const reachesBranch = (grant: GrantShape, branchId: string | null): boolean => {
  if (grant.allBranches) return true;
  if (branchId === null) return false;
  return grant.branchId === branchId || grant.branchIds.includes(branchId);
};

const namesDepartment = (grant: GrantShape, unit: Unit): boolean => {
  if (grant.departmentCatalogId !== null) return grant.departmentCatalogId === unit.departmentCatalogId;
  // A grant from before the catalog existed names one branch's copy directly.
  return grant.departmentId !== null && grant.departmentId === unit.departmentId;
};

/**
 * Does this grant put its holder on a rung asking for `level` over `unit`?
 *
 * Answered exactly, never by rank — see `levelSatisfied` in `approval-chain`. Somebody with wider
 * authority who wants a rung that is not his goes through the override, and is recorded.
 */
export const grantMeetsLevel = (grant: GrantShape, level: ApprovalLevel, unit: Unit): boolean => {
  switch (level) {
    case 'organization':
      return grant.scope === 'organization';
    case 'branch':
      return grant.scope === 'branch' && reachesBranch(grant, unit.branchId);
    case 'department':
      return grant.scope === 'department' && grant.allBranches && namesDepartment(grant, unit);
    case 'unit':
      return (
        grant.scope === 'department' &&
        !grant.allBranches &&
        namesDepartment(grant, unit) &&
        reachesBranch(grant, unit.branchId)
      );
    default:
      return false;
  }
};

/** A delegated grant, in whichever of its three shapes it was written. */
export interface DelegationShape {
  /** `null` only for the «every branch» shape, which is not about one branch at all. */
  branchId: string | null;
  /** The branch's own copy of a department — `null` for the whole branch. */
  departmentId: string | null;
  /** The company-wide department, set only by the «every branch» shape. */
  departmentCatalogId: string | null;
  allBranches: boolean;
}

/**
 * Does a delegated grant put its holder on the rung?
 *
 * Three of the four levels, one per shape, and each exactly — a deputy who was handed «الحركة في
 * كل الفروع» stands where the general manager stands, because that is precisely what he was
 * handed, while a deputy handed الحركة in one branch does not. Reading the everywhere shape as
 * `unit` too would put him on his own boss's rung AND the one below it, and a chain with both
 * would then be answered twice by one person.
 *
 * `organization` is never satisfied here: nobody hands down the whole company.
 */
export const delegationMeetsLevel = (
  grant: DelegationShape,
  level: ApprovalLevel,
  unit: Unit,
): boolean => {
  if (grant.allBranches) {
    return (
      level === 'department' &&
      grant.departmentCatalogId !== null &&
      grant.departmentCatalogId === unit.departmentCatalogId
    );
  }
  if (unit.branchId === null || grant.branchId !== unit.branchId) return false;
  if (level === 'branch') return grant.departmentId === null;
  if (level === 'unit') return grant.departmentId !== null && grant.departmentId === unit.departmentId;
  return false;
};
