// Zod schemas re-exported from packages/contracts (shared with the frontend), plus route-local
// param schemas. The module validates every boundary (ADR-007).
export { ReturnToStageSchema } from '@ecms/contracts';

import { z } from 'zod';
import { objectId, RECRUITMENT_STAGE_KINDS } from '@ecms/contracts';

export const ReturnToStageParamSchema = z.object({ id: objectId() }).strict();

/** The preview takes the same target as the act, flattened for a query string. */
export const ReturnToStagePreviewQuerySchema = z
  .object({ kind: z.enum(RECRUITMENT_STAGE_KINDS), refId: objectId().optional() })
  .strict();
export type ReturnToStagePreviewQuery = z.infer<typeof ReturnToStagePreviewQuerySchema>;
