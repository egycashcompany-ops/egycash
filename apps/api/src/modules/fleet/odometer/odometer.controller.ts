// Thin HTTP mapping only (ADR-003). All arithmetic — km, expected reading, alarms — is the
// service's; nothing here computes (owner FL-4 point 3).
import { type Request, type Response } from 'express';
import {
  type CorrectFleetOdometer,
  type FleetVehicleIdQuery,
  type ListFleetOdometerQuery,
  type RecordFleetOdometer,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toOdometerLogDto } from '../fleet.mappers';
import { computeAlarms } from '../maintenance/maintenance-alarm';
import { fleetOdometerService } from './odometer.service';

type IdParam = { id: string };

export const listOdometerLogs = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetOdometerQuery>(req);
  okPage(res, await fleetOdometerService.list(query), toOdometerLogDto);
};

export const recordOdometer = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<RecordFleetOdometer>(req);
  const doc = await fleetOdometerService.record(body, authContext(req).userId);
  created(res, toOdometerLogDto(doc));
};

export const expectedOdometerReading = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetVehicleIdQuery>(req);
  ok(res, {
    vehicleId: query.vehicleId,
    expectedReading: await fleetOdometerService.expectedReading(query.vehicleId),
  });
};

export const listMaintenanceAlarms = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await computeAlarms());
};

export const correctOdometer = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CorrectFleetOdometer, never, IdParam>(req);
  const doc = await fleetOdometerService.correct(params.id, body, authContext(req).userId);
  ok(res, toOdometerLogDto(doc));
};
