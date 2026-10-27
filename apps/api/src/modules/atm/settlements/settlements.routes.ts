// /atm/settlements — cassette layouts, standard loads, the daily plan and its papers
// (docs/12-planning/atm-settlements-phase1.md §6.3 S1–S22).
//
// authenticate → authorize(…) → (rate limit) → validate(…), the `machines/machine.routes.ts` order.
// `authorize` and `authorizeAny` only test that a key is HELD; every service then asks the key to
// reach the record's branch (§6.2). Literal paths come before parameter paths. The import (S4) is
// multipart and parses its own fields in the controller, after the upload (§6.3).
import { type Request, Router } from 'express';
import { z } from 'zod';
import {
  AddAtmPlanLinesSchema,
  AddAtmSpareLineSchema,
  AtmLineReasonSchema,
  AtmSettlementBankQuerySchema,
  AtmSettlementContextQuerySchema,
  AtmSettlementPlanQuerySchema,
  AtmSettlementPrintSchema,
  AtmSpareUseSchema,
  AtmVersionQuerySchema,
  CreateAtmPlanSchema,
  IssueAtmPlanSchema,
  SaveAtmCassetteLayoutSchema,
  SaveAtmStandardLoadSchema,
  UpdateAtmPlanLineSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate, authContextOrNull } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { rateLimit } from '../../../infrastructure/redis/rate-limiter';
import { noStore, workbookUpload } from '../register/import/register-import.routes';
import { MASTER_IMPORT_MAX_MB } from './import/read-master-workbook';
import {
  addPlanLines,
  addSpareLine,
  cancelPlanLine,
  createPlan,
  createStandardLoad,
  deletePlanLine,
  deleteStandardLoad,
  getCassetteLayout,
  getPlan,
  getPlanByDay,
  getSettlementContext,
  importLayouts,
  issuePlan,
  listCassetteLayouts,
  listLayoutImportRuns,
  listStandardLoads,
  printPlan,
  recordSpareUse,
  reopenPlanLine,
  saveCassetteLayout,
  updatePlanLine,
  updateStandardLoad,
} from './settlements.controller';

const MachineParamSchema = z.object({ machineId: objectId() }).strict();
const IdParamSchema = z.object({ id: objectId() }).strict();
const PlanParamSchema = z.object({ planId: objectId() }).strict();
const LineParamSchema = z.object({ planId: objectId(), lineId: objectId() }).strict();

const perUser = (req: Request): string | null => authContextOrNull(req)?.userId ?? null;

export const buildAtmSettlementsRouter = (): Router => {
  const router = Router();
  const layoutView = authorize('atmCassetteLayout.view');
  const layoutManage = authorize('atmCassetteLayout.manage');
  const planView = authorize('atmSettlementPlan.view');
  const planManage = authorize('atmSettlementPlan.manage');
  const eitherView = authorizeAny('atmCassetteLayout.view', 'atmSettlementPlan.view');

  // S1
  router.get(
    '/context',
    authenticate,
    eitherView,
    validate({ query: AtmSettlementContextQuerySchema }),
    asyncHandler(getSettlementContext),
  );

  // Layouts: S2, S3 and S4 before S5/S6 (literal paths first).
  router.get(
    '/layouts',
    authenticate,
    layoutView,
    validate({ query: AtmSettlementBankQuerySchema }),
    asyncHandler(listCassetteLayouts),
  );
  router.get(
    '/layouts/import/runs',
    authenticate,
    layoutView,
    validate({ query: AtmSettlementBankQuerySchema }),
    asyncHandler(listLayoutImportRuns),
  );
  router.post(
    '/layouts/import',
    noStore,
    authenticate,
    authorize('atmCassetteLayout.import'),
    rateLimit({ name: 'atm-layout-import', windowSeconds: 60, max: 6, keyOf: perUser }),
    workbookUpload(MASTER_IMPORT_MAX_MB),
    asyncHandler(importLayouts),
  );
  router.get(
    '/layouts/:machineId',
    authenticate,
    layoutView,
    validate({ params: MachineParamSchema }),
    asyncHandler(getCassetteLayout),
  );
  router.put(
    '/layouts/:machineId',
    authenticate,
    layoutManage,
    validate({ body: SaveAtmCassetteLayoutSchema, params: MachineParamSchema }),
    asyncHandler(saveCassetteLayout),
  );

  // Standard loads: S7–S10.
  router.get(
    '/standard-loads',
    authenticate,
    eitherView,
    validate({ query: AtmSettlementBankQuerySchema }),
    asyncHandler(listStandardLoads),
  );
  router.post(
    '/standard-loads',
    authenticate,
    layoutManage,
    validate({ body: SaveAtmStandardLoadSchema }),
    asyncHandler(createStandardLoad),
  );
  router.put(
    '/standard-loads/:id',
    authenticate,
    layoutManage,
    validate({ body: SaveAtmStandardLoadSchema, params: IdParamSchema }),
    asyncHandler(updateStandardLoad),
  );
  router.delete(
    '/standard-loads/:id',
    authenticate,
    layoutManage,
    validate({ query: AtmVersionQuerySchema, params: IdParamSchema }),
    asyncHandler(deleteStandardLoad),
  );

  // Plans: S11–S22.
  router.get(
    '/plans',
    authenticate,
    planView,
    validate({ query: AtmSettlementPlanQuerySchema }),
    asyncHandler(getPlanByDay),
  );
  router.post(
    '/plans',
    authenticate,
    planManage,
    validate({ body: CreateAtmPlanSchema }),
    asyncHandler(createPlan),
  );
  router.get(
    '/plans/:planId',
    authenticate,
    planView,
    validate({ params: PlanParamSchema }),
    asyncHandler(getPlan),
  );
  router.post(
    '/plans/:planId/lines',
    authenticate,
    planManage,
    validate({ body: AddAtmPlanLinesSchema, params: PlanParamSchema }),
    asyncHandler(addPlanLines),
  );
  router.post(
    '/plans/:planId/spare-lines',
    authenticate,
    planManage,
    validate({ body: AddAtmSpareLineSchema, params: PlanParamSchema }),
    asyncHandler(addSpareLine),
  );
  router.post(
    '/plans/:planId/issue',
    authenticate,
    planManage,
    validate({ body: IssueAtmPlanSchema, params: PlanParamSchema }),
    asyncHandler(issuePlan),
  );
  router.post(
    '/plans/:planId/prints',
    authenticate,
    planView,
    rateLimit({ name: 'atm-settlement-print', windowSeconds: 60, max: 30, keyOf: perUser }),
    validate({ body: AtmSettlementPrintSchema, params: PlanParamSchema }),
    asyncHandler(printPlan),
  );
  router.patch(
    '/plans/:planId/lines/:lineId',
    authenticate,
    planManage,
    validate({ body: UpdateAtmPlanLineSchema, params: LineParamSchema }),
    asyncHandler(updatePlanLine),
  );
  router.delete(
    '/plans/:planId/lines/:lineId',
    authenticate,
    planManage,
    validate({ query: AtmVersionQuerySchema, params: LineParamSchema }),
    asyncHandler(deletePlanLine),
  );
  router.post(
    '/plans/:planId/lines/:lineId/reopen',
    authenticate,
    planManage,
    validate({ body: AtmLineReasonSchema, params: LineParamSchema }),
    asyncHandler(reopenPlanLine),
  );
  router.post(
    '/plans/:planId/lines/:lineId/cancel',
    authenticate,
    planManage,
    validate({ body: AtmLineReasonSchema, params: LineParamSchema }),
    asyncHandler(cancelPlanLine),
  );
  router.post(
    '/plans/:planId/lines/:lineId/spare-use',
    authenticate,
    planManage,
    validate({ body: AtmSpareUseSchema, params: LineParamSchema }),
    asyncHandler(recordSpareUse),
  );
  return router;
};
