// /atm/preparation — the bags and seals page (docs/12-planning/atm-settlements-phase1.md §6.3
// P1–P5). authenticate → authorize → validate; the service asks the key to reach the branch.
import { Router } from 'express';
import { z } from 'zod';
import {
  AtmSettlementDayQuerySchema,
  AtmVersionSchema,
  SaveAtmPreparationSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  getPreparationContext,
  listPreparationLines,
  markPrepared,
  reopenPreparation,
  savePreparation,
} from './preparation.controller';

const PlanParamSchema = z.object({ planId: objectId() }).strict();
const LineParamSchema = z.object({ lineId: objectId() }).strict();

export const buildAtmPreparationRouter = (): Router => {
  const router = Router();
  const view = authorize('atmPreparation.view');
  const capture = authorize('atmPreparation.capture');

  router.get(
    '/context',
    authenticate,
    view,
    validate({ query: AtmSettlementDayQuerySchema }),
    asyncHandler(getPreparationContext),
  );
  router.get(
    '/plans/:planId/lines',
    authenticate,
    view,
    validate({ params: PlanParamSchema }),
    asyncHandler(listPreparationLines),
  );
  router.put(
    '/lines/:lineId',
    authenticate,
    capture,
    validate({ body: SaveAtmPreparationSchema, params: LineParamSchema }),
    asyncHandler(savePreparation),
  );
  router.post(
    '/lines/:lineId/prepared',
    authenticate,
    capture,
    validate({ body: AtmVersionSchema, params: LineParamSchema }),
    asyncHandler(markPrepared),
  );
  router.post(
    '/lines/:lineId/reopen',
    authenticate,
    capture,
    validate({ body: AtmVersionSchema, params: LineParamSchema }),
    asyncHandler(reopenPreparation),
  );
  return router;
};
