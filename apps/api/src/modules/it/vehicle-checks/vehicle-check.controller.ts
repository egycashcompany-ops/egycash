// Thin HTTP mapping only (ADR-003) for the vehicle device checks (FR-21), plus the photo's
// multipart intake — IT's single-file intake (`signedCopyUpload`), one file under the field `file`.
import { type Request, type Response } from 'express';
import {
  type CreateItVehicleCheck,
  type ItVehicleCheckDashboardQuery,
  type ItVehicleOptionDto,
  type ListItVehicleChecksQuery,
  type PaginationQuery,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { scopeSelector } from '../../../shared/types';
import { toItVehicleCheckDto } from '../it.mappers';
import { itVehicleCheckService } from './vehicle-check.service';

type IdParam = { id: string };
type PhotoParams = { id: string; fileId: string };
type PhotoFields = { clientPhotoId: string };

/** The dashboard's reads run in the reader's scope for the read grant — what they may see. */
const viewScope = (req: Request) => scopeSelector(authContext(req), 'itVehicleCheck.view');

/** «فحص أجهزة السيارات» — the tiles, the faults, the overdue cars and the matrix. */
export const getItVehicleCheckDashboard = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ItVehicleCheckDashboardQuery>(req);
  ok(res, await itVehicleCheckService.dashboard(query, viewScope(req)));
};

/** «آخر التقارير» — one page, the newest first, under every filter. */
export const listItVehicleChecks = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListItVehicleChecksQuery>(req);
  const page = await itVehicleCheckService.list(query, viewScope(req));
  okPage(res, page, (report) => toItVehicleCheckDto(report));
};

/** «عرض التقرير». */
export const getItVehicleCheck = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toItVehicleCheckDto(await itVehicleCheckService.get(params.id, viewScope(req))));
};

/** One photo of one report, shown in place — the custody signed copy's answer, header for header. */
export const getItVehicleCheckPhoto = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, PhotoParams>(req);
  const photo = await itVehicleCheckService.readPhoto(
    authContext(req),
    params.id,
    params.fileId,
    viewScope(req),
  );
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(photo.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(photo.buffer);
};

/** «حذف التقرير» — under the delete grant's own scope; answered as the asset delete is (204). */
export const deleteItVehicleCheck = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const ctx = authContext(req);
  await itVehicleCheckService.remove(params.id, ctx, scopeSelector(ctx, 'itVehicleCheck.delete'));
  noContent(res);
};

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
