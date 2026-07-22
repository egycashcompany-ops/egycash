import { type Request, type Response } from 'express';
import {
  type CreateJobPosition,
  type ListJobPositionsQuery,
  type UpdateJobPosition,
} from '@ecms/contracts';
import { created, noContent, ok, okPage } from '../../../infrastructure/http/respond';
import { validated } from '../../../infrastructure/http/validate';
import { scopeSelector } from '../../../shared/types';
import { authContext } from '../../auth';
import { jobPositionService } from './job-position.service';

type IdParam = { id: string };

export const listJobPositions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListJobPositionsQuery>(req);
  const page = await jobPositionService.list(query, scopeSelector(ctx, 'jobPosition.view'));
  okPage(res, page, (doc) => jobPositionService.toDto(doc));
};

export const getJobPosition = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, jobPositionService.toDto(await jobPositionService.getById(params.id)));
};

export const createJobPosition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateJobPosition>(req);
  const doc = await jobPositionService.create(body, ctx.userId);
  created(res, jobPositionService.toDto(doc), `/api/v1/platform/job-positions/${String(doc._id)}`);
};

export const updateJobPosition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateJobPosition, never, IdParam>(req);
  ok(res, jobPositionService.toDto(await jobPositionService.update(params.id, body, ctx.userId)));
};

export const deleteJobPosition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await jobPositionService.softDelete(params.id, ctx.userId);
  noContent(res);
};
