import { CreateBranchSchema, UpdateBranchSchema } from './branch.validation';
import { makeOrgUnitHandlers, type OrgUnitHttpConfig } from '../shared/org-unit.http';
import { branchService, toBranchDto } from './branch.service';
import { type BranchDoc } from './branch.model';
import { type BranchDto } from '@ecms/contracts';

export const branchHttpConfig: OrgUnitHttpConfig<BranchDoc, BranchDto> = {
  resource: 'branch',
  service: branchService,
  toDto: toBranchDto,
  createSchema: CreateBranchSchema,
  updateSchema: UpdateBranchSchema,
  basePath: '/api/v1/platform/branches',
};

export const branchHandlers = makeOrgUnitHandlers(branchHttpConfig);
