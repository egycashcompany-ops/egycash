// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type AcceptJobOffer,
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
import { jobOfferService } from './job-offer.service';
import { toJobOfferDto } from './job-offer.mapper';

type IdParam = { id: string };

export const createJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateJobOffer>(req);
  const doc = await jobOfferService.create(ctx, body, scopeSelector(ctx, 'jobOffer.create'));
  created(res, toJobOfferDto(doc), `/api/v1/hr/job-offers/${String(doc._id)}`);
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
  const doc = await jobOfferService.revise(ctx, params.id, body, scopeSelector(ctx, 'jobOffer.edit'));
  ok(res, toJobOfferDto(doc));
};

export const sendJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SendJobOffer, never, IdParam>(req);
  const doc = await jobOfferService.send(ctx, params.id, body, scopeSelector(ctx, 'jobOffer.send'));
  ok(res, toJobOfferDto(doc));
};

export const acceptJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AcceptJobOffer, never, IdParam>(req);
  const doc = await jobOfferService.accept(ctx, params.id, body, scopeSelector(ctx, 'jobOffer.respond'));
  ok(res, toJobOfferDto(doc));
};

export const rejectJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RejectJobOffer, never, IdParam>(req);
  const doc = await jobOfferService.reject(ctx, params.id, body, scopeSelector(ctx, 'jobOffer.respond'));
  ok(res, toJobOfferDto(doc));
};

export const withdrawJobOffer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<WithdrawJobOffer, never, IdParam>(req);
  const doc = await jobOfferService.withdraw(ctx, params.id, body, scopeSelector(ctx, 'jobOffer.withdraw'));
  ok(res, toJobOfferDto(doc));
};
