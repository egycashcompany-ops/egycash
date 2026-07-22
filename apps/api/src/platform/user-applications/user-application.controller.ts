import { type Request, type Response } from 'express';
import { type AssignApplication } from '@ecms/contracts';
import { created, noContent, ok } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { authContext } from '../auth';
import { applicationService } from '../applications/application.service';
import { userApplicationService } from './user-application.service';

type UserParam = { userId: string };
type UserAppParam = { userId: string; applicationId: string };

export const listUserApplications = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, UserParam>(req);
  ok(res, await userApplicationService.listApplications(params.userId));
};

export const assignUserApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AssignApplication, never, UserParam>(req);
  const application = await userApplicationService.assign(
    params.userId,
    body.applicationId,
    ctx.userId,
  );
  created(
    res,
    applicationService.toDto(application),
    `/api/v1/platform/users/${params.userId}/applications/${body.applicationId}`,
  );
};

export const removeUserApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, UserAppParam>(req);
  await userApplicationService.remove(params.userId, params.applicationId, ctx.userId);
  noContent(res);
};
