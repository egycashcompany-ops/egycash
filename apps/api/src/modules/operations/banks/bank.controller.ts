// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsBank,
  type ListOperationsReferenceQuery,
  type UpdateOperationsBank,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toBankDto } from '../operations.mappers';
import { operationsBankService } from './bank.service';

type IdParam = { id: string };

export const listBanks = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsReferenceQuery>(req);
  okPage(res, await operationsBankService.list(query), toBankDto);
};

export const createBank = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsBank>(req);
  const doc = await operationsBankService.create(body, authContext(req).userId);
  created(res, toBankDto(doc));
};

export const updateBank = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsBank, never, IdParam>(req);
  const doc = await operationsBankService.update(params.id, body, authContext(req).userId);
  ok(res, toBankDto(doc));
};
