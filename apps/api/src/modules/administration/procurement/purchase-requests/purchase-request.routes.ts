// Purchase requests (P2 plan §4.1): `administrationPurchaseRequest.view` reads the register;
// `.view` or `.approve` reads one request, each with its own scope, so an approver who holds the
// approve key alone opens what they decide (design §5.1.4); `.create` raises a draft and `.edit`
// edits one — the requester's own, checked in the service, since the gate here knows the key and
// not the request. There is no delete: a request ends in a terminal status. Submission, decisions,
// returns, cancels and files join with their slices (P2.3 to P2.6).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationPurchaseRequestSchema,
  ListAdministrationPurchaseRequestsQuerySchema,
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
  return router;
};
