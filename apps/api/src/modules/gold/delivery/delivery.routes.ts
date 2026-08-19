// عمليات الخروج — the same grant shape as receiving: view · create · edit · confirm · revert.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldDeliverySchema,
  GoldDocumentActionSchema,
  ListGoldDeliveryQuerySchema,
  UpdateGoldDeliverySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  confirmGoldDelivery,
  createGoldDelivery,
  getGoldDelivery,
  goldDeliveryNextNumber,
  listGoldDelivery,
  printGoldDelivery,
  revertGoldDelivery,
  updateGoldDelivery,
} from './delivery.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldDeliveryRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldDelivery.view'),
    validate({ query: ListGoldDeliveryQuerySchema }),
    asyncHandler(listGoldDelivery),
  );
  router.get(
    '/next-number',
    authenticate,
    authorize('goldDelivery.view'),
    asyncHandler(goldDeliveryNextNumber),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldDelivery.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldDelivery),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldDelivery.create'),
    validate({ body: CreateGoldDeliverySchema }),
    asyncHandler(createGoldDelivery),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldDelivery.edit'),
    validate({ body: UpdateGoldDeliverySchema, params: IdParamSchema }),
    asyncHandler(updateGoldDelivery),
  );
  router.post(
    '/:id/confirm',
    authenticate,
    authorize('goldDelivery.confirm'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(confirmGoldDelivery),
  );
  router.post(
    '/:id/revert',
    authenticate,
    authorize('goldDelivery.revert'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(revertGoldDelivery),
  );
  router.post(
    '/:id/print',
    authenticate,
    authorize('goldDelivery.print'),
    validate({ params: IdParamSchema }),
    asyncHandler(printGoldDelivery),
  );
  return router;
};
