// «المواقع» (design §2, §7): each branch's places, on the catalogs page. The tab, its branch list
// and every write are the catalog surface's own grant, `itCatalog.manage` — no new key — with the
// branch reach judged in the service. The pickers' options are names, read on ANY of the IT reads
// that open a picker naming a place (the catalog's own trio, catalog-item.routes.ts): the asset
// hand-over and the custody screens (`itAsset.view`), the consumables issue and ledger
// (`itConsumable.view`), and the catalogs page (`itCatalog.manage`).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItLocationSchema,
  ItLocationOptionsQuerySchema,
  ListItLocationsQuerySchema,
  UpdateItLocationSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItLocation,
  listItLocationBranchTargets,
  listItLocationOptions,
  listItLocations,
  updateItLocation,
} from './location.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItLocationsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itCatalog.manage'),
    validate({ query: ListItLocationsQuerySchema }),
    asyncHandler(listItLocations),
  );
  // Before '/:id' like every literal segment here.
  router.get(
    '/options',
    authenticate,
    authorizeAny('itAsset.view', 'itConsumable.view', 'itCatalog.manage'),
    validate({ query: ItLocationOptionsQuerySchema }),
    asyncHandler(listItLocationOptions),
  );
  // Where the create dialog may file a place: the branches `itCatalog.manage` reaches as the
  // server judges it, not the account's reach over all its grants.
  router.get(
    '/branch-targets',
    authenticate,
    authorize('itCatalog.manage'),
    asyncHandler(listItLocationBranchTargets),
  );
  router.post(
    '/',
    authenticate,
    authorize('itCatalog.manage'),
    validate({ body: CreateItLocationSchema }),
    asyncHandler(createItLocation),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itCatalog.manage'),
    validate({ body: UpdateItLocationSchema, params: IdParamSchema }),
    asyncHandler(updateItLocation),
  );
  return router;
};
