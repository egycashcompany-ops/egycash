// Thin HTTP mapping only (ADR-003).
//
// One flag is computed here and passed down: whether the caller holds `jobRequisition.approve`. The
// service needs it because the manager step is authorized by RELATIONSHIP and the HR step by the
// key — the same split `regularization.controller.ts` makes, for the same reason.
import { type Request, type Response } from 'express';
import {
  type CloseJobRequisition,
  type CreateJobRequisition,
  type DecideJobRequisition,
  type ListJobRequisitionsQuery,
  type SubmitJobRequisition,
  type UpdateJobRequisition,
} from '@ecms/contracts';
import { created, noContent, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { jobRequisitionService } from './job-requisition.service';
import { toJobRequisitionDto, toJobRequisitionFillDto } from './job-requisition.mapper';
import { type JobRequisitionDoc } from './job-requisition.model';

type IdParam = { id: string };

const one = async (doc: JobRequisitionDoc) =>
  toJobRequisitionDto(doc, await jobRequisitionService.filledCount(String(doc._id)));

export const createRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateJobRequisition>(req);
  const doc = await jobRequisitionService.create(ctx, body);
  created(res, await one(doc), `/api/v1/hr/job-requisitions/${String(doc._id)}`);
};

export const listRequisitions = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListJobRequisitionsQuery>(req);
  const page = await jobRequisitionService.list(query, scopeSelector(ctx, 'jobRequisition.view'));
  // One aggregate for the whole page rather than a count per row.
  const counts = await jobRequisitionService.filledCountsFor(page.items.map((doc) => String(doc._id)));
  okPage(res, page, (doc) => toJobRequisitionDto(doc, counts.get(String(doc._id)) ?? 0));
};

export const getRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const doc = await jobRequisitionService.getById(params.id, scopeSelector(ctx, 'jobRequisition.view'));
  ok(res, await one(doc));
};

export const listRequisitionFills = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const fills = await jobRequisitionService.fills(
    params.id,
    scopeSelector(ctx, 'jobRequisition.view'),
  );
  ok(res, fills.map(toJobRequisitionFillDto));
};

export const updateRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateJobRequisition, never, IdParam>(req);
  const doc = await jobRequisitionService.update(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'jobRequisition.edit'),
  );
  ok(res, await one(doc));
};

export const submitRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitJobRequisition, never, IdParam>(req);
  const doc = await jobRequisitionService.submit(
    ctx,
    params.id,
    body.version,
    scopeSelector(ctx, 'jobRequisition.create'),
  );
  ok(res, await one(doc));
};

export const decideRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideJobRequisition, never, IdParam>(req);
  const doc = await jobRequisitionService.decide(
    ctx,
    params.id,
    body,
    'jobRequisition.approve' in ctx.permissions,
    scopeSelector(ctx, 'jobRequisition.view'),
  );
  ok(res, await one(doc));
};

export const deleteRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  await jobRequisitionService.remove(ctx, params.id, scopeSelector(ctx, 'jobRequisition.delete'));
  noContent(res);
};

export const closeRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CloseJobRequisition, never, IdParam>(req);
  const doc = await jobRequisitionService.close(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'jobRequisition.approve'),
  );
  ok(res, await one(doc));
};

export const cancelRequisition = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CloseJobRequisition, never, IdParam>(req);
  const doc = await jobRequisitionService.cancel(
    ctx,
    params.id,
    body,
    scopeSelector(ctx, 'jobRequisition.approve'),
  );
  ok(res, await one(doc));
};
