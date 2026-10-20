// The custody intervals across lines — «who had which line, when» — read-only by construction:
// intervals are opened and closed by the hand-over and the return, and never edited directly.
import { Router } from 'express';
import { ListItMobileLineAssignmentsQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { listItMobileLineAssignments } from './mobile-line.controller';

export const buildItMobileLineAssignmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItMobileLineAssignmentsQuerySchema }),
    asyncHandler(listItMobileLineAssignments),
  );
  return router;
};
