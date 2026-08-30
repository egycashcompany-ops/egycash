// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetAccident,
  type FleetAccidentSummaryQuery,
  type ListFleetAccidentsQuery,
  type SetFleetAccidentStatus,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAccidentDto } from '../fleet.mappers';
import { fleetAccidentService } from './accident.service';

type IdParam = { id: string };

export const listAccidents = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetAccidentsQuery>(req);
  okPage(res, await fleetAccidentService.list(query), toAccidentDto);
};

export const accidentSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetAccidentSummaryQuery>(req);
  ok(res, await fleetAccidentService.summary(query));
};

export const createAccident = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetAccident>(req);
  const doc = await fleetAccidentService.create(body, authContext(req).userId);
  created(res, toAccidentDto(doc));
};

export const updateAccident = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetAccident, never, IdParam>(req);
  const doc = await fleetAccidentService.update(params.id, body, authContext(req).userId);
  ok(res, toAccidentDto(doc));
};

export const setAccidentStatus = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SetFleetAccidentStatus, never, IdParam>(req);
  const doc = await fleetAccidentService.setStatus(params.id, body, authContext(req).userId);
  ok(res, toAccidentDto(doc));
};

export const deleteAccident = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetAccidentService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};
