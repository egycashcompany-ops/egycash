// Thin HTTP mapping only (ADR-003) — validation lives in the routes, rules in the service.
import { type Request, type Response } from 'express';
import {
  type CreateFleetVehicleType,
  type PaginationQuery,
  type UpdateFleetVehicleType,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toVehicleTypeDto } from '../fleet.mappers';
import { fleetVehicleTypeService } from './vehicle-type.service';

type IdParam = { id: string };

export const listVehicleTypes = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, PaginationQuery>(req);
  okPage(res, await fleetVehicleTypeService.list(query), toVehicleTypeDto);
};

export const getVehicleType = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toVehicleTypeDto(await fleetVehicleTypeService.getById(params.id)));
};

export const createVehicleType = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetVehicleType>(req);
  const doc = await fleetVehicleTypeService.create(body, authContext(req).userId);
  created(res, toVehicleTypeDto(doc));
};

export const updateVehicleType = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetVehicleType, never, IdParam>(req);
  const doc = await fleetVehicleTypeService.update(params.id, body, authContext(req).userId);
  ok(res, toVehicleTypeDto(doc));
};
