import { Router } from 'express';
import {
  FleetCustodyDashboardQuerySchema,
  FleetCustodySummaryQuerySchema,
  ListFleetCustodyMovementsQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { custodyDashboard, custodySummary, listCustodyMovements } from './custody.controller';

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
  // «لوحة تحكم» — the same filters and grant as the figures, everything about them in detail.
  router.get(
    '/dashboard',
    authenticate,
    authorize('fleetCustody.view'),
    validate({ query: FleetCustodyDashboardQuerySchema }),
    asyncHandler(custodyDashboard),
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
