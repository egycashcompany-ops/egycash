import { type Request, type Response } from 'express';
import { type SetSetting } from '@ecms/contracts';
import { ok, noContent } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { settingsService } from './settings.service';

export const listDefinitions = async (_req: Request, res: Response): Promise<void> => {
  ok(res, settingsService.listDefinitions());
};

export const resolveMySettings = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await settingsService.resolveAll({ userId: ctx.userId, branchId: ctx.branchId }));
};

export const setSetting = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<SetSetting>(req);
  await settingsService.set(ctx, body);
  noContent(res);
};

export const listFlags = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  ok(res, await settingsService.listFlagStates({ userId: ctx.userId, branchId: ctx.branchId }));
};
