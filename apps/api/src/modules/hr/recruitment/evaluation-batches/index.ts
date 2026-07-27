// Public surface of the Evaluation Batches feature (RW8). The HR manifest and tests import from
// here; internal files are not reached across the feature boundary (ADR-003).
export { buildEvaluationBatchesRouter } from './evaluation-batch.routes';
export { evaluationBatchService } from './evaluation-batch.service';
export { buildEvaluationBatchPackage } from './evaluation-batch-package';
export { ensureEvaluationBatchCategory } from './evaluation-batch.files';
export { type EvaluationBatchDoc, type BatchItem } from './evaluation-batch.model';
