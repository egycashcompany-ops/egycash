// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  acceptJobOffer,
  createJobOffer,
  getJobOffer,
  listJobOffers,
  rejectJobOffer,
  reviseJobOffer,
  sendJobOffer,
  withdrawJobOffer,
} from './job-offer.controller';
import {
  AcceptJobOfferSchema,
  CreateJobOfferSchema,
  JobOfferIdParamSchema,
  ListJobOffersQuerySchema,
  RejectJobOfferSchema,
  ReviseJobOfferSchema,
  SendJobOfferSchema,
  WithdrawJobOfferSchema,
} from './job-offer.validation';

export const buildJobOffersRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('jobOffer.view'),
    validate({ query: ListJobOffersQuerySchema }),
    asyncHandler(listJobOffers),
  );
  router.post(
    '/',
    authenticate,
    authorize('jobOffer.create'),
    validate({ body: CreateJobOfferSchema }),
    asyncHandler(createJobOffer),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('jobOffer.view'),
    validate({ params: JobOfferIdParamSchema }),
    asyncHandler(getJobOffer),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('jobOffer.edit'),
    validate({ body: ReviseJobOfferSchema, params: JobOfferIdParamSchema }),
    asyncHandler(reviseJobOffer),
  );
  router.post(
    '/:id/send',
    authenticate,
    authorize('jobOffer.send'),
    validate({ body: SendJobOfferSchema, params: JobOfferIdParamSchema }),
    asyncHandler(sendJobOffer),
  );
  router.post(
    '/:id/accept',
    authenticate,
    authorize('jobOffer.respond'),
    validate({ body: AcceptJobOfferSchema, params: JobOfferIdParamSchema }),
    asyncHandler(acceptJobOffer),
  );
  router.post(
    '/:id/reject',
    authenticate,
    authorize('jobOffer.respond'),
    validate({ body: RejectJobOfferSchema, params: JobOfferIdParamSchema }),
    asyncHandler(rejectJobOffer),
  );
  router.post(
    '/:id/withdraw',
    authenticate,
    authorize('jobOffer.withdraw'),
    validate({ body: WithdrawJobOfferSchema, params: JobOfferIdParamSchema }),
    asyncHandler(withdrawJobOffer),
  );

  return router;
};
