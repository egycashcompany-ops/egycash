import { type Request, type Response } from 'express';
import { type BranchDto, type ChangeBranchCode } from '@ecms/contracts';
import { CreateBranchSchema, UpdateBranchSchema } from './branch.validation';
import { makeOrgUnitHandlers, type OrgUnitHttpConfig } from '../shared/org-unit.http';
import { ok } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { ForbiddenError } from '../../../shared/errors';
import { authContext } from '../../auth';
import { branchService, changeBranchCode, toBranchDto } from './branch.service';
import { type BranchDoc } from './branch.model';

export const branchHttpConfig: OrgUnitHttpConfig<BranchDoc, BranchDto> = {
  resource: 'branch',
  service: branchService,
  toDto: toBranchDto,
  createSchema: CreateBranchSchema,
  updateSchema: UpdateBranchSchema,
  basePath: '/api/v1/platform/branches',
};

export const branchHandlers = makeOrgUnitHandlers(branchHttpConfig);

/** Super-admin-only Branch Code correction (ADR-017): privileged callers only. */
export const changeBranchCodeHandler = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  if (!ctx.isPrivileged) {
    throw new ForbiddenError('only a super-admin may change a branch code');
  }
  const { body, params } = validated<ChangeBranchCode, never, { id: string }>(req);
  ok(res, toBranchDto(await changeBranchCode(params.id, body.code, body.version, ctx.userId)));
};
