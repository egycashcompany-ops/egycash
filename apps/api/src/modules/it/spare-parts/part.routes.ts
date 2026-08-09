// Spare parts and their ledger (design §7, §12).
//
//   * `itSparePart.view`   — the catalogue and the movements.
//   * `itSparePart.manage` — the catalogue AND receipts (§7: "catalog + receipts").
//
// CONSUMPTION HAS NO ROUTE HERE, and that is the design's rule, not an omission: stock leaves the
// store only through a maintenance order's completion, under `itMaintenance.complete` (FR-9). A
// "consume" endpoint would be a second door to the same act, and the ledger would stop being able
// to say which repair used the part.
//
// No DELETE: parts archive (FR-11) — movements point at them forever.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItSparePartSchema,
  ListItSparePartMovementsQuerySchema,
  ListItSparePartsQuerySchema,
  ReceiveItSparePartSchema,
  UpdateItSparePartSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItSparePart,
  getItSparePart,
  listItSparePartMovements,
  listItSpareParts,
  receiveItSparePart,
  updateItSparePart,
} from './part.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();
/** The path already names the part, so the query may not name a second one. */
const MovementsQuerySchema = ListItSparePartMovementsQuerySchema.omit({ partId: true });

export const buildItSparePartsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('itSparePart.view'),
    validate({ query: ListItSparePartsQuerySchema }),
    asyncHandler(listItSpareParts),
  );
  router.post(
    '/',
    authenticate,
    authorize('itSparePart.manage'),
    validate({ body: CreateItSparePartSchema }),
    asyncHandler(createItSparePart),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itSparePart.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getItSparePart),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itSparePart.manage'),
    validate({ body: UpdateItSparePartSchema, params: IdParamSchema }),
    asyncHandler(updateItSparePart),
  );
  router.post(
    '/:id/receipts',
    authenticate,
    authorize('itSparePart.manage'),
    validate({ body: ReceiveItSparePartSchema, params: IdParamSchema }),
    asyncHandler(receiveItSparePart),
  );
  router.get(
    '/:id/movements',
    authenticate,
    authorize('itSparePart.view'),
    validate({ query: MovementsQuerySchema, params: IdParamSchema }),
    asyncHandler(listItSparePartMovements),
  );
  return router;
};
