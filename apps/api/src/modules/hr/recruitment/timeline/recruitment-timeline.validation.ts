// Zod schemas re-exported from packages/contracts (shared with the frontend), plus route-local
// param schemas. The module validates every boundary (ADR-007).
export { ListRecruitmentTimelineQuerySchema, AddTimelineNoteSchema } from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const TimelineApplicantParamSchema = z.object({ id: objectId() }).strict();
