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
import { ValidationError } from '../../../shared/errors';
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

/** The create form's branch default (§2.1) — live data, resolved by name from the setting. */
export const getDefaultBranch = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await fleetVehicleService.defaultBranch());
};

export const uploadVehicleLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  // Multer put the part on the request; a caller who forgot the field gets a named 422 rather
  // than a crash on `.buffer`.
  const uploaded = req.file;
  if (uploaded === undefined) {
    // `ValidationError`, not a hand-rolled AppError: a malformed request is a 400 everywhere else
    // in the platform, and 422 is reserved for a well-formed request that breaks a business rule
    // (which is what the file category's mime and size refusals are).
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const doc = await fleetVehicleService.setLicenseImage(
    ctx,
    params.id,
    {
      originalName: uploaded.originalname,
      mime: uploaded.mimetype,
      size: uploaded.size,
      buffer: uploaded.buffer,
    },
    scopeSelector(ctx, 'fleetVehicle.edit'),
  );
  await respondOne(res, doc);
};

/**
 * The bytes themselves, not a signed URL: the file is GUARDED by fleet's ADR-023 authorizer, and a
 * guarded file's signed URL requires a bearer token that an `<img src>` cannot carry. Streaming
 * through the authenticated endpoint is what lets the registry actually display the image.
 */
export const getVehicleLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const image = await fleetVehicleService.readLicenseImage(
    ctx,
    params.id,
    scopeSelector(ctx, 'fleetVehicle.view'),
  );
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  // Private document: no shared cache may keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteVehicleLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  const doc = await fleetVehicleService.deleteLicenseImage(
    ctx,
    params.id,
    scopeSelector(ctx, 'fleetVehicle.edit'),
  );
  await respondOne(res, doc);
};
