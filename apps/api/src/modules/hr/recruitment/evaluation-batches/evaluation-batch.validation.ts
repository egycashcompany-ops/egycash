// Route-level schemas (ADR-003): every schema is re-exported from the contracts package, so the
// wire shape has exactly one definition. Only the path-parameter schemas live here.
import { z } from 'zod';
import { objectId } from '@ecms/contracts';

export {
  AddBatchItemsSchema,
  BulkBatchItemsSchema,
  BulkEvaluationBatchesSchema,
  CancelEvaluationBatchSchema,
  CloseEvaluationBatchSchema,
  CreateEvaluationBatchSchema,
  DecideBatchItemSchema,
  IssueEvaluationBatchSchema,
  ListBatchCandidatesQuerySchema,
  ListEvaluationBatchesQuerySchema,
  RemoveBatchItemSchema,
  UpdateEvaluationBatchSchema,
  UploadBatchResultSchema,
  VoidBatchItemSchema,
} from '@ecms/contracts';

export const EvaluationBatchIdParamSchema = z.object({ id: objectId() }).strict();

/** Items are addressed by applicant inside their batch — there is no separate item id. */
export const EvaluationBatchItemParamSchema = z
  .object({ id: objectId(), applicantId: objectId() })
  .strict();
