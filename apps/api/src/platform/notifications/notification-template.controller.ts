// Thin HTTP mapping only (ADR-003).
import { type Request, type Response } from 'express';
import {
  type CreateNotificationTemplate,
  type ListNotificationTemplatesQuery,
  type PreviewNotificationTemplate,
  type TestSendNotificationTemplate,
  type UpdateNotificationTemplate,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { notificationTemplateService } from './notification-template.service';
import { toTemplateDto } from './notification.mapper';

type IdParam = { id: string };

export const createNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateNotificationTemplate>(req);
  const doc = await notificationTemplateService.create(body, ctx.userId);
  created(res, toTemplateDto(doc), `/api/v1/platform/notification-templates/${String(doc._id)}`);
};

export const listNotificationTemplates = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListNotificationTemplatesQuery>(req);
  const page = await notificationTemplateService.list(query);
  okPage(res, page, toTemplateDto);
};

export const getNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toTemplateDto(await notificationTemplateService.getVersion(params.id)));
};

export const listNotificationTemplateVersions = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const versions = await notificationTemplateService.listVersions(params.id);
  ok(
    res,
    versions.map(toTemplateDto),
  );
};

export const updateNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateNotificationTemplate, never, IdParam>(req);
  const doc = await notificationTemplateService.update(params.id, body, ctx.userId);
  ok(res, toTemplateDto(doc));
};

/** Deactivates the template (`status: inactive`) — implemented as a new version, never a hard delete. */
export const deactivateNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await notificationTemplateService.deactivate(params.id, ctx.userId);
  ok(res, toTemplateDto(doc));
};

export const previewNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const { body, params } = validated<PreviewNotificationTemplate, never, IdParam>(req);
  ok(res, await notificationTemplateService.preview(params.id, body.data));
};

export const testSendNotificationTemplate = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<TestSendNotificationTemplate, never, IdParam>(req);
  await notificationTemplateService.testSend(ctx, params.id, body.data, body.channel);
  noContent(res);
};
