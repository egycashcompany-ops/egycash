// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type FleetViolationRollupQuery,
  type ListFleetViolationsQuery,
  type RecordFleetDriverViolation,
  type RecordFleetDriverViolations,
  type RecordFleetVehicleViolation,
  type SetFleetGrievance,
  type SetFleetViolationCollected,
  type MoveFleetViolations,
  type SetRollupCollected,
  type UpdateFleetViolation,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toGrievanceDto, toViolationDto, vehicleIdsOf } from '../fleet.mappers';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetViolationService } from './violation.service';

type IdParam = { id: string };

export const listViolations = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetViolationsQuery>(req);
  // The codes for the cars ON this page, in one read — a row kept from the old book for a car
  // the registry never had carries its own code and needs no lookup.
  const page = await fleetViolationService.list(query);
  const codes = await fleetVehicleRepository.codesByIds(vehicleIdsOf(page.items));
  okPage(res, page, (doc) => toViolationDto(doc, codes.get(String(doc.vehicleId)) ?? null));
};

export const getViolationRollup = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetViolationRollupQuery>(req);
  ok(res, await fleetViolationService.rollup(query.year, query.vehicleId, query.vehicleCodes));
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

export const recordDriverViolations = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetDriverViolations>(req);
  const docs = await fleetViolationService.recordDriverBatch(body, authContext(req).userId);
  created(res, docs.map((doc) => toViolationDto(doc)));
};

/** Carry several driver fines onto one car's year-block — one act, one transaction. */
export const moveViolations = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<MoveFleetViolations>(req);
  const moved = await fleetViolationService.move(body, authContext(req).userId);
  ok(res, { moved });
};

export const setRollupCollected = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<SetRollupCollected>(req);
  const changed = await fleetViolationService.setCollectedForYear(body, ctx.userId);
  ok(res, { changed });
};

export const setViolationCollected = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SetFleetViolationCollected, never, IdParam>(req);
  const doc = await fleetViolationService.setCollected(params.id, body, authContext(req).userId);
  ok(res, toViolationDto(doc));
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
