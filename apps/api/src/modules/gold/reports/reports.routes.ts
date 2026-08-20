// The three printed statements, all behind `goldReport.view`.
import { Router } from 'express';
import {
  GoldClientBalancesQuerySchema,
  GoldFundClosingQuerySchema,
  GoldFundMovementQuerySchema,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { goldClientBalances, goldFundClosing, goldFundMovement } from './reports.controller';

export const buildGoldReportsRouter = (): Router => {
  const router = Router();
  router.get(
    '/client-balances',
    authenticate,
    authorize('goldReport.view'),
    validate({ query: GoldClientBalancesQuerySchema }),
    asyncHandler(goldClientBalances),
  );
  router.get(
    '/fund-movement',
    authenticate,
    authorize('goldReport.view'),
    validate({ query: GoldFundMovementQuerySchema }),
    asyncHandler(goldFundMovement),
  );
  router.get(
    '/fund-closing',
    authenticate,
    authorize('goldReport.view'),
    validate({ query: GoldFundClosingQuerySchema }),
    asyncHandler(goldFundClosing),
  );
  return router;
};
