// Routes authenticate and carry the COARSE grant; the service authorizes the rest — who the
// subject is, how old the day is, whether the month is closed. None of that is visible to a route
// middleware, and splitting it would mean checking the same facts twice.
//
// The list rides `attendance.decide`'s data scope, so a branch manager sees their own branch's
// decisions and HR sees the organization's — the same posture the regularization queue has.
import { Router } from 'express';
import { z } from 'zod';
import {
  objectId,
  CreateAttendanceDecisionSchema,
  DecideAttendanceDecisionSchema,
  ListAttendanceDecisionsQuerySchema,
  RevokeAttendanceDecisionSchema,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  createDecision,
  decideDecision,
  listDecisions,
  revokeDecision,
} from './decision.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAttendanceDecisionsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('attendance.decide'),
    validate({ query: ListAttendanceDecisionsQuerySchema }),
    asyncHandler(listDecisions),
  );
  router.post(
    '/',
    authenticate,
    authorize('attendance.decide'),
    validate({ body: CreateAttendanceDecisionSchema }),
    asyncHandler(createDecision),
  );
  // Approving is its OWN key, not a stronger form of deciding: the old-day path exists so that
  // somebody other than the deciding manager looks at it, and a single grant covering both would
  // let one person do the whole thing.
  router.post(
    '/:id/decide',
    authenticate,
    authorize('attendance.decideApprove'),
    validate({ body: DecideAttendanceDecisionSchema, params: IdParamSchema }),
    asyncHandler(decideDecision),
  );
  router.post(
    '/:id/revoke',
    authenticate,
    authorize('attendance.decide'),
    validate({ body: RevokeAttendanceDecisionSchema, params: IdParamSchema }),
    asyncHandler(revokeDecision),
  );

  return router;
};
