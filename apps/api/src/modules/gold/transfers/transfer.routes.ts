// عمليات التحويل — the third document, same grant shape as the other two.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateGoldTransferSchema,
  GoldDocumentActionSchema,
  ListGoldTransfersQuerySchema,
  UpdateGoldTransferSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  confirmGoldTransfer,
  createGoldTransfer,
  getGoldTransfer,
  goldTransferNextNumber,
  listGoldTransfers,
  printGoldTransfer,
  revertGoldTransfer,
  updateGoldTransfer,
} from './transfer.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildGoldTransfersRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('goldTransfer.view'),
    validate({ query: ListGoldTransfersQuerySchema }),
    asyncHandler(listGoldTransfers),
  );
  router.get(
    '/next-number',
    authenticate,
    authorize('goldTransfer.view'),
    asyncHandler(goldTransferNextNumber),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('goldTransfer.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getGoldTransfer),
  );
  router.post(
    '/',
    authenticate,
    authorize('goldTransfer.create'),
    validate({ body: CreateGoldTransferSchema }),
    asyncHandler(createGoldTransfer),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('goldTransfer.edit'),
    validate({ body: UpdateGoldTransferSchema, params: IdParamSchema }),
    asyncHandler(updateGoldTransfer),
  );
  router.post(
    '/:id/confirm',
    authenticate,
    authorize('goldTransfer.confirm'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(confirmGoldTransfer),
  );
  router.post(
    '/:id/revert',
    authenticate,
    authorize('goldTransfer.revert'),
    validate({ body: GoldDocumentActionSchema, params: IdParamSchema }),
    asyncHandler(revertGoldTransfer),
  );
  router.post(
    '/:id/print',
    authenticate,
    authorize('goldTransfer.print'),
    validate({ params: IdParamSchema }),
    asyncHandler(printGoldTransfer),
  );
  return router;
};
