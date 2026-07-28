// Public surface of the recruitment workflow engine (ADR-003). Stage features call
// `recruitmentWorkflowEngine` for every state change and never write a status themselves;
// consumers subscribe through `onWorkflowEvent`.
export {
  recruitmentWorkflowEngine,
  type EnsureStageInput,
  type StageBinding,
  type StageRecord,
  type TransitionInput,
  type TransitionResult,
} from './workflow-engine';
export {
  deliver,
  dispatchPendingWorkflowEvents,
  onWorkflowEvent,
  resetWorkflowConsumers,
  workflowConsumerIds,
  type WorkflowEventConsumer,
} from './workflow-dispatcher';
export {
  registerStageBinding,
  resetStageBindings,
} from './workflow-engine';
export { runBulk, type BulkRunOptions } from './bulk-runner';
// I6 — the one envelope every workflow endpoint answers with, and the pieces that build it.
export { withBulkWorkflowEnvelope, withWorkflowEnvelope } from './workflow-envelope';
export { captureWorkflowEvents } from './workflow-capture';
export {
  buildWorkflowState,
  registerWorkflowApplicantReader,
  resetWorkflowApplicantReader,
  type WorkflowApplicant,
} from './workflow-state';
export { availableActions, permissionForAction, unmappedActions } from './workflow-actions';
export { stageBindingsInOrder } from './workflow-engine';
export { WorkflowEvents, type WorkflowEventName } from './workflow-events';
export {
  auditWorkflowEvent,
  projectToTimeline,
  registerRecruitmentWorkflowConsumers,
  resetRecruitmentWorkflowConsumerRegistration,
} from './workflow-consumers';
export { type WorkflowEventDoc } from './workflow-event.model';
export { workflowEventRepository } from './workflow-event.repository';
export {
  LIFECYCLE_EVENTS,
  LIFECYCLE_RULES,
  lifecycleEffectOf,
  validateLifecycleEvent,
  type LifecycleEvent,
} from './workflow-lifecycle';
export {
  STAGE_OBJECTS,
  WORKFLOW_TRANSITIONS,
  canTransition,
  transitionsFrom,
  validateTransition,
  type StageObject,
  type TransitionDef,
  type WorkflowObject,
  type WorkflowStatus,
} from './workflow-transitions';
export {
  assertNotWorkflowManaged,
  WORKFLOW_MANAGED_FIELDS,
} from './workflow-guard';
export {
  emptyPlacement,
  emptyPlacementLabel,
  placementLabelSchema,
  placementSchema,
  stageFields,
  type StageDocFields,
  type StagePlacement,
  type StagePlacementLabel,
} from './stage-fields';
export {
  attemptMarkerDto,
  placementDto,
  placementDtoOrNull,
  placementLabelDto,
} from './stage-mapper';
