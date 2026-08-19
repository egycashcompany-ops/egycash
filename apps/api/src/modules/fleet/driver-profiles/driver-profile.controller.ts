// Thin HTTP mapping only (ADR-003). The DTO carries the fleet-owned facts plus the employeeId
// join key; personal data is fetched by the frontend from HR with HR's own permissions.
import { type Request, type Response } from 'express';
import {
  type CreateFleetDriverProfile,
  type ListFleetDriversQuery,
  type UpdateFleetDriverProfile,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { toDriverProfileDto } from '../fleet.mappers';
import { fleetDriverProfileService } from './driver-profile.service';

type IdParam = { id: string };

export const listDriverProfiles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetDriversQuery>(req);
  okPage(res, await fleetDriverProfileService.list(query), toDriverProfileDto);
};

export const getDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toDriverProfileDto(await fleetDriverProfileService.getById(params.id)));
};

export const createDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetDriverProfile>(req);
  const doc = await fleetDriverProfileService.create(body, authContext(req).userId);
  created(res, toDriverProfileDto(doc));
};

export const updateDriverProfile = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetDriverProfile, never, IdParam>(req);
  const doc = await fleetDriverProfileService.update(params.id, body, authContext(req).userId);
  ok(res, toDriverProfileDto(doc));
};

export const uploadDriverLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  // Multer put the part on the request; a caller who forgot the field gets a named 400 rather
  // than a crash on `.buffer`. `ValidationError`, not a hand-rolled AppError: a malformed request
  // is a 400 everywhere else in the platform, and 422 is reserved for a well-formed request that
  // breaks a business rule (which is what the file category's mime and size refusals are).
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const doc = await fleetDriverProfileService.setLicenseImage(ctx, params.id, {
    originalName: uploaded.originalname,
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toDriverProfileDto(doc));
};

/**
 * The bytes themselves, not a signed URL: the file is GUARDED by fleet's ADR-023 authorizer, and a
 * guarded file's signed URL requires a bearer token that an `<img src>` cannot carry. Streaming
 * through the authenticated endpoint is what lets the registry actually display the image.
 */
export const getDriverLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const image = await fleetDriverProfileService.readLicenseImage(authContext(req), params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  // Private document: no shared cache may keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteDriverLicenseImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await fleetDriverProfileService.deleteLicenseImage(authContext(req), params.id);
  ok(res, toDriverProfileDto(doc));
};
