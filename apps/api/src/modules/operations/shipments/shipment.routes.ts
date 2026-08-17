// The shipment surface. `complete` and `reopen` share ONE grant (`operationsShipment.complete`) in
// both directions — the fleet accident close/reopen precedent: whoever may confirm a delivery may
// also take that confirmation back, exactly as the legacy toggle worked (contad_app.js:553-566).
import { Router } from 'express';
import { z } from 'zod';
import {
  CompleteOperationsShipmentSchema,
  CreateOperationsShipmentSchema,
  ListOperationsShipmentsQuerySchema,
  ReopenOperationsShipmentSchema,
  UpdateOperationsShipmentSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  completeShipment,
  createShipment,
  deleteShipment,
  getShipment,
  listShipments,
  reopenShipment,
  updateShipment,
} from './shipment.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildOperationsShipmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: ListOperationsShipmentsQuerySchema }),
    asyncHandler(listShipments),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getShipment),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsShipment.create'),
    validate({ body: CreateOperationsShipmentSchema }),
    asyncHandler(createShipment),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('operationsShipment.edit'),
    validate({ body: UpdateOperationsShipmentSchema, params: IdParamSchema }),
    asyncHandler(updateShipment),
  );
  router.post(
    '/:id/complete',
    authenticate,
    authorize('operationsShipment.complete'),
    validate({ body: CompleteOperationsShipmentSchema, params: IdParamSchema }),
    asyncHandler(completeShipment),
  );
  router.post(
    '/:id/reopen',
    authenticate,
    authorize('operationsShipment.complete'),
    validate({ body: ReopenOperationsShipmentSchema, params: IdParamSchema }),
    asyncHandler(reopenShipment),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('operationsShipment.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteShipment),
  );
  return router;
};
