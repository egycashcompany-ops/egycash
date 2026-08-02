// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetUnavailability,
  type ListFleetUnavailabilityQuery,
  type UpdateFleetUnavailability,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toUnavailabilityDto } from '../fleet.mappers';
import { fleetUnavailabilityService } from './unavailability.service';

type IdParam = { id: string };

export const listUnavailability = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetUnavailabilityQuery>(req);
  okPage(res, await fleetUnavailabilityService.list(query), toUnavailabilityDto);
};

export const createUnavailability = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetUnavailability>(req);
  const doc = await fleetUnavailabilityService.create(body, authContext(req).userId);
  created(res, toUnavailabilityDto(doc));
};

export const updateUnavailability = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetUnavailability, never, IdParam>(req);
  const doc = await fleetUnavailabilityService.update(params.id, body, authContext(req).userId);
  ok(res, toUnavailabilityDto(doc));
};

export const cancelUnavailability = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetUnavailabilityService.cancel(params.id, authContext(req).userId);
  noContent(res);
};
