// Thin HTTP mapping only (ADR-003). Data scopes resolve per permission at the boundary and are
// passed down; the DERIVED `inWorkshop` flag is computed here from the service seam (FR-12) so
// the stored document never carries it.
import { type Request, type Response } from 'express';
import {
  type ChangeFleetVehicleStatus,
  type CreateFleetVehicle,
  type ListFleetVehiclesQuery,
  type UpdateFleetVehicle,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { toVehicleDto } from '../fleet.mappers';
import { fleetVehicleService } from './vehicle.service';
import { type FleetVehicleDoc } from './vehicle.model';

type IdParam = { id: string };

const respondOne = async (res: Response, doc: FleetVehicleDoc, status = 200): Promise<void> => {
  const open = await fleetVehicleService.openVisitVehicleIds([String(doc._id)]);
  const dto = toVehicleDto(doc, open.has(String(doc._id)));
  if (status === 201) created(res, dto);
  else ok(res, dto);
};

export const listVehicles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetVehiclesQuery>(req);
  const scope = scopeSelector(authContext(req), 'fleetVehicle.view');
  const page = await fleetVehicleService.list(query, scope);
  const open = await fleetVehicleService.openVisitVehicleIds(
    page.items.map((doc) => String(doc._id)),
  );
  okPage(res, page, (doc) => toVehicleDto(doc, open.has(String(doc._id))));
};

export const getVehicle = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const scope = scopeSelector(authContext(req), 'fleetVehicle.view');
  await respondOne(res, await fleetVehicleService.getById(params.id, scope));
};

export const createVehicle = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetVehicle>(req);
  const doc = await fleetVehicleService.create(body, authContext(req).userId);
  await respondOne(res, doc, 201);
};

export const updateVehicle = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetVehicle, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await fleetVehicleService.update(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'fleetVehicle.edit'),
  );
  await respondOne(res, doc);
};

export const changeVehicleStatus = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<ChangeFleetVehicleStatus, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await fleetVehicleService.changeStatus(
    params.id,
    body,
    ctx.userId,
    scopeSelector(ctx, 'fleetVehicle.changeStatus'),
  );
  await respondOne(res, doc);
};

export const deleteVehicle = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await fleetVehicleService.softDelete(
    params.id,
    ctx.userId,
    scopeSelector(ctx, 'fleetVehicle.delete'),
  );
  noContent(res);
};
