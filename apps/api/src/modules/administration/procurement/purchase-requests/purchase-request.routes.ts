// Purchase requests (P2 plan §4.1): `administrationPurchaseRequest.view` reads the register;
// `.view` or `.approve` reads one request, each with its own scope, so an approver who holds the
// approve key alone opens what they decide (design §5.1.4); `.create` raises a draft and submits
// it, and `.edit` edits one — the requester's own, checked in the service, since the gate here
// knows the key and not the request. There is no delete: a request ends in a terminal status.
// Decisions, returns, cancels and files join with their slices (P2.4 to P2.6).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationPurchaseRequestSchema,
  ListAdministrationPurchaseRequestsQuerySchema,
  SubmitAdministrationPurchaseRequestSchema,
  UpdateAdministrationPurchaseRequestSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  createAdministrationPurchaseRequest,
  getAdministrationPurchaseRequest,
  listAdministrationPurchaseRequests,
  submitAdministrationPurchaseRequest,
  updateAdministrationPurchaseRequest,
} from './purchase-request.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAdministrationPurchaseRequestsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationPurchaseRequest.view'),
    validate({ query: ListAdministrationPurchaseRequestsQuerySchema }),
    asyncHandler(listAdministrationPurchaseRequests),
  );
  router.get(
    '/:id',
    authenticate,
    authorizeAny('administrationPurchaseRequest.view', 'administrationPurchaseRequest.approve'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAdministrationPurchaseRequest),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationPurchaseRequest.create'),
    validate({ body: CreateAdministrationPurchaseRequestSchema }),
    asyncHandler(createAdministrationPurchaseRequest),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationPurchaseRequest.edit'),
    validate({ body: UpdateAdministrationPurchaseRequestSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationPurchaseRequest),
  );
  // Row 2 (design §5.4): a draft to its chain, under the key that raised it (P2 plan §4.1).
  router.post(
    '/:id/submit',
    authenticate,
    authorize('administrationPurchaseRequest.create'),
    validate({ body: SubmitAdministrationPurchaseRequestSchema, params: IdParamSchema }),
    asyncHandler(submitAdministrationPurchaseRequest),
  );
  return router;
};
