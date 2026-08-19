// The vault dashboard. One grant — `goldReport.view` — covers the board and the printed reports:
// they answer the same question at different resolutions, and the gold system gated both on its
// single `view_reports` permission.
import { Router } from 'express';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler } from '../../../platform/web';
import { getGoldDashboardCharts, getGoldDashboardStats } from './dashboard.controller';

export const buildGoldDashboardRouter = (): Router => {
  const router = Router();
  router.get(
    '/stats',
    authenticate,
    authorize('goldReport.view'),
    asyncHandler(getGoldDashboardStats),
  );
  router.get(
    '/charts',
    authenticate,
    authorize('goldReport.view'),
    asyncHandler(getGoldDashboardCharts),
  );
  return router;
};
