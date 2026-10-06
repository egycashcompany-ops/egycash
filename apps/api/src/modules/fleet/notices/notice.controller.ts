// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateFleetNotice,
  type FleetNoticeImageKind,
  type FleetNoticesSummaryQuery,
  type FleetNoticeTemplate,
  type ListFleetNoticesQuery,
  type SaveFleetNoticeSettings,
  type SetFleetNoticeDone,
  type UpdateFleetNotice,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../platform/web';
import { authContext } from '../../../platform/auth';
import { ValidationError } from '../../../shared/errors';
import { fleetNoticeService, toNoticeDto } from './notice.service';

type IdParam = { id: string };
type ImageParam = { id: string; kind: FleetNoticeImageKind };
type TemplateParam = { template: FleetNoticeTemplate };

export const listNotices = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListFleetNoticesQuery>(req);
  okPage(res, await fleetNoticeService.list(query), toNoticeDto);
};

export const noticesSummary = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, FleetNoticesSummaryQuery>(req);
  ok(res, await fleetNoticeService.summary(query));
};

export const getNotice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toNoticeDto(await fleetNoticeService.get(params.id)));
};

export const createNotice = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<CreateFleetNotice>(req);
  const doc = await fleetNoticeService.create(body, authContext(req).userId);
  created(res, toNoticeDto(await fleetNoticeService.get(String(doc._id))));
};

export const updateNotice = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<UpdateFleetNotice, never, IdParam>(req);
  await fleetNoticeService.update(params.id, body, authContext(req).userId);
  ok(res, toNoticeDto(await fleetNoticeService.get(params.id)));
};

export const deleteNotice = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  await fleetNoticeService.remove(params.id, authContext(req).userId);
  noContent(res);
};

export const setNoticeDone = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SetFleetNoticeDone, never, IdParam>(req);
  ok(res, toNoticeDto(await fleetNoticeService.setDone(params.id, body, authContext(req).userId)));
};

export const uploadNoticeImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, ImageParam>(req);
  const uploaded = req.file;
  if (uploaded === undefined) {
    throw new ValidationError([
      { field: 'file', code: 'REQUIRED', message: 'a file part named "file" is required' },
    ]);
  }
  const row = await fleetNoticeService.setImage(authContext(req), params.id, params.kind, {
    originalName: uploaded.originalname,
    mime: uploaded.mimetype,
    size: uploaded.size,
    buffer: uploaded.buffer,
  });
  ok(res, toNoticeDto(row));
};

export const getNoticeImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, ImageParam>(req);
  const image = await fleetNoticeService.readImage(authContext(req), params.id, params.kind);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(image.fileName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(image.buffer);
};

export const deleteNoticeImage = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, ImageParam>(req);
  ok(
    res,
    toNoticeDto(await fleetNoticeService.deleteImage(authContext(req), params.id, params.kind)),
  );
};

export const getNoticeSettings = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, TemplateParam>(req);
  ok(res, await fleetNoticeService.getSettings(params.template));
};

export const saveNoticeSettings = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<SaveFleetNoticeSettings, never, TemplateParam>(req);
  ok(res, await fleetNoticeService.saveSettings(params.template, body, authContext(req).userId));
};
