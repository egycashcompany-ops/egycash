// The IT home dashboard (design §11, §12) — «عايزك تعمل فى الـ /it الرئيسية.. Dashboard بدل اللى
// موجود فيها يظهر إجمالى الأصول وإيه فى المخزن وإيه متسلم بس أقدر أفلتر بـالفئة».
//
// Read-only, on the asset register's read grant and no key of its own: the dashboard shows what
// the register and the custody list already show its reader, counted. Every panel the page draws
// from another surface (the lines, the consumables, the help desk) is read from that surface's own
// endpoint under that surface's own grant — nothing here widens anybody's reach.
import { Router } from 'express';
import { ItDashboardQuerySchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getItDashboardActivity, getItDashboardAssets } from './dashboard.controller';

export const buildItDashboardRouter = (): Router => {
  const router = Router();
  router.get(
    '/assets',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ItDashboardQuerySchema }),
    asyncHandler(getItDashboardAssets),
  );
  router.get(
    '/activity',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ItDashboardQuerySchema }),
    asyncHandler(getItDashboardActivity),
  );
  return router;
};
