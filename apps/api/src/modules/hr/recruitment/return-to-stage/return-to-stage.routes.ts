// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest under
// /api/v1/hr/applicants, alongside the applicants router.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { previewReturnToStage, returnApplicantToStage } from './return-to-stage.controller';
import {
  ReturnToStageParamSchema,
  ReturnToStagePreviewQuerySchema,
  ReturnToStageSchema,
} from './return-to-stage.validation';

export const buildReturnToStageRouter = (): Router => {
  const router = Router();

  // The consequence preview the confirmation dialog renders — same resolution as the act.
  router.get(
    '/:id/return-to-stage/preview',
    authenticate,
    authorize('applicant.returnToStage'),
    validate({ query: ReturnToStagePreviewQuerySchema, params: ReturnToStageParamSchema }),
    asyncHandler(previewReturnToStage),
  );
  router.post(
    '/:id/return-to-stage',
    authenticate,
    authorize('applicant.returnToStage'),
    validate({ body: ReturnToStageSchema, params: ReturnToStageParamSchema }),
    asyncHandler(returnApplicantToStage),
  );

  return router;
};
