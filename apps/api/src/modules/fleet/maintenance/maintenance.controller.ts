// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type ListFleetMaintenanceQuery,
  type ReopenFleetMaintenance,
  type UpdateFleetMaintenance,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { toMaintenanceVisitDto } from '../fleet.mappers';
import { fleetMaintenanceService } from './maintenance.service';

type IdParam = { id: string };

export const listMaintenanceVisits = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetMaintenanceQuery>(req);
  const page = await fleetMaintenanceService.list(query);
  okPage(res, page, (row) =>
    toMaintenanceVisitDto(row, {
      vehicleCode: page.codes.get(String(row.vehicleId)) ?? null,
    }),
  );
};

export const checkInMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CheckInFleetMaintenance>(req);
  const { doc, ...joins } = await fleetMaintenanceService.checkIn(body, authContext(req).userId);
  created(res, toMaintenanceVisitDto(doc, joins));
};

export const checkOutMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CheckOutFleetMaintenance, never, IdParam>(req);
  const { doc, ...joins } = await fleetMaintenanceService.checkOut(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toMaintenanceVisitDto(doc, joins));
};

export const reopenMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReopenFleetMaintenance, never, IdParam>(req);
  const { doc, ...joins } = await fleetMaintenanceService.reopen(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toMaintenanceVisitDto(doc, joins));
};

export const updateMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetMaintenance, never, IdParam>(req);
  const { doc, ...joins } = await fleetMaintenanceService.update(
    params.id,
    body,
    authContext(req).userId,
  );
  ok(res, toMaintenanceVisitDto(doc, joins));
};

export const deleteMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetMaintenanceService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};
