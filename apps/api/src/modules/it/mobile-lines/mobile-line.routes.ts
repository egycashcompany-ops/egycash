// The mobile-line register's routes (FR-19), on the lines' own grants (2026-11-17 — «فى الـ IT ظبط
// صلاحيات الشاشات عشان أقدر أتحكم فيها»; until then the assets' grants carried them). Reads ride
// `itMobileLine.view`; registering `itMobileLine.create`; editing, suspending and reactivating
// `itMobileLine.edit`; handing over and taking back `itMobileLine.assign`, the one custody grant.
import { Router } from 'express';
import {
  AssignItMobileLineSchema,
  CreateItMobileLineSchema,
  ItMobileLineIdParamSchema,
  ItMobileLinesSummaryQuerySchema,
  ItMobileLineStatusActionSchema,
  ListItMobileLineHistoryQuerySchema,
  ListItMobileLinesQuerySchema,
  ReturnItMobileLineSchema,
  UpdateItMobileLineSchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  assignItMobileLine,
  createItMobileLine,
  getItMobileLine,
  getItMobileLinesSummary,
  listItMobileLineHistory,
  listItMobileLines,
  reactivateItMobileLine,
  returnItMobileLine,
  suspendItMobileLine,
  updateItMobileLine,
} from './mobile-line.controller';

export const buildItMobileLinesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itMobileLine.view'),
    validate({ query: ListItMobileLinesQuerySchema }),
    asyncHandler(listItMobileLines),
  );
  // Before the id routes, so the literal segment is not swallowed by the id matcher.
  router.get(
    '/summary',
    authenticate,
    authorize('itMobileLine.view'),
    validate({ query: ItMobileLinesSummaryQuerySchema }),
    asyncHandler(getItMobileLinesSummary),
  );
  router.post(
    '/',
    authenticate,
    authorize('itMobileLine.create'),
    validate({ body: CreateItMobileLineSchema }),
    asyncHandler(createItMobileLine),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('itMobileLine.view'),
    validate({ params: ItMobileLineIdParamSchema }),
    asyncHandler(getItMobileLine),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itMobileLine.edit'),
    validate({ body: UpdateItMobileLineSchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(updateItMobileLine),
  );
  router.get(
    '/:id/history',
    authenticate,
    authorize('itMobileLine.view'),
    validate({ query: ListItMobileLineHistoryQuerySchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(listItMobileLineHistory),
  );

  // ── Custody and state — named actions, never a PATCH of `status` (FR-2) ──
  router.post(
    '/:id/assign',
    authenticate,
    authorize('itMobileLine.assign'),
    validate({ body: AssignItMobileLineSchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(assignItMobileLine),
  );
  router.post(
    '/:id/return',
    authenticate,
    authorize('itMobileLine.assign'),
    validate({ body: ReturnItMobileLineSchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(returnItMobileLine),
  );
  // Stopping a line on the network changes what the register says about it, not who holds it —
  // the edit grant, not the custody one.
  router.post(
    '/:id/suspend',
    authenticate,
    authorize('itMobileLine.edit'),
    validate({ body: ItMobileLineStatusActionSchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(suspendItMobileLine),
  );
  router.post(
    '/:id/reactivate',
    authenticate,
    authorize('itMobileLine.edit'),
    validate({ body: ItMobileLineStatusActionSchema, params: ItMobileLineIdParamSchema }),
    asyncHandler(reactivateItMobileLine),
  );
  return router;
};
