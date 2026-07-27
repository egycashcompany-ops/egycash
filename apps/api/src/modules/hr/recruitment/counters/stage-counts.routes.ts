// Router: authenticate → validate → controller. Mounted by the HR manifest under /api/v1/hr.
//
// Deliberately NOT gated by a single `authorize(...)`: the endpoint spans every recruitment
// stage and returns exactly the ones the caller may see, so the per-stage permission check
// lives in the service. Any authenticated user may ask; a caller with no recruitment
// permissions gets an empty list rather than a 403.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { listStageCounts } from './stage-counts.controller';
import { RecruitmentStageCountsQuerySchema } from './stage-counts.validation';

export const buildRecruitmentCountersRouter = (): Router => {
  const router = Router();

  router.get(
    '/stage-counts',
    authenticate,
    validate({ query: RecruitmentStageCountsQuerySchema }),
    asyncHandler(listStageCounts),
  );

  return router;
};
