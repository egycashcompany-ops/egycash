// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type FleetViolationRollupQuery,
  type ListFleetViolationsQuery,
  type RecordFleetDriverViolation,
  type RecordFleetVehicleViolation,
  type SetFleetGrievance,
  type UpdateFleetViolation,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toGrievanceDto, toViolationDto } from '../fleet.mappers';
import { fleetViolationService } from './violation.service';

type IdParam = { id: string };

export const listViolations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetViolationsQuery>(req);
  okPage(res, await fleetViolationService.list(query), toViolationDto);
};

export const getViolationRollup = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetViolationRollupQuery>(req);
  ok(res, await fleetViolationService.rollup(query.year, query.vehicleId));
};

export const recordVehicleViolation = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetVehicleViolation>(req);
  const doc = await fleetViolationService.recordVehicle(body, authContext(req).userId);
  created(res, toViolationDto(doc));
};

export const recordDriverViolation = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetDriverViolation>(req);
  const doc = await fleetViolationService.recordDriver(body, authContext(req).userId);
  created(res, toViolationDto(doc));
};

export const updateViolation = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetViolation, never, IdParam>(req);
  const doc = await fleetViolationService.update(params.id, body, authContext(req).userId);
  ok(res, toViolationDto(doc));
};

export const setGrievance = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<SetFleetGrievance>(req);
  const doc = await fleetViolationService.setGrievance(body, authContext(req).userId);
  ok(res, toGrievanceDto(doc));
};

export const deleteViolation = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetViolationService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};
