// The consumables store's routes (FR-20), on the assets' own grants — no key of its own: whoever
// keeps the devices keeps the store («same permissions as assets», the plan the owner approved).
// Reads ride `itAsset.view`; adding an item `itAsset.create`; editing it, receiving stock and
// scrapping `itAsset.edit`; issuing to a person and taking back from one `itAsset.assign`, the one
// custody grant.
import { Router } from 'express';
import {
  CreateItConsumableSchema,
  IssueItConsumablesSchema,
  ItConsumableIdParamSchema,
  ListItConsumableMovementsQuerySchema,
  ListItConsumablesQuerySchema,
  ReceiveItConsumableSchema,
  ReturnItConsumableSchema,
  ScrapItConsumableSchema,
  UpdateItConsumableSchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItConsumable,
  getItConsumable,
  issueItConsumables,
  listItConsumableMovementsOf,
  listItConsumables,
  receiveItConsumable,
  returnItConsumable,
  scrapItConsumable,
  updateItConsumable,
} from './consumable.controller';

export const buildItConsumablesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItConsumablesQuerySchema }),
    asyncHandler(listItConsumables),
  );
  router.post(
    '/',
    authenticate,
    authorize('itAsset.create'),
    validate({ body: CreateItConsumableSchema }),
    asyncHandler(createItConsumable),
  );
  // «صرف لموظف» — before the id routes, so the literal segment is never read as an id.
  router.post(
    '/issue',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: IssueItConsumablesSchema }),
    asyncHandler(issueItConsumables),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itAsset.view'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(getItConsumable),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itAsset.edit'),
    validate({ body: UpdateItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(updateItConsumable),
  );
  router.get(
    '/:id/movements',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItConsumableMovementsQuerySchema, params: ItConsumableIdParamSchema }),
    asyncHandler(listItConsumableMovementsOf),
  );

  // ── Stock — named movements, never a PATCH of a quantity (ADR-024) ──────
  router.post(
    '/:id/receive',
    authenticate,
    authorize('itAsset.edit'),
    validate({ body: ReceiveItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(receiveItConsumable),
  );
  router.post(
    '/:id/scrap',
    authenticate,
    authorize('itAsset.edit'),
    validate({ body: ScrapItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(scrapItConsumable),
  );
  // Taking back from a person is the custody surface, like the issue that gave it to them.
  router.post(
    '/:id/return',
    authenticate,
    authorize('itAsset.assign'),
    validate({ body: ReturnItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(returnItConsumable),
  );
  return router;
};
