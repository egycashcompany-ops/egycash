// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsArea,
  type ListOperationsReferenceQuery,
  type UpdateOperationsArea,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAreaDto } from '../operations.mappers';
import { operationsAreaService } from './area.service';

type IdParam = { id: string };

export const listAreas = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsReferenceQuery>(req);
  okPage(res, await operationsAreaService.list(query), toAreaDto);
};

export const createArea = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsArea>(req);
  const doc = await operationsAreaService.create(body, authContext(req).userId);
  created(res, toAreaDto(doc));
};

export const updateArea = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsArea, never, IdParam>(req);
  const doc = await operationsAreaService.update(params.id, body, authContext(req).userId);
  ok(res, toAreaDto(doc));
};
