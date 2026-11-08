// Thin HTTP mapping only (ADR-003) for the vehicle device checks (FR-21), plus the photo's
// multipart intake — IT's single-file intake (`signedCopyUpload`), one file under the field `file`.
import { type Request, type Response } from 'express';
import {
  type CreateItVehicleCheck,
  type ItVehicleOptionDto,
  type PaginationQuery,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { toItVehicleCheckDto } from '../it.mappers';
import { itVehicleCheckService } from './vehicle-check.service';

type IdParam = { id: string };
type PhotoFields = { clientPhotoId: string };

/** «كود السيارة» — one page of the active cars, in Fleet's code order. */
export const listItVehicleCheckCars = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, PaginationQuery>(req);
  const page = await itVehicleCheckService.listActiveVehicleCodes(query);
  okPage(res, page, (car): ItVehicleOptionDto => ({ id: car.id, code: car.code }));
};

/** «إرسال التقرير» — 201 for a new report, 200 for the one this request id already filed. */
export const fileItVehicleCheck = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateItVehicleCheck>(req);
  const filing = await itVehicleCheckService.file(body, authContext(req));
  const dto = toItVehicleCheckDto(filing.report);
  if (filing.created) created(res, dto);
  else ok(res, dto);
};

/** One photo onto one's own report; a `clientPhotoId` already on it adds nothing (200). */
export const addItVehicleCheckPhoto = async (req: Request, res: Response): Promise<void> => {
  const { params, body } = validated<PhotoFields, never, IdParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const report = await itVehicleCheckService.addPhoto(
    authContext(req),
    params.id,
    body.clientPhotoId,
    {
      originalName: uploaded.originalname,
      mime: uploaded.mimetype,
      size: uploaded.size,
      buffer: uploaded.buffer,
    },
  );
  ok(res, toItVehicleCheckDto(report));
};
