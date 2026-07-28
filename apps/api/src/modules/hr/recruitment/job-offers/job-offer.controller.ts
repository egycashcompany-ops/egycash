// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
//
// I6 — every action that moves the offer answers with the full workflow envelope. Reads (GET) are
// unchanged.
import { type Request, type Response } from 'express';
import {
  type AcceptJobOffer,
  type BulkJobOffers,
  type CreateJobOffer,
  type ListJobOffersQuery,
  type RejectJobOffer,
  type ReviseJobOffer,
  type SendJobOffer,
  type WithdrawJobOffer,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { withBulkWorkflowEnvelope, withWorkflowEnvelope } from '../workflow';
import { jobOfferService } from './job-offer.service';
import { toJobOfferDto } from './job-offer.mapper';
import { type JobOfferDoc } from './job-offer.model';

type IdParam = { id: string };

const applicantOf = (doc: JobOfferDoc): string => String(doc.applicantId);

export const createJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateJobOffer>(req);
  const scope = scopeSelector(ctx, 'jobOffer.create');
  const envelope = await withWorkflowEnvelope(
    ctx,
    () => jobOfferService.create(ctx, body, scope),
    toJobOfferDto,
    applicantOf,
  );
  created(res, envelope, `/api/v1/hr/job-offers/${envelope.data.id}`);
};

export const listJobOffers = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListJobOffersQuery>(req);
  okPage(res, await jobOfferService.list(query, scopeSelector(ctx, 'jobOffer.view')), toJobOfferDto);
};

export const getJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toJobOfferDto(await jobOfferService.getById(params.id, scopeSelector(ctx, 'jobOffer.view'))));
};

export const reviseJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReviseJobOffer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'jobOffer.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => jobOfferService.revise(ctx, params.id, body, scope),
      toJobOfferDto,
      applicantOf,
    ),
  );
};

export const sendJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SendJobOffer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'jobOffer.send');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => jobOfferService.send(ctx, params.id, body, scope),
      toJobOfferDto,
      applicantOf,
    ),
  );
};

export const acceptJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AcceptJobOffer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'jobOffer.respond');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => jobOfferService.accept(ctx, params.id, body, scope),
      toJobOfferDto,
      applicantOf,
    ),
  );
};

export const rejectJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RejectJobOffer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'jobOffer.respond');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => jobOfferService.reject(ctx, params.id, body, scope),
      toJobOfferDto,
      applicantOf,
    ),
  );
};

export const withdrawJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<WithdrawJobOffer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'jobOffer.withdraw');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => jobOfferService.withdraw(ctx, params.id, body, scope),
      toJobOfferDto,
      applicantOf,
    ),
  );
};

export const bulkJobOffers = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkJobOffers>(req);
  const scope = scopeSelector(ctx, 'jobOffer.edit');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => jobOfferService.bulk(ctx, body, scope)));
};
