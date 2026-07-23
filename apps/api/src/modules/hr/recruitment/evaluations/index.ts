// Public surface of the Evaluations feature. The HR manifest and tests import from here;
// internal files are not reached across the feature boundary (ADR-003).
export { buildEvaluationsRouter, buildEvaluationPhasesRouter } from './evaluation.routes';
export { evaluationService } from './evaluation.service';
export { evaluationPhaseService } from './evaluation-phase.service';
export { ensureEvaluationCategory } from './evaluation.files';
export { type EvaluationDoc } from './evaluation.model';
export { type EvaluationPhaseDoc } from './evaluation-phase.model';
