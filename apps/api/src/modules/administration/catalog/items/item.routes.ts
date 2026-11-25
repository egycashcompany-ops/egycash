// Items (design §19.3): `administrationItem.view` reads the register and one item; `.create` and
// `.edit` write, and are also held to organization scope in the service (OD-04 A) — one item
// master for the whole company. There is no delete: `isActive: false` is the deactivation (§5.3).
//
// The two reads also open to `administrationPurchaseRequest.create` (P2.2; design §13.6 D): a
// department's focal point picks a request's items without the item register's key, as a supplier
// editor picks categories (§7.1: a picker's gate grows with the keys that need it). It widens
// nothing: master data is read whole, and the rows are what every request line already names.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationItemSchema,
  ListAdministrationItemsQuerySchema,
  UpdateAdministrationItemSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  createAdministrationItem,
  getAdministrationItem,
  listAdministrationItems,
  updateAdministrationItem,
} from './item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

/** Who reads the item master: its register's readers, and whoever picks a request's items. */
const ITEM_READ_KEYS = ['administrationItem.view', 'administrationPurchaseRequest.create'] as const;

export const buildAdministrationItemsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny(...ITEM_READ_KEYS),
    validate({ query: ListAdministrationItemsQuerySchema }),
    asyncHandler(listAdministrationItems),
  );
  // Resolve-by-id, the other half of ADR-019 rule 5: a form holding a stored item id shows its
  // name, so a retired item answers too. The list's gate — one row of what the list returns.
  router.get(
    '/:id',
    authenticate,
    authorizeAny(...ITEM_READ_KEYS),
    validate({ params: IdParamSchema }),
    asyncHandler(getAdministrationItem),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationItem.create'),
    validate({ body: CreateAdministrationItemSchema }),
    asyncHandler(createAdministrationItem),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationItem.edit'),
    validate({ body: UpdateAdministrationItemSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationItem),
  );
  return router;
};
