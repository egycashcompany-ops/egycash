import { type Request, type Response } from 'express';
import {
  type CreateApplication,
  type ListApplicationsQuery,
  type UpdateApplication,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { scopeSelector } from '../../shared/types';
import { authContext } from '../auth';
import { applicationService } from './application.service';

type IdParam = { id: string };

export const listApplications = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListApplicationsQuery>(req);
  const page = await applicationService.list(query, scopeSelector(ctx, 'application.view'));
  okPage(res, page, (doc) => applicationService.toDto(doc));
};

export const getApplication = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, applicationService.toDto(await applicationService.getById(params.id)));
};

export const createApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateApplication>(req);
  const doc = await applicationService.create(body, ctx.userId);
  created(res, applicationService.toDto(doc), `/api/v1/platform/applications/${String(doc._id)}`);
};

export const updateApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateApplication, never, IdParam>(req);
  ok(res, applicationService.toDto(await applicationService.update(params.id, body, ctx.userId)));
};

export const deleteApplication = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await applicationService.softDelete(params.id, ctx.userId);
  noContent(res);
};
