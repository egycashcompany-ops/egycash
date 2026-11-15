// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateOperationsShiftType,
  type ListOperationsReferenceQuery,
  type OrderOperationsShiftTypes,
  type UpdateOperationsShiftType,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toShiftTypeDto } from '../operations.mappers';
import { operationsShiftTypeService } from './shift-type.service';

type IdParam = { id: string };

export const listShiftTypes = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListOperationsReferenceQuery>(req);
  okPage(res, await operationsShiftTypeService.list(query), toShiftTypeDto);
};

export const createShiftType = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateOperationsShiftType>(req);
  const doc = await operationsShiftTypeService.create(body, authContext(req).userId);
  created(res, toShiftTypeDto(doc));
};

export const updateShiftType = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateOperationsShiftType, never, IdParam>(req);
  const doc = await operationsShiftTypeService.update(params.id, body, authContext(req).userId);
  ok(res, toShiftTypeDto(doc));
};

/** The catalog's dragged order; 204, the currencies' answer. */
export const orderShiftTypes = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<OrderOperationsShiftTypes>(req);
  await operationsShiftTypeService.order(body, authContext(req).userId);
  noContent(res);
};
