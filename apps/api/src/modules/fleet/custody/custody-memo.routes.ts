// «المذكرات» — `/fleet/custody/memos`. Reading rides the custody screen's own grant; writing a memo
// is custody money too, so it needs that grant AND the custody receipts' («إيصالات العهدة») write
// grant of the same kind — both `authorize` calls must pass. No new permission key: whoever already
// writes custody receipts writes their memos.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetCustodyMemoSchema,
  FleetCustodyMemoCandidatesQuerySchema,
  FleetCustodyMemoSummaryQuerySchema,
  ListFleetCustodyMemosQuerySchema,
  UpdateFleetCustodyMemoSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createCustodyMemo,
  custodyMemoCandidates,
  custodyMemoSummary,
  custodyMemosOutside,
  deleteCustodyMemo,
  getCustodyMemo,
  listCustodyMemos,
  updateCustodyMemo,
} from './custody-memo.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetCustodyMemosRouter = (): Router => {
  const router = Router();
  // The static paths first — `/:id` would otherwise read `summary` as an id.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: FleetCustodyMemoSummaryQuerySchema }),
    asyncHandler(custodyMemoSummary),
  );
  router.get(
    '/outside',
    authenticate,
    authorize('fleetCustody.view'),
    asyncHandler(custodyMemosOutside),
  );
  router.get(
    '/candidates',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: FleetCustodyMemoCandidatesQuerySchema }),
    asyncHandler(custodyMemoCandidates),
  );
  router.get(
    '/',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: ListFleetCustodyMemosQuerySchema }),
    asyncHandler(listCustodyMemos),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getCustodyMemo),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.create'),
    validate({ body: CreateFleetCustodyMemoSchema }),
    asyncHandler(createCustodyMemo),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.edit'),
    validate({ body: UpdateFleetCustodyMemoSchema, params: IdParamSchema }),
    asyncHandler(updateCustodyMemo),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteCustodyMemo),
  );
  return router;
};
