import { type Types } from 'mongoose';
import { type BranchDto, type CreateBranch } from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
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
  return after;
};

export const toBranchDto = (doc: BranchDoc): BranchDto => ({
  ...branchService.baseDto(doc),
  address: doc.address,
});
