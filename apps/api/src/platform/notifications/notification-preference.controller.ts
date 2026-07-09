// Thin HTTP mapping only (ADR-003). Self-scoped preferences — identity ownership, no
// permission required (plan §5).
import { type Request, type Response } from 'express';
import { type UpsertNotificationPreference, type UpsertQuietHours } from '@ecms/contracts';
import { ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { notificationPreferenceService } from './notification-preference.service';

export const getMyNotificationPreferences = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await notificationPreferenceService.getMine(ctx.userId));
};

export const upsertMyNotificationPreference = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<UpsertNotificationPreference>(req);
  await notificationPreferenceService.upsertPreference(ctx.userId, body);
  ok(res, await notificationPreferenceService.getMine(ctx.userId));
};

export const upsertMyQuietHours = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<UpsertQuietHours>(req);
  ok(res, await notificationPreferenceService.upsertQuietHours(ctx.userId, body));
};
