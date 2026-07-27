// Wires queue materialization to the facts that imply it (I15). Workflow transitions arrive
// through the engine's dispatcher; applicant registration and the move-to-offer action arrive
// through the platform event bus, since neither is a stage transition.
//
// Every handler is idempotent — `ensureStageRecord` is — so a redelivered event opens nothing
// twice, and a failure never rolls back the decision that triggered it.
import { setStageMaterializer } from '../applicants';
import { onWorkflowEvent, WorkflowEvents } from '../workflow';
import { queueMaterializerService } from './queue-materializer.service';

let registered = false;

/** Idempotent — safe to call from module load and from tests. */
export const registerQueueMaterializer = (): void => {
  if (registered) return;
  registered = true;

  onWorkflowEvent('recruitment.materialize', '*', async (event) => {
    const applicantId = String(event.applicantId);
    if (event.name === WorkflowEvents.ScreeningAccepted || event.name === WorkflowEvents.ScreeningRedecided) {
      if (event.to !== 'accepted') return;
      await queueMaterializerService.safely('firstInterview', () =>
        queueMaterializerService.openFirstInterview(applicantId, null),
      );
      return;
    }
    if (event.name === WorkflowEvents.InterviewCompleted || event.name === WorkflowEvents.InterviewRedecided) {
      const payload = event.payload as { outcome?: unknown; stageOrder?: unknown };
      if (payload.outcome !== 'passed' || typeof payload.stageOrder !== 'number') return;
      await queueMaterializerService.safely('nextInterviewOrEvaluations', () =>
        queueMaterializerService.advanceAfterInterview(applicantId, payload.stageOrder as number, null),
      );
    }
  });

  // Registration and move-to-offer are not stage transitions, so they arrive through the
  // Applicants seam instead of the workflow dispatcher — and synchronously, so the queue row
  // exists by the time the caller's response is written.
  setStageMaterializer({
    onRegistered: (applicantId) =>
      queueMaterializerService.safely('screening', () =>
        queueMaterializerService.openScreening(applicantId, null),
      ),
    onMovedToOffer: (applicantId) =>
      queueMaterializerService.safely('jobOffer', () =>
        queueMaterializerService.openJobOffer(applicantId, null),
      ),
  });
};

/** Test seam. */
export const resetQueueMaterializerRegistration = (): void => {
  registered = false;
};
