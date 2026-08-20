// عمليات الدخول. The grants mirror the gold system's own permission catalog for this screen:
// view · create · edit · confirm · revert · print · import. `import` gates the Excel/CSV intake,
// which happens entirely in the browser and then arrives here as ordinary lines — so it is a
// grant the CLIENT checks and no endpoint of its own, exactly as in gold.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldReceivingSchema,
  GoldDocumentActionSchema,
  ListGoldReceivingQuerySchema,
  UpdateGoldReceivingSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  confirmGoldReceiving,
  createGoldReceiving,
  getGoldReceiving,
  goldReceivingNextNumber,
  listGoldReceiving,
  printGoldReceiving,
  revertGoldReceiving,
  updateGoldReceiving,
} from './receiving.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldReceivingRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldReceiving.view'),
    validate({ query: ListGoldReceivingQuerySchema }),
    asyncHandler(listGoldReceiving),
  );
  // Literal before '/:id'.
  router.get(
    '/next-number',
    authenticate,
    authorize('goldReceiving.view'),
    asyncHandler(goldReceivingNextNumber),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldReceiving.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldReceiving),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldReceiving.create'),
    validate({ body: CreateGoldReceivingSchema }),
    asyncHandler(createGoldReceiving),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldReceiving.edit'),
    validate({ body: UpdateGoldReceivingSchema, params: IdParamSchema }),
    asyncHandler(updateGoldReceiving),
  );
  router.post(
    '/:id/confirm',
    authenticate,
    authorize('goldReceiving.confirm'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(confirmGoldReceiving),
  );
  router.post(
    '/:id/revert',
    authenticate,
    authorize('goldReceiving.revert'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(revertGoldReceiving),
  );
  // Printing is its own grant, and the endpoint LOGS the print: the count and the last-printed
  // stamp on the receipt are what an auditor reads afterwards.
  router.post(
    '/:id/print',
    authenticate,
    authorize('goldReceiving.print'),
    validate({ params: IdParamSchema }),
    asyncHandler(printGoldReceiving),
  );
  return router;
};
