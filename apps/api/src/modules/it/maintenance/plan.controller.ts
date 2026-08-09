import { type Request, type Response } from 'express';
import {
  type CreateItMaintenancePlan,
  type ListItMaintenancePlansQuery,
  type UpdateItMaintenancePlan,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toItMaintenancePlanDto } from '../it.mappers';
import { itMaintenancePlanService } from './plan.service';

type IdParam = { id: string };

export const listItMaintenancePlans = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItMaintenancePlansQuery>(req);
  okPage(res, await itMaintenancePlanService.list(query), toItMaintenancePlanDto);
};

export const getItMaintenancePlan = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItMaintenancePlanDto(await itMaintenancePlanService.getById(params.id)));
};

export const createItMaintenancePlan = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItMaintenancePlan>(req);
  const doc = await itMaintenancePlanService.create(body, authContext(req));
  created(res, toItMaintenancePlanDto(doc));
};

export const updateItMaintenancePlan = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateItMaintenancePlan, never, IdParam>(req);
  const doc = await itMaintenancePlanService.update(params.id, body, authContext(req));
  ok(res, toItMaintenancePlanDto(doc));
};

export const activateItMaintenancePlan = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await itMaintenancePlanService.setActive(params.id, true, authContext(req));
  ok(res, toItMaintenancePlanDto(doc));
};

export const deactivateItMaintenancePlan = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await itMaintenancePlanService.setActive(params.id, false, authContext(req));
  ok(res, toItMaintenancePlanDto(doc));
};
