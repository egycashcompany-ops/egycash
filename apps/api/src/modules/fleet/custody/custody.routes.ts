import { Router } from 'express';
import {
  FleetCustodySummaryQuerySchema,
  ListFleetCustodyMovementsQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { custodySummary, listCustodyMovements } from './custody.controller';

export const buildFleetCustodyRouter = (): Router => {
  const router = Router();
  // The figures and the per-car summary — over the whole filtered set.
  router.get(
    '/summary',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: FleetCustodySummaryQuerySchema }),
    asyncHandler(custodySummary),
  );
  router.get(
    '/movements',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: ListFleetCustodyMovementsQuerySchema }),
    asyncHandler(listCustodyMovements),
  );
  return router;
};
