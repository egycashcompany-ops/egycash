// The legacy maintenance page's privilege set deliberately EXCLUDED the review role from the
// live page while the done page included it (contad_app.js:1056 vs :2096) — expressed here by
// the role bundles the port doc maps, not by extra keys. Same guard shape as replenishments.
import { Router } from 'express';
import { z } from 'zod';
import {
  AtmOperationIdsSchema,
  BulkUpdateAtmMaintenancesSchema,
  CloseAtmMaintenancesSchema,
  ListAtmDoneOperationsQuerySchema,
  ListAtmOpenOperationsQuerySchema,
  OpenAtmMaintenancesSchema,
  UpdateAtmMaintenanceSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  MaintFacetsQuerySchema,
  MaintReopenBodySchema,
  bulkUpdateMaintenances,
  closeMaintenances,
  deleteMaintenances,
  listDoneMaintenances,
  listOpenMaintenances,
  maintenanceFacets,
  maintenanceLeaderOptions,
  openMaintenances,
  reopenMaintenance,
  updateMaintenance,
} from './maintenance.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAtmMaintenancesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('atmMaintenance.view'),
    validate({ query: ListAtmOpenOperationsQuerySchema }),
    asyncHandler(listOpenMaintenances),
  );
  router.get(
    '/facets',
    authenticate,
    authorize('atmMaintenance.view'),
    validate({ query: MaintFacetsQuerySchema }),
    asyncHandler(maintenanceFacets),
  );
  router.get(
    '/done',
    authenticate,
    authorize('atmMaintenance.view'),
    validate({ query: ListAtmDoneOperationsQuerySchema }),
    asyncHandler(listDoneMaintenances),
  );
  // The close modal needs the list before any close happens, so it rides `view`, not `complete`.
  router.get(
    '/leader-options',
    authenticate,
    authorize('atmMaintenance.view'),
    asyncHandler(maintenanceLeaderOptions),
  );
  router.post(
    '/open',
    authenticate,
    authorize('atmMaintenance.create'),
    validate({ body: OpenAtmMaintenancesSchema }),
    asyncHandler(openMaintenances),
  );
  router.post(
    '/close',
    authenticate,
    authorize('atmMaintenance.complete'),
    validate({ body: CloseAtmMaintenancesSchema }),
    asyncHandler(closeMaintenances),
  );
  router.post(
    '/:id/reopen',
    authenticate,
    authorize('atmMaintenance.complete'),
    validate({ body: MaintReopenBodySchema, params: IdParamSchema }),
    asyncHandler(reopenMaintenance),
  );
  router.patch(
    '/bulk',
    authenticate,
    authorize('atmMaintenance.edit'),
    validate({ body: BulkUpdateAtmMaintenancesSchema }),
    asyncHandler(bulkUpdateMaintenances),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('atmMaintenance.edit'),
    validate({ body: UpdateAtmMaintenanceSchema, params: IdParamSchema }),
    asyncHandler(updateMaintenance),
  );
  router.post(
    '/delete',
    authenticate,
    authorize('atmMaintenance.delete'),
    validate({ body: AtmOperationIdsSchema }),
    asyncHandler(deleteMaintenances),
  );
  return router;
};
