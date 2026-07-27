// Public surface of the return-to-stage feature (RW13). The HR manifest and tests import from
// here; internal files are not reached across the feature boundary (ADR-003).
export { buildReturnToStageRouter } from './return-to-stage.routes';
export { returnToStageService, type ReturnPlan } from './return-to-stage.service';
