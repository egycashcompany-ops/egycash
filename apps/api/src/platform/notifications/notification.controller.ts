// Thin HTTP mapping only (ADR-003). Self-scoped inbox — identity ownership, no
// permission required (plan §5).
import { type Request, type Response } from 'express';
import { type ListNotificationsQuery } from '@ecms/contracts';
import { noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { notificationsService } from './notification.service';

type IdParam = { id: string };

export const listNotifications = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListNotificationsQuery>(req);
  const page = await notificationsService.listMine(ctx.userId, query);
  okPage(res, page, (doc) => notificationsService.toDto(doc));
};

export const unreadNotificationCount = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, { count: await notificationsService.unreadCount(ctx.userId) });
};

export const markNotificationRead = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, notificationsService.toDto(await notificationsService.markRead(ctx.userId, params.id)));
};

export const markAllNotificationsRead = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, { count: await notificationsService.markAllRead(ctx.userId) });
};

export const archiveNotification = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await notificationsService.archive(ctx.userId, params.id);
  noContent(res);
};
