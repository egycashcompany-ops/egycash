// The captain-facing surface. `operationsExecution.own` is the captain's own grant (design §16.2):
// it authorizes acting on YOUR OWN work, and the service pins "your own" to the token's employee.
// Holding it grants no visibility into anybody else's day, because no endpoint here takes a
// captain id at all.
import { Router } from 'express';
import { OperationsMobileDayQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getMyDay } from './mobile.controller';

export const buildOperationsMobileRouter = (): Router => {
  const router = Router();
  router.get(
    '/my-day',
    authenticate,
    authorize('operationsExecution.own'),
    validate({ query: OperationsMobileDayQuerySchema }),
    asyncHandler(getMyDay),
  );
  return router;
};
