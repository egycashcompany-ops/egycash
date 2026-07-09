import { type Types } from 'mongoose';
import { type BranchDto, type CreateBranch } from '@ecms/contracts';
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
});

export const toBranchDto = (doc: BranchDoc): BranchDto => ({
  ...branchService.baseDto(doc),
  address: doc.address,
});
