// May this screen still move the candidate? Asked once, of the server, by every stage page.
//
// WHAT WENT WRONG WITHOUT IT. Each stage page decided what to offer from the status of its OWN
// record, which cannot see the rest of the pipeline. A candidate at «الفحص الأمني» still had
// «بدء المقابلة» and «تعديل القرار» on their screening, and «نقل لمرحلة عرض العمل» on their first
// interview: every button correct about its own row and wrong about the person. Pressing one
// re-opened a stage they had left or jumped them past a decision nobody had taken.
//
// So capability is not derived here at all. `WorkflowStateDto` already carries it — `stageRecords`
// says which records the candidate has moved past, and `availableActions` says what the caller may
// do, from the rulebook and the caller's own grants (I10). This hook is a reader over that answer,
// so the button a page draws and the gate the request meets come from the same sentence.
//
// IT FAILS CLOSED. While the state is still loading there is no answer yet, and a page that showed
// its actions meanwhile would be showing them on exactly the evidence that misled it before. So
// `ready` is false until the server has spoken, and every `may*` reader says no until then.
import { type WorkflowStateDto } from '@ecms/contracts';
import { useWorkflowState } from './useWorkflowMutation';

export interface StageAuthority {
  /** The server has answered. Until it has, nothing that changes the pipeline is offered. */
  ready: boolean;
  /**
   * The candidate has moved past this record — it is history, and read-only.
   *
   * A record the state does not list is also past: a superseded attempt is read-only forever (I1)
   * and is deliberately absent, so an id from the timeline or an old tab answers `true` here.
   */
  isPassed: (recordId: string) => boolean;
  /** This record is where the candidate stands, and it still has work on it. */
  isLive: (recordId: string) => boolean;
  /**
   * May this record's decision still be CORRECTED? (D7.) True while nothing has been built on it.
   *
   * Asked separately from `isPassed` on purpose: a decided stage is past — its forward actions are
   * gone — and «تعديل القرار» may still be right, until somebody acts on what the decision opened.
   */
  isCorrectable: (recordId: string) => boolean;
  /** An action the server says is available AND the caller holds the permission for. */
  may: (actionKey: string) => boolean;
  /** The candidate has left the pipeline — hired, rejected or withdrawn. */
  closed: boolean;
  /** The raw answer, for the few callers that need more than the readers above. */
  state: WorkflowStateDto | undefined;
}

const OPEN_STATUSES = new Set(['waiting', 'scheduled', 'inProgress', 'draft', 'sent']);

/**
 * The readers, as a pure function of the server's answer — so the rule every stage page acts on is
 * testable without a page, a provider or a request. `undefined` is "no answer yet".
 */
export const stageAuthorityOf = (state: WorkflowStateDto | undefined): StageAuthority => {
  const ready = state !== undefined;
  const records = state?.stageRecords ?? [];
  const at = (recordId: string) => records.find((r) => r.recordId === recordId);

  return {
    ready,
    isPassed: (recordId) => {
      if (!ready) return true;
      const row = at(recordId);
      return row === undefined || row.passed;
    },
    isLive: (recordId) => {
      if (!ready) return false;
      const row = at(recordId);
      return row !== undefined && !row.passed && OPEN_STATUSES.has(row.status);
    },
    isCorrectable: (recordId) => {
      if (!ready) return false;
      const row = at(recordId);
      return row !== undefined && row.correctable;
    },
    may: (actionKey) =>
      state !== undefined && state.availableActions.some((a) => a.key === actionKey && a.enabled),
    closed: state !== undefined && state.applicantStatus !== 'new',
    state,
  };
};

export const useStageAuthority = (applicantId: string): StageAuthority =>
  stageAuthorityOf(useWorkflowState(applicantId));
