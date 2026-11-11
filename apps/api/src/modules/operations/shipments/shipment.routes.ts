// The shipment surface. `complete` and `reopen` share ONE grant (`operationsShipment.complete`) in
// both directions — the fleet accident close/reopen precedent: whoever may confirm a delivery may
// also take that confirmation back, exactly as the legacy toggle worked (contad_app.js:553-566).
import { Router } from 'express';
import { z } from 'zod';
import {
  CompleteOperationsShipmentSchema,
  CreateOperationsShipmentSchema,
  ListOperationsShipmentsQuerySchema,
  OperationsDayBoardQuerySchema,
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
  deleteShipmentReceiptImage,
  getDayBoard,
  getShipment,
  getShipmentReceiptImage,
  listShipments,
  reopenShipment,
  updateShipment,
  uploadShipmentReceiptImage,
} from './shipment.controller';
import { multipartSingle } from './receipt-image-upload';

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
  // BEFORE `/:id` — `day-board` is a literal segment and would otherwise be read as an id.
  router.get(
    '/day-board',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsDayBoardQuerySchema }),
    asyncHandler(getDayBoard),
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
  // The photo of the paper receipt («صورة الإيصال») — the Fleet receipts' rule: whoever may edit
  // the row may manage it, whoever may view the row may see it. No new grant. `authorize` runs
  // BEFORE multer, so a caller who may not upload never gets a body buffered.
  router.get(
    '/:id/receipt-image',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getShipmentReceiptImage),
  );
  router.post(
    '/:id/receipt-image',
    authenticate,
    authorize('operationsShipment.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadShipmentReceiptImage),
  );
  router.delete(
    '/:id/receipt-image',
    authenticate,
    authorize('operationsShipment.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteShipmentReceiptImage),
  );
  return router;
};
