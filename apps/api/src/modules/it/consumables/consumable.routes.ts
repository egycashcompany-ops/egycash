// The consumables store's routes (FR-20), on the store's own grants (2026-11-17 — «فى الـ IT ظبط
// صلاحيات الشاشات عشان أقدر أتحكم فيها»; until then the assets' grants carried it). Reads ride
// `itConsumable.view`; adding an item `itConsumable.create`; editing it, receiving stock and
// scrapping `itConsumable.edit`; issuing to a person, taking back from one and transferring stock
// to another branch's store `itConsumable.assign`, the one custody grant.
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
  TransferItConsumablesSchema,
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
  listItConsumableTransferTargets,
  listItConsumables,
  receiveItConsumable,
  returnItConsumable,
  scrapItConsumable,
  transferItConsumables,
  updateItConsumable,
} from './consumable.controller';

export const buildItConsumablesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itConsumable.view'),
    validate({ query: ListItConsumablesQuerySchema }),
    asyncHandler(listItConsumables),
  );
  router.post(
    '/',
    authenticate,
    authorize('itConsumable.create'),
    validate({ body: CreateItConsumableSchema }),
    asyncHandler(createItConsumable),
  );
  // «صرف لموظف» — before the id routes, so the literal segment is never read as an id.
  router.post(
    '/issue',
    authenticate,
    authorize('itConsumable.assign'),
    validate({ body: IssueItConsumablesSchema }),
    asyncHandler(issueItConsumables),
  );
  // «تحويل إلى فرع» — stock to another branch's store. The custody grant, like the issue: no key of
  // its own (design §7). Before the id routes too.
  router.post(
    '/transfer',
    authenticate,
    authorize('itConsumable.assign'),
    validate({ body: TransferItConsumablesSchema }),
    asyncHandler(transferItConsumables),
  );
  // Where that transfer may go: the active branches `itConsumable.assign` reaches as a whole, by the
  // very test the transfer applies before it writes — so the dialog offers nothing it would refuse.
  // The assets' own list (`/it/assets/move-targets`) stays on the assets' custody grant, for the
  // assets. Before the id routes, so the literal segment is never read as an id.
  router.get(
    '/transfer-targets',
    authenticate,
    authorize('itConsumable.assign'),
    asyncHandler(listItConsumableTransferTargets),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itConsumable.view'),
    validate({ params: ItConsumableIdParamSchema }),
    asyncHandler(getItConsumable),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itConsumable.edit'),
    validate({ body: UpdateItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(updateItConsumable),
  );
  router.get(
    '/:id/movements',
    authenticate,
    authorize('itConsumable.view'),
    validate({ query: ListItConsumableMovementsQuerySchema, params: ItConsumableIdParamSchema }),
    asyncHandler(listItConsumableMovementsOf),
  );

  // ── Stock — named movements, never a PATCH of a quantity (ADR-024) ──────
  router.post(
    '/:id/receive',
    authenticate,
    authorize('itConsumable.edit'),
    validate({ body: ReceiveItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(receiveItConsumable),
  );
  router.post(
    '/:id/scrap',
    authenticate,
    authorize('itConsumable.edit'),
    validate({ body: ScrapItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(scrapItConsumable),
  );
  // Taking back from a person is the custody surface, like the issue that gave it to them.
  router.post(
    '/:id/return',
    authenticate,
    authorize('itConsumable.assign'),
    validate({ body: ReturnItConsumableSchema, params: ItConsumableIdParamSchema }),
    asyncHandler(returnItConsumable),
  );
  return router;
};
