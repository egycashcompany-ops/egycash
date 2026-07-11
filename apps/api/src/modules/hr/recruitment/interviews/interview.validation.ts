// Zod schemas re-exported from packages/contracts (shared with the frontend), plus
// route-local param schemas. The module validates every boundary (ADR-007).
export {
  ScheduleInterviewSchema,
  RescheduleInterviewSchema,
  CancelInterviewSchema,
  SubmitInterviewEvaluationSchema,
  DecideInterviewSchema,
  ListInterviewsQuerySchema,
  CreateInterviewStageSchema,
  UpdateInterviewStageSchema,
  ListInterviewStagesQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const InterviewIdParamSchema = z.object({ id: objectId() }).strict();
export const InterviewStageIdParamSchema = z.object({ id: objectId() }).strict();
