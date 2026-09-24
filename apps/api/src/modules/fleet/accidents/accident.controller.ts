// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetAccident,
  type FleetAccidentSummaryQuery,
  type FleetAccidentTransfersQuery,
  type ListFleetAccidentsQuery,
  type SetFleetAccidentStatus,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toAccidentDto, vehicleIdsOf } from '../fleet.mappers';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetAccidentService } from './accident.service';
import { fleetAccidentRepository } from './accident.repository';

type IdParam = { id: string };
type TransferParam = { id: string; transferId: string };

export const listAccidents = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetAccidentsQuery>(req);
  // The codes for the cars ON this page, in one read — a file kept from the old book for a car
  // the registry never had carries its own code and needs no lookup.
  const page = await fleetAccidentService.list(query);
  const codes = await fleetVehicleRepository.codesByIds(vehicleIdsOf(page.items));
  // Which of these cars have a transfer on their log — the row's «السجل» button turns yellow.
  const withTransfers = await fleetAccidentRepository.carsWithTransfers(
    [...codes.keys()],
    [...codes.values()],
  );
  okPage(res, page, (doc) => {
    const code = codes.get(String(doc.vehicleId)) ?? null;
    const carHasTransfers =
      (doc.vehicleId !== null && withTransfers.ids.has(String(doc.vehicleId))) ||
      (code !== null && withTransfers.codes.has(code)) ||
      (doc.vehicleCode !== null && withTransfers.codes.has(doc.vehicleCode));
    return toAccidentDto(doc, code, carHasTransfers);
  });
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

export const carTransfers = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetAccidentTransfersQuery>(req);
  ok(res, await fleetAccidentService.carTransfers(query.vehicleId));
};

export const voidTransfer = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, TransferParam>(req);
  await fleetAccidentService.voidTransfer(params.id, params.transferId, authContext(req).userId);
  noContent(res);
};
