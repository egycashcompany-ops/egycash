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
  okPage(res, await fleetMaintenanceService.list(query), toMaintenanceVisitDto);
};

export const checkInMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CheckInFleetMaintenance>(req);
  const doc = await fleetMaintenanceService.checkIn(body, authContext(req).userId);
  created(res, toMaintenanceVisitDto(doc));
};

export const checkOutMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<CheckOutFleetMaintenance, never, IdParam>(req);
  const doc = await fleetMaintenanceService.checkOut(params.id, body, authContext(req).userId);
  ok(res, toMaintenanceVisitDto(doc));
};

export const reopenMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ReopenFleetMaintenance, never, IdParam>(req);
  const doc = await fleetMaintenanceService.reopen(
    params.id,
    body.version,
    authContext(req).userId,
  );
  ok(res, toMaintenanceVisitDto(doc));
};

export const updateMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetMaintenance, never, IdParam>(req);
  const doc = await fleetMaintenanceService.update(params.id, body, authContext(req).userId);
  ok(res, toMaintenanceVisitDto(doc));
};

export const deleteMaintenance = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetMaintenanceService.softDelete(params.id, authContext(req).userId);
  noContent(res);
};
