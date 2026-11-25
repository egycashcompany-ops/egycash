// Warehouses (design §19.3): `administrationWarehouse.view` reads the register, one warehouse and
// the branch options; `.create` and `.edit` write, each where the key reaches the warehouse's
// branch — checked in the service, since the gate here knows the key and not the branch. There is
// no delete: `isActive: false` is the deactivation (§5.3).
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationWarehouseSchema,
  ListAdministrationWarehousesQuerySchema,
  UpdateAdministrationWarehouseSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  createAdministrationWarehouse,
  getAdministrationWarehouse,
  listAdministrationWarehouseBranchOptions,
  listAdministrationWarehouses,
  updateAdministrationWarehouse,
} from './warehouse.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
/** The branch options take no query: a stray parameter is refused rather than ignored. */
const NoQuerySchema = z.object({}).strict();

export const buildAdministrationWarehousesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationWarehouse.view'),
    validate({ query: ListAdministrationWarehousesQuerySchema }),
    asyncHandler(listAdministrationWarehouses),
  );
  // Before '/:id', so the segment is never read as an id. The register's branch filter offers its
  // `canView` branches and the create dialog its `canCreate` ones — the web cannot work out a
  // key's reach per branch itself.
  router.get(
    '/branch-options',
    authenticate,
    authorize('administrationWarehouse.view'),
    validate({ query: NoQuerySchema }),
    asyncHandler(listAdministrationWarehouseBranchOptions),
  );
  // A retired warehouse answers too: a form holding a stored warehouse id still shows its name.
  router.get(
    '/:id',
    authenticate,
    authorize('administrationWarehouse.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getAdministrationWarehouse),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationWarehouse.create'),
    validate({ body: CreateAdministrationWarehouseSchema }),
    asyncHandler(createAdministrationWarehouse),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationWarehouse.edit'),
    validate({ body: UpdateAdministrationWarehouseSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationWarehouse),
  );
  return router;
};
