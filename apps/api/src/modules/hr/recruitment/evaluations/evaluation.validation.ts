// Zod schemas re-exported from packages/contracts (shared with the frontend), plus route-local
// param schemas. The module validates every boundary (ADR-007).
export {
  CreateEvaluationPhaseSchema,
  UpdateEvaluationPhaseSchema,
  ListEvaluationPhasesQuerySchema,
  OpenEvaluationSchema,
  DecideEvaluationSchema,
  UploadEvaluationFileSchema,
  RemoveEvaluationFileSchema,
  ListEvaluationsQuerySchema,
} from '@ecms/contracts';

import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export const EvaluationIdParamSchema = z.object({ id: objectId() }).strict();
export const EvaluationFileParamSchema = z.object({ id: objectId(), fileId: objectId() }).strict();
export const EvaluationPhaseIdParamSchema = z.object({ id: objectId() }).strict();
