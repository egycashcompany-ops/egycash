import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetReceiptSchema,
  FleetReceiptSummaryQuerySchema,
  ListFleetReceiptsQuerySchema,
  UpdateFleetReceiptSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  createReceipt,
  deleteReceipt,
  deleteReceiptImage,
  getReceipt,
  getReceiptImage,
  listReceipts,
  receiptSummary,
  updateReceipt,
  uploadReceiptImage,
} from './receipt.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetReceiptsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetReceipt.view'),
    validate({ query: ListFleetReceiptsQuerySchema }),
    asyncHandler(listReceipts),
  );
  // The figures between the filters and the table — over the whole filtered set, never a page.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetReceipt.view'),
    validate({ query: FleetReceiptSummaryQuerySchema }),
    asyncHandler(receiptSummary),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetReceipt.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getReceipt),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetReceipt.create'),
    validate({ body: CreateFleetReceiptSchema }),
    asyncHandler(createReceipt),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetReceipt.edit'),
    validate({ body: UpdateFleetReceiptSchema, params: IdParamSchema }),
    asyncHandler(updateReceipt),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetReceipt.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteReceipt),
  );
  // The photo of the paper — whoever may edit the row may manage it, whoever may view may see it.
  router.get(
    '/:id/image',
    authenticate,
    authorize('fleetReceipt.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getReceiptImage),
  );
  router.post(
    '/:id/image',
    authenticate,
    authorize('fleetReceipt.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadReceiptImage),
  );
  router.delete(
    '/:id/image',
    authenticate,
    authorize('fleetReceipt.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteReceiptImage),
  );
  return router;
};
