// Maintenance orders (design §7, §12).
//
// The permission split is the design's:
//   * `itMaintenance.view`     — read orders and their consumed parts.
//   * `itMaintenance.create`   — raise a corrective order.
//   * `itMaintenance.edit`     — the planning fields, and starting the work.
//   * `itMaintenance.complete` — complete AND cancel: one grant for both ways an order ends
//                                 (the `itTicket.close` both-directions precedent). Completing is
//                                 what consumes stock and closes the asset's maintenance window,
//                                 and cancelling is the same decision reached the other way.
//
// No DELETE: a maintenance order is a business record. It ends by completing or by cancelling.
import { Router } from 'express';
import { z } from 'zod';
import {
  CancelItMaintenanceOrderSchema,
  CompleteItMaintenanceOrderSchema,
  CreateItMaintenanceOrderSchema,
  ListItMaintenanceOrdersQuerySchema,
  StartItMaintenanceOrderSchema,
  UpdateItMaintenanceOrderSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  cancelItMaintenanceOrder,
  completeItMaintenanceOrder,
  createItMaintenanceOrder,
  getItMaintenanceOrder,
  listItMaintenanceOrderParts,
  listItMaintenanceOrders,
  startItMaintenanceOrder,
  updateItMaintenanceOrder,
} from './order.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItMaintenanceOrdersRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('itMaintenance.view'),
    validate({ query: ListItMaintenanceOrdersQuerySchema }),
    asyncHandler(listItMaintenanceOrders),
  );
  router.post(
    '/',
    authenticate,
    authorize('itMaintenance.create'),
    validate({ body: CreateItMaintenanceOrderSchema }),
    asyncHandler(createItMaintenanceOrder),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itMaintenance.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItMaintenanceOrder),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itMaintenance.edit'),
    validate({ body: UpdateItMaintenanceOrderSchema, params: IdParamSchema }),
    asyncHandler(updateItMaintenanceOrder),
  );
  router.get(
    '/:id/parts',
    authenticate,
    authorize('itMaintenance.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(listItMaintenanceOrderParts),
  );
  router.post(
    '/:id/start',
    authenticate,
    authorize('itMaintenance.edit'),
    validate({ body: StartItMaintenanceOrderSchema, params: IdParamSchema }),
    asyncHandler(startItMaintenanceOrder),
  );
  router.post(
    '/:id/complete',
    authenticate,
    authorize('itMaintenance.complete'),
    validate({ body: CompleteItMaintenanceOrderSchema, params: IdParamSchema }),
    asyncHandler(completeItMaintenanceOrder),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('itMaintenance.complete'),
    validate({ body: CancelItMaintenanceOrderSchema, params: IdParamSchema }),
    asyncHandler(cancelItMaintenanceOrder),
  );
  return router;
};
