import { type Types } from 'mongoose';
import { type BranchDto, type CreateBranch } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../audit';
import { OrgUnitService } from '../shared/org-unit';
import { assertManagerExists } from '../shared/managers';
import { branchRepository } from './branch.repository';
import { type BranchDoc } from './branch.model';

export const branchService = new OrgUnitService<BranchDoc>('branch', branchRepository, {
  buildCreateExtras: async (raw, id: Types.ObjectId) => {
    const input = raw as CreateBranch;
    return { path: String(id), address: input.address ?? null } as Partial<BranchDoc>;
  },
  // hasChildren is wired by the organization service composition (departments guard).
  assertManagerExists,
  // Branch names are unique (case-insensitive, ar or en) — surfaced to the admin as a conflict.
  assertNameAvailable: async (name, excludeId) => {
    const existing = await branchRepository.findByName(name, excludeId);
    if (existing !== null) throw new ConflictError('A branch with this name already exists');
  },
  // `address` is a per-unit column the generic update does not know about — persist it on edit too.
  buildUpdateSet: (input) =>
    input.address !== undefined ? { address: input.address ?? null } : {},
});

/**
 * Super-admin-only correction of an otherwise-immutable Branch Code (ADR-017). Version-checked;
 * the unique code index rejects duplicates.
 */
export const changeBranchCode = async (
  id: string,
  code: string,
  version: number,
  by: string,
): Promise<BranchDoc> => {
  const before = await branchRepository.getById(id);
  let after: BranchDoc;
  try {
    after = await branchRepository.updateById(id, { code: code.toUpperCase() }, { by, version });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
      throw new ConflictError('branch code already in use');
    }
    throw error;
  }
  await auditService.record({
    entityRef: { moduleId: 'platform', entityType: 'branch', entityId: id },
    action: 'update',
    changes: [{ field: 'code', old: before.code, new: after.code }],
  });

  // NOTHING PROPAGATES FROM HERE, and it is worth saying why, because it used to (HR3-A).
  //
  // While the Employee Code was DERIVED from the branch code, correcting a branch's code left every
  // employee in it carrying a code that derived from nothing, and a seam repaired them. The Employee
  // Code is now COMPOSED ONCE AT HIRE AND FROZEN (ADR-017) — it records which branch issued the
  // number, not which code that branch currently goes by. So an employee hired under `010` keeps
  // `010…` after the branch is renamed to `015`, exactly as they keep it after being transferred
  // somewhere else entirely. There is no stale value left to repair, and re-deriving one would
  // rename people whose code is printed on contracts and insurance filings.
  //
  // The branch's own audit entry above is the record that the code changed.
  if (before.code !== after.code) {
    logger.info(
      { branchId: id, oldCode: before.code, newCode: after.code },
      'branch code changed; employee codes are frozen at hire and are deliberately left alone',
    );
  }
  return after;
};

export const toBranchDto = (doc: BranchDoc): BranchDto => ({
  ...branchService.baseDto(doc),
  address: doc.address,
});
