import { type Request, type Response } from 'express';
import { ok, noContent } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { schedulerService } from './scheduler.service';

type KeyParam = { key: string };

export const listTasks = async (_req: Request, res: Response): Promise<void> => {
  ok(res, await schedulerService.list());
};

export const pauseTask = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, KeyParam>(req);
  await schedulerService.pause(params.key);
  noContent(res);
};

export const resumeTask = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, KeyParam>(req);
  await schedulerService.resume(params.key);
  noContent(res);
};

export const runTaskNow = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, KeyParam>(req);
  await schedulerService.runNow(params.key);
  noContent(res);
};
