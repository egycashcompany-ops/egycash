import { type Request, type Response } from 'express';
import {
  type CreateCostCenter,
  type ListOrgUnitsQuery,
  type UpdateCostCenter,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../auth';
import { costCenterService } from './cost-center.service';

type IdParam = { id: string };

export const listCostCenters = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListOrgUnitsQuery>(req);
  const page = await costCenterService.list(query, scopeSelector(ctx, 'costCenter.view'));
  okPage(res, page, (doc) => costCenterService.toDto(doc));
};

export const getCostCenter = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, costCenterService.toDto(await costCenterService.getById(params.id)));
};

export const createCostCenter = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateCostCenter>(req);
  const doc = await costCenterService.create(body, ctx.userId);
  created(res, costCenterService.toDto(doc), `/api/v1/platform/cost-centers/${String(doc._id)}`);
};

export const updateCostCenter = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateCostCenter, never, IdParam>(req);
  ok(res, costCenterService.toDto(await costCenterService.update(params.id, body, ctx.userId)));
};

export const deleteCostCenter = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await costCenterService.softDelete(params.id, ctx.userId);
  noContent(res);
};
