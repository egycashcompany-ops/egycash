// «المذكرات» — `/fleet/custody/memos`. Reading rides the custody screen's own grant; writing a memo
// is custody money too, so it needs that grant AND the custody receipts' («إيصالات العهدة») write
// grant of the same kind — both `authorize` calls must pass. No new permission key: whoever already
// writes custody receipts writes their memos.
import express, { Router } from 'express';
import mongoSanitize from 'express-mongo-sanitize';
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

/**
 * A memo's body, read here and not by the app-wide 1mb parser (`app.ts` skips this path): up to
 * FLEET_CUSTODY_MEMO_MAX_LINES (3000) lines, each with up to 920 characters of «المأمورية»,
 * «البيان» and «ملاحظات» — two bytes a character in Arabic, about 5.7mb at the very worst. It runs
 * after `authenticate` and `authorize`, so only a user who may write memos gets the room, and the
 * body then passes the same `mongoSanitize` every other body does. Past 8mb is a 413.
 */
const memoBody = [express.json({ limit: '8mb' }), mongoSanitize()];

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
    ...memoBody,
    validate({ body: CreateFleetCustodyMemoSchema }),
    asyncHandler(createCustodyMemo),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetCustody.view'),
    authorize('fleetReceipt.edit'),
    ...memoBody,
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
