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
import { Types, type Model } from 'mongoose';
import {
  type LocalizedString,
  type PlacementDto,
  type PlacementLabelDto,
  type RecruitmentStageKind,
  type StageRefDto,
  type WorkflowStateDto,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { availableActions } from './workflow-actions';
import { stageBindingsInOrder } from './workflow-engine';
import { emptyPlacement, emptyPlacementLabel, type StageDocFields } from './stage-fields';
import { type StageObject, type WorkflowStatus } from './workflow-transitions';

/** What the state builder needs off the applicant — the seam keeps this feature out of Applicants. */
export interface WorkflowApplicant {
  _id: Types.ObjectId;
  code: string;
  status: string;
  placement: StageDocFields['placementSnapshot'];
  placementLabel: StageDocFields['placementSnapshotLabel'];
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

/** A live stage row, as far as this module cares. */
interface LiveRow extends StageDocFields {
  _id: Types.ObjectId;
  status: string;
  stageName?: LocalizedString;
  phaseName?: LocalizedString;
  stageOrder?: number;
  phaseOrder?: number;
}

const STAGE_KIND: Record<StageObject, RecruitmentStageKind> = {
  screening: 'screening',
  interview: 'interview',
  evaluation: 'evaluation',
  offer: 'jobOffer',
};

/** The statuses that mean "this stage still has work on it" — where the candidate actually stands. */
const OPEN: Record<StageObject, readonly string[]> = {
  screening: ['waiting'],
  interview: ['waiting', 'scheduled', 'inProgress'],
  evaluation: ['waiting'],
  offer: ['waiting', 'draft', 'sent'],
};

const placementDto = (p: StageDocFields['placementSnapshot']): PlacementDto => ({
  jobPositionId: p.jobPositionId === null ? null : String(p.jobPositionId),
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

const stageRef = (object: StageObject, row: LiveRow): StageRefDto => {
  const kind = STAGE_KIND[object];
  const refId =
    object === 'interview'
      ? String((row as unknown as { stageId: Types.ObjectId }).stageId)
      : object === 'evaluation'
        ? String((row as unknown as { phaseId: Types.ObjectId }).phaseId)
        : null;
  return {
    kind,
    refId,
    key: refId === null ? kind : `${kind}:${refId}`,
    name: row.stageName ?? row.phaseName ?? null,
  };
};

/**
 * Where the candidate stands: the FURTHEST stage that still has open work, scanning the pipeline in
 * business order. A candidate with an open offer is at the offer even though their screening row
 * also exists — the later stage is the truthful answer to "what happens next?".
 */
const currentStage = async (
  applicantId: string,
): Promise<{ object: StageObject; row: LiveRow } | null> => {
  const oid = new Types.ObjectId(applicantId);
  let found: { object: StageObject; row: LiveRow } | null = null;
  for (const binding of stageBindingsInOrder()) {
    const row = await (binding.model as unknown as Model<LiveRow>)
      .findOne({ applicantId: oid, supersededAt: null, isDeleted: false, status: { $in: OPEN[binding.object] } })
      .sort({ attempt: -1 })
      .lean<LiveRow>()
      .exec();
    if (row !== null) found = { object: binding.object, row };
  }
  return found;
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

  // A candidate who has left the pipeline (hired, rejected, withdrawn) stands nowhere: their rows
  // all carry terminal statuses, which is exactly how they left every queue (I10/I14).
  const live = await currentStage(applicantId);

  return {
    applicantId: String(applicant._id),
    applicantCode: applicant.code,
    applicantStatus: applicant.status,
    stage: live === null ? null : stageRef(live.object, live.row),
    status: live === null ? null : live.row.status,
    attempt: live === null ? 1 : live.row.attempt,
    placement: placementDto(applicant.placement ?? emptyPlacement()),
    placementLabel: labelDto(applicant.placementLabel ?? emptyPlacementLabel()),
    availableActions:
      live === null
        ? availableActions('applicant', applicant.status as WorkflowStatus, ctx.permissions)
        : availableActions(live.object, live.row.status as WorkflowStatus, ctx.permissions, [
            // Not stage transitions, but the two other things a candidate screen offers (RW2/RW13).
            {
              key: 'reassign',
              permission: 'applicant.reassign',
              enabled: ctx.permissions['applicant.reassign'] !== undefined,
              reason: ctx.permissions['applicant.reassign'] === undefined ? 'requires applicant.reassign' : null,
            },
            {
              key: 'returnToStage',
              permission: 'applicant.returnToStage',
              enabled: ctx.permissions['applicant.returnToStage'] !== undefined,
              reason:
                ctx.permissions['applicant.returnToStage'] === undefined
                  ? 'requires applicant.returnToStage'
                  : null,
            },
          ]),
  };
};
