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
  OperationsDeletedShipmentsQuerySchema,
  OperationsShipmentHistoryQuerySchema,
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
  getDeletedShipments,
  getShipment,
  getShipmentHistory,
  getShipmentLog,
  getShipmentReceiptImage,
  listShipments,
  reopenShipment,
  restoreShipment,
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
  // The shipments history — the day board over a range of days. BEFORE `/:id` for the same
  // reason as `day-board`, and behind the same grant: it is the same board, looked back at.
  router.get(
    '/history',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsShipmentHistoryQuerySchema }),
    asyncHandler(getShipmentHistory),
  );
  // The shipments deleted from the history's days («اعملى ايقون اقدر اجيب منه اللى اتمسح»). BEFORE
  // `/:id` like its two siblings, and behind the same reading grant: it is the history's rows that
  // were taken off it. Bringing one back is `POST /:id/restore`, below, on the delete grant.
  router.get(
    '/deleted',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ query: OperationsDeletedShipmentsQuerySchema }),
    asyncHandler(getDeletedShipments),
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
  // The undo of the delete above, on the SAME grant — the `complete`/`reopen` precedent: whoever
  // may take a shipment off its board may put it back. No body: nothing about the row changes.
  router.post(
    '/:id/restore',
    authenticate,
    authorize('operationsShipment.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(restoreShipment),
  );
  // «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — whoever may see the shipment may read its story,
  // on the day board and the history alike, and for a deleted shipment too.
  router.get(
    '/:id/log',
    authenticate,
    authorize('operationsShipment.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getShipmentLog),
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
