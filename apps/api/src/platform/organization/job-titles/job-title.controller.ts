import { type Request, type Response } from 'express';
import { type CreateJobTitle, type ListOrgUnitsQuery, type UpdateJobTitle } from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../auth';
import { jobTitleService } from './job-title.service';

type IdParam = { id: string };

export const listJobTitles = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListOrgUnitsQuery>(req);
  const page = await jobTitleService.list(query, scopeSelector(ctx, 'jobTitle.view'));
  okPage(res, page, (doc) => jobTitleService.toDto(doc));
};

export const getJobTitle = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, jobTitleService.toDto(await jobTitleService.getById(params.id)));
};

export const createJobTitle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateJobTitle>(req);
  const doc = await jobTitleService.create(body, ctx.userId);
  created(res, jobTitleService.toDto(doc), `/api/v1/platform/job-titles/${String(doc._id)}`);
};

export const updateJobTitle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateJobTitle, never, IdParam>(req);
  ok(res, jobTitleService.toDto(await jobTitleService.update(params.id, body, ctx.userId)));
};

export const deleteJobTitle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await jobTitleService.softDelete(params.id, ctx.userId);
  noContent(res);
};
