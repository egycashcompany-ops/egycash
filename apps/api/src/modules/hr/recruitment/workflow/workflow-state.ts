// The candidate's CURRENT workflow state (I6/I1) — DERIVED on every read, stored nowhere.
//
// This is the `workflow` half of the envelope: where the candidate stands, on which attempt, under
// which placement, and what the caller may do next. Every value comes from the live stage records
// and the applicant's own status; nothing is cached and nothing is mirrored onto the applicant
// document, because a stored copy is the thing I1 exists to prevent.
//
// It reads through the engine's stage BINDINGS rather than the stage services, for the same reason
// the engine does: the stage features import the workflow folder, so importing them back would
// close a cycle. A binding is a model plus its name — enough to find the live row.
//
// The live rows come from `stage-frontier.ts` in ONE pass, which also answers which of them the
// candidate has moved PAST. The two questions are different — "what happens next?" must pick one
// row, "is this stage still live?" must not — and answering both from the same read is what keeps
// a stage page from having to derive either one for itself.
import { Types } from 'mongoose';
import {
  type PlacementDto,
  type PlacementLabelDto,
  type RecruitmentStageKind,
  type StageRecordStateDto,
  type StageRefDto,
  type WorkflowStateDto,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { availableActions } from './workflow-actions';
import { emptyPlacement, emptyPlacementLabel, type StageDocFields } from './stage-fields';
import {
  currentOf,
  isCorrectable,
  isPassed,
  liveStageRows,
  STAGE_KIND,
  type LiveStageRow,
} from './stage-frontier';
import { type WorkflowStatus } from './workflow-transitions';

/** What the state builder needs off the applicant — the seam keeps this feature out of Applicants. */
export interface WorkflowApplicant {
  _id: Types.ObjectId;
  code: string;
  status: string;
  placement: StageDocFields['placementSnapshot'];
  placementLabel: StageDocFields['placementSnapshotLabel'];
  /** Set once HR has explicitly moved the candidate to the Job Offer stage (I11). */
  movedToOfferAt?: Date | null;
}

type ApplicantReader = (applicantId: string) => Promise<WorkflowApplicant | null>;

let readApplicant: ApplicantReader = async () => null;

/**
 * Applicants registers its reader at module load — the same seam pattern as the stage bindings and
 * the queue materializer. Unregistered (unit tests, the worker) the state is simply unavailable,
 * which callers handle by returning `null` rather than failing an otherwise valid request.
 */
export const registerWorkflowApplicantReader = (reader: ApplicantReader): void => {
  readApplicant = reader;
};

/** Test seam. */
export const resetWorkflowApplicantReader = (): void => {
  readApplicant = async () => null;
};

const placementDto = (p: StageDocFields['placementSnapshot']): PlacementDto => ({
  jobTitleId: p.jobTitleId === null ? null : String(p.jobTitleId),
  departmentId: p.departmentId === null ? null : String(p.departmentId),
  branchId: p.branchId === null ? null : String(p.branchId),
  sectionId: p.sectionId === null ? null : String(p.sectionId),
});

const labelDto = (l: StageDocFields['placementSnapshotLabel']): PlacementLabelDto => ({
  position: l.position,
  branch: l.branch,
  department: l.department,
});

const stageRef = (row: LiveStageRow): StageRefDto => ({
  kind: STAGE_KIND[row.object],
  refId: row.refId,
  key: row.key,
  name: row.name,
});

/**
 * Just the stage KIND, for a reader that must not learn anything else.
 *
 * The applicant portal (P-HR-APP, D-APP-8) needs to tell a candidate roughly where they stand and
 * must not be handed the concrete interview stage by name, the attempt number, the row's status or
 * the actions a recruiter could take — all of which `buildWorkflowState` returns, correctly, to a
 * recruiter. Exposing the coarse fact on its own is what keeps the portal from having to take the
 * fine one and remember to throw most of it away.
 *
 * Widen this by adding another NARROW reader, never by returning more from this one.
 */
export const currentStageKind = async (
  applicantId: string,
): Promise<RecruitmentStageKind | null> => {
  if (!Types.ObjectId.isValid(applicantId)) return null;
  const live = currentOf(await liveStageRows(applicantId));
  // Through the same `StageObject` → kind map the recruiter-facing reader uses, so the two can
  // never disagree about what an internal object is called.
  return live === null ? null : STAGE_KIND[live.object];
};

/**
 * Build the envelope's `workflow` half. Returns null when the applicant cannot be read — a caller
 * with no candidate in scope (a catalog action) has no workflow state to report, and inventing an
 * empty one would be a lie the client would render.
 */
export const buildWorkflowState = async (
  ctx: AuthContext,
  applicantId: string,
): Promise<WorkflowStateDto | null> => {
  if (!Types.ObjectId.isValid(applicantId)) return null;
  const applicant = await readApplicant(applicantId);
  if (applicant === null) return null;

  const rows = await liveStageRows(applicantId);
  // A candidate who has left the pipeline (hired, rejected, withdrawn) stands nowhere: their rows
  // all carry terminal statuses, which is exactly how they left every queue (I10/I14).
  const live = currentOf(rows);
  const stageRecords: StageRecordStateDto[] = rows.map((row) => ({
    recordId: row.recordId,
    key: row.key,
    status: row.status,
    attempt: row.attempt,
    passed: isPassed(rows, row.rank),
    correctable: isCorrectable(rows, row.rank),
  }));

  // Moving to the Job Offer stage is HR's explicit call (I11) and belongs with the other two
  // non-transition moves below rather than in any stage's rulebook.
  //
  // IT IS DELIBERATELY NOT CONDITIONED ON THE CHECKS. The offer runs ALONGSIDE them: HR starts it
  // when they decide to, and clearing the last check moves the candidate by itself
  // (`moveToOfferOnceCleared`, «اي حد يخلص كشف الطبي يظهر … ك جاهزون لعرض العمل»). Requiring every
  // check first would have removed the first of those two paths — which the product's own hiring
  // fixtures take, eight suites' worth. What was wrong was WHERE the button appeared: on a stage
  // the candidate had left. That is a question about the page, and the pages answer it from
  // `stageRecords` now.
  const held = (permission: string): boolean => ctx.permissions[permission] !== undefined;
  const alreadyMoved = (applicant.movedToOfferAt ?? null) !== null;
  const moveToOfferReason = !held('applicant.moveToOffer')
    ? 'requires applicant.moveToOffer'
    : applicant.status !== 'new'
      ? `the candidate is ${applicant.status}`
      : alreadyMoved
        ? 'already in the Job Offer stage'
        : null;

  return {
    applicantId: String(applicant._id),
    applicantCode: applicant.code,
    applicantStatus: applicant.status,
    stage: live === null ? null : stageRef(live),
    status: live === null ? null : live.status,
    attempt: live === null ? 1 : live.attempt,
    placement: placementDto(applicant.placement ?? emptyPlacement()),
    placementLabel: labelDto(applicant.placementLabel ?? emptyPlacementLabel()),
    stageRecords,
    availableActions: availableActions(
      live === null ? 'applicant' : live.object,
      (live === null ? applicant.status : live.status) as WorkflowStatus,
      ctx.permissions,
      // THE EXTRAS ARE FOR AN ACTIVE CANDIDATE ONLY. A hired, rejected or withdrawn candidate is
      // not reassigned, not moved to an offer and not sent back a stage — offering any of those
      // would be offering to act on somebody who has left the pipeline (I14). This used to be
      // expressed as "only when a stage is open", which got the departed candidate right by
      // accident and the ACTIVE one wrong: once every check is decided nothing is open, and that
      // is precisely the moment `moveToOffer` matters.
      applicant.status !== 'new'
        ? []
        : [
            // Not stage transitions, but the three other things a candidate screen offers (RW2/RW13/I11).
            {
              key: 'reassign',
              permission: 'applicant.reassign',
              enabled: held('applicant.reassign'),
              reason: held('applicant.reassign') ? null : 'requires applicant.reassign',
            },
            {
              key: 'moveToOffer',
              permission: 'applicant.moveToOffer',
              enabled: moveToOfferReason === null,
              reason: moveToOfferReason,
            },
            {
              key: 'returnToStage',
              permission: 'applicantReturn.execute',
              enabled: held('applicantReturn.execute'),
              reason: held('applicantReturn.execute') ? null : 'requires applicantReturn.execute',
            },
          ],
    ),
  };
};
