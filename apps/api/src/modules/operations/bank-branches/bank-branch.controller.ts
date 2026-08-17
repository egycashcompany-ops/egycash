// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsBankBranch,
  type ListOperationsBankBranchesQuery,
  type UpdateOperationsBankBranch,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toBankBranchDto } from '../operations.mappers';
import { operationsBankBranchService } from './bank-branch.service';

type IdParam = { id: string };

export const listBankBranches = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsBankBranchesQuery>(req);
  okPage(res, await operationsBankBranchService.list(query), toBankBranchDto);
};

export const createBankBranch = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsBankBranch>(req);
  const doc = await operationsBankBranchService.create(body, authContext(req).userId);
  created(res, toBankBranchDto(doc));
};

export const updateBankBranch = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsBankBranch, never, IdParam>(req);
  const doc = await operationsBankBranchService.update(params.id, body, authContext(req).userId);
  ok(res, toBankBranchDto(doc));
};
