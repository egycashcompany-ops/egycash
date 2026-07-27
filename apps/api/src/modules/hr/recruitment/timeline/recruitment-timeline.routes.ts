// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest under
// /api/v1/hr/applicants, alongside the applicants router.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  addRecruitmentTimelineNote,
  listRecruitmentTimeline,
} from './recruitment-timeline.controller';
import {
  AddTimelineNoteSchema,
  ListRecruitmentTimelineQuerySchema,
  TimelineApplicantParamSchema,
} from './recruitment-timeline.validation';

export const buildRecruitmentTimelineRouter = (): Router => {
  const router = Router();

  // THE candidate history (I5): every screen reads this, no screen keeps its own.
  router.get(
    '/:id/timeline',
    authenticate,
    authorize('applicant.view'),
    validate({ query: ListRecruitmentTimelineQuerySchema, params: TimelineApplicantParamSchema }),
    asyncHandler(listRecruitmentTimeline),
  );
  // The one user-authored entry type; everything else is a projection of a workflow event.
  router.post(
    '/:id/timeline/notes',
    authenticate,
    authorize('applicant.edit'),
    validate({ body: AddTimelineNoteSchema, params: TimelineApplicantParamSchema }),
    asyncHandler(addRecruitmentTimelineNote),
  );

  return router;
};
