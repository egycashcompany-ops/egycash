// Router: authenticate → authorize → validate → controller.
//
// THE DECISION ROUTE IS DELIBERATELY NOT GATED ON `approve` (D-REQ-11). A department manager who
// holds no approval key must be able to decide step one — the authority there is the RELATIONSHIP,
// and `job-requisition-rules.ts` is what enforces it. Gating the route on `approve` would lock the
// manager out of their own step and quietly turn a two-step approval into a one-step one.
//
// There is no `close` key and no `reopen` route: closing is `approve`'s act (D-REQ-12), and nothing
// reopens a requisition (ADR-029).
import { Router } from 'express';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  cancelRequisition,
  closeRequisition,
  createRequisition,
  decideRequisition,
  deleteRequisition,
  getRequisition,
  listRequisitionFills,
  listRequisitions,
  submitRequisition,
  updateRequisition,
} from './job-requisition.controller';
import {
  CloseJobRequisitionSchema,
  CreateJobRequisitionSchema,
  DecideJobRequisitionSchema,
  ListJobRequisitionsQuerySchema,
  RequisitionIdParamSchema,
  SubmitJobRequisitionSchema,
  UpdateJobRequisitionSchema,
} from './job-requisition.validation';

export const buildJobRequisitionsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('jobRequisition.view'),
    validate({ query: ListJobRequisitionsQuerySchema }),
    asyncHandler(listRequisitions),
  );
  router.post(
    '/',
    authenticate,
    authorize('jobRequisition.create'),
    validate({ body: CreateJobRequisitionSchema }),
    asyncHandler(createRequisition),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('jobRequisition.view'),
    validate({ params: RequisitionIdParamSchema }),
    asyncHandler(getRequisition),
  );
  router.get(
    '/:id/fills',
    authenticate,
    authorize('jobRequisition.view'),
    validate({ params: RequisitionIdParamSchema }),
    asyncHandler(listRequisitionFills),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('jobRequisition.edit'),
    validate({ body: UpdateJobRequisitionSchema, params: RequisitionIdParamSchema }),
    asyncHandler(updateRequisition),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('jobRequisition.delete'),
    validate({ params: RequisitionIdParamSchema }),
    asyncHandler(deleteRequisition),
  );
  router.post(
    '/:id/submit',
    authenticate,
    authorize('jobRequisition.create'),
    validate({ body: SubmitJobRequisitionSchema, params: RequisitionIdParamSchema }),
    asyncHandler(submitRequisition),
  );
  router.post(
    '/:id/decision',
    authenticate,
    authorize('jobRequisition.view'),
    validate({ body: DecideJobRequisitionSchema, params: RequisitionIdParamSchema }),
    asyncHandler(decideRequisition),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('jobRequisition.approve'),
    validate({ body: CloseJobRequisitionSchema, params: RequisitionIdParamSchema }),
    asyncHandler(closeRequisition),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('jobRequisition.approve'),
    validate({ body: CloseJobRequisitionSchema, params: RequisitionIdParamSchema }),
    asyncHandler(cancelRequisition),
  );

  return router;
};
