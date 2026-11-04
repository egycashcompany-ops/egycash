// The legacy page's privilege set maps to atmReplenishment.* — and unlike every legacy POST
// (contad_app.js:632 had no auth at all), each mutation is guarded (port doc T-auth). Close and
// reopen are ONE grant (`complete`) — the operations-shipment precedent of a two-direction cell.
import { Router } from 'express';
import { z } from 'zod';
import {
  AtmOpenBoardQuerySchema,
  AtmOperationFacetsQuerySchema,
  AtmOperationIdsSchema,
  BulkUpdateAtmReplenishmentsSchema,
  ListAtmDoneOperationsQuerySchema,
  ListAtmOpenOperationsQuerySchema,
  OpenAtmReplenishmentsSchema,
  UpdateAtmReplenishmentSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  ReopenBodySchema,
  bulkUpdateReplenishments,
  closeReplenishments,
  deleteReplenishments,
  listDoneReplenishments,
  listOpenReplenishments,
  openReplenishments,
  replenishmentBoard,
  replenishmentFacets,
  reopenReplenishment,
  updateReplenishment,
} from './replenishment.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAtmReplenishmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('atmReplenishment.view'),
    validate({ query: ListAtmOpenOperationsQuerySchema }),
    asyncHandler(listOpenReplenishments),
  );
  // The board WHOLE in one read — the list above without its pages (contracts:
  // `AtmOpenBoardQuerySchema`). The same grant, so whoever reads the list reads the board.
  router.get(
    '/board',
    authenticate,
    authorize('atmReplenishment.view'),
    validate({ query: AtmOpenBoardQuerySchema }),
    asyncHandler(replenishmentBoard),
  );
  router.get(
    '/facets',
    authenticate,
    authorize('atmReplenishment.view'),
    validate({ query: AtmOperationFacetsQuerySchema }),
    asyncHandler(replenishmentFacets),
  );
  router.get(
    '/done',
    authenticate,
    authorize('atmReplenishment.view'),
    validate({ query: ListAtmDoneOperationsQuerySchema }),
    asyncHandler(listDoneReplenishments),
  );
  router.post(
    '/open',
    authenticate,
    authorize('atmReplenishment.create'),
    validate({ body: OpenAtmReplenishmentsSchema }),
    asyncHandler(openReplenishments),
  );
  router.post(
    '/close',
    authenticate,
    authorize('atmReplenishment.complete'),
    validate({ body: AtmOperationIdsSchema }),
    asyncHandler(closeReplenishments),
  );
  router.post(
    '/:id/reopen',
    authenticate,
    authorize('atmReplenishment.complete'),
    validate({ body: ReopenBodySchema, params: IdParamSchema }),
    asyncHandler(reopenReplenishment),
  );
  router.patch(
    '/bulk',
    authenticate,
    authorize('atmReplenishment.edit'),
    validate({ body: BulkUpdateAtmReplenishmentsSchema }),
    asyncHandler(bulkUpdateReplenishments),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('atmReplenishment.edit'),
    validate({ body: UpdateAtmReplenishmentSchema, params: IdParamSchema }),
    asyncHandler(updateReplenishment),
  );
  router.post(
    '/delete',
    authenticate,
    authorize('atmReplenishment.delete'),
    validate({ body: AtmOperationIdsSchema }),
    asyncHandler(deleteReplenishments),
  );
  return router;
};
