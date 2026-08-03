// Thin HTTP mapping only (ADR-003). The DTO carries the fleet-owned facts plus the employeeId
// join key; personal data is fetched by the frontend from HR with HR's own permissions.
import { type Request, type Response } from 'express';
import {
  type CreateFleetDriverProfile,
  type ListFleetDriversQuery,
  type UpdateFleetDriverProfile,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toDriverProfileDto } from '../fleet.mappers';
import { fleetDriverProfileService } from './driver-profile.service';

type IdParam = { id: string };

export const listDriverProfiles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetDriversQuery>(req);
  okPage(res, await fleetDriverProfileService.list(query), toDriverProfileDto);
};

export const getDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toDriverProfileDto(await fleetDriverProfileService.getById(params.id)));
};

export const createDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetDriverProfile>(req);
  const doc = await fleetDriverProfileService.create(body, authContext(req).userId);
  created(res, toDriverProfileDto(doc));
};

export const updateDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetDriverProfile, never, IdParam>(req);
  const doc = await fleetDriverProfileService.update(params.id, body, authContext(req).userId);
  ok(res, toDriverProfileDto(doc));
};
