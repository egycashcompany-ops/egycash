// Reassignment (RW2/RW3) — moving a live candidate to a different Position and/or Branch.
//
// This is deliberately NOT part of the applicant PATCH: a routine data correction must never
// silently move a candidate, so it is its own audited action with a mandatory reason and its own
// permission (`applicant.reassign`).
//
// One action does all of:
//   1. write `placement` on the applicant and sync the ADR-015 scope field `branchId`;
//   2. append to `placementHistory[]`;
//   3. sync the SCOPE FIELD on the candidate's stage records, so a branch-scoped HR user keeps
//      seeing their full history and the queues follow the candidate — the scope field only,
//      never a decision and never a `placementSnapshot` (RW4: history is never rewritten);
//   4. write one timeline entry PER MOVED DIMENSION, correlated so they read as one act (A2);
//   5. drive a live offer's revision so the package follows the placement (RW2 step 5).
//
// The editing window closes at offer acceptance (RW3/OQ-3): after that the accepted snapshot is
// the contractual artifact, so the path is revise / withdraw → re-accept → hire.
import { Types } from 'mongoose';
import {
  HrRecruitmentWorkflowEvents,
  type ReassignPlacement,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { screeningService } from '../screening';
import { interviewService } from '../interviews';
import { evaluationService } from '../evaluations';
import { jobOfferService } from '../job-offers';
import { recruitmentTimelineService } from '../timeline';
import { newCorrelationId } from '../timeline';
import { type StagePlacementLabel } from '../workflow/stage-fields';
import {
  applicantService,
  changedDimensions,
  resolvePlacement,
  type ApplicantDoc,
} from '../applicants';
import { type PlacementChange } from '../applicants/applicant.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'applicant', entityId: id });

const label = (l: StagePlacementLabel): string =>
  [l.position, l.branch].filter((v) => v !== null && v !== '').join(' · ') || '—';

/**
 * The stage services whose records carry the candidate's denormalized scope field. Each exposes
 * its own sync so this file never reaches into another feature's collection (ADR-003).
 */
const syncStageScopes = async (
  applicantId: string,
  branchId: Types.ObjectId | null,
): Promise<void> => {
  await Promise.all([
    screeningService.syncApplicantBranch(applicantId, branchId),
    interviewService.syncApplicantBranch(applicantId, branchId),
    evaluationService.syncApplicantBranch(applicantId, branchId),
    jobOfferService.syncApplicantBranch(applicantId, branchId),
  ]);
};

/** The editing window (RW2/A1): a live candidate with no accepted offer. */
const assertReassignable = async (applicant: ApplicantDoc): Promise<void> => {
  if (applicant.status !== 'new') {
    throw new BusinessRuleError('only a candidate in the active pipeline can be reassigned');
  }
  const accepted = await jobOfferService.acceptedOfferFor(String(applicant._id));
  if (accepted !== null) {
    throw new BusinessRuleError(
      'this candidate has an accepted offer — revise or withdraw it, have it re-accepted, then hire',
    );
  }
};

export const reassignPlacement = async (
  ctx: AuthContext,
  id: string,
  input: ReassignPlacement,
  scope: ScopeSelector,
): Promise<ApplicantDoc> => {
  const before = await applicantService.getById(id, scope);
  await assertReassignable(before);

  const { placement, label: toLabel } = await resolvePlacement(input.placement);
  const changed = changedDimensions(before.placement, placement);
  if (changed.length === 0) return before; // nothing moved — not an error, just a no-op

  const now = new Date();
  const correlationId = newCorrelationId();
  const change: PlacementChange = {
    from: before.placement,
    to: placement,
    fromLabel: before.placementLabel,
    toLabel,
    changed,
    reason: input.reason,
    note: input.note ?? null,
    source: input.source,
    sourceEntityType: input.sourceRef?.entityType ?? null,
    sourceEntityId:
      input.sourceRef === undefined ? null : new Types.ObjectId(input.sourceRef.entityId),
    by: new Types.ObjectId(ctx.userId),
    at: now,
    correlationId,
  };

  const updated = await applicantService.writePlacement(
    ctx,
    id,
    input.version,
    scope,
    {
      placement,
      placementLabel: toLabel,
      // The ADR-015 scope field is a MIRROR of placement.branchId — this service is its writer.
      branchId: placement.branchId,
      placementHistory: [...(before.placementHistory ?? []), change],
    },
  );

  // Step 3 — the candidate's history follows them, so a branch-scoped user never loses sight of it.
  await syncStageScopes(id, placement.branchId);

  await auditService.record({
    entityRef: entityRef(id),
    action: 'update',
    changes: [
      { field: 'placement', old: label(before.placementLabel), new: label(toLabel) },
      { field: 'reason', old: null, new: input.reason },
      { field: 'changed', old: null, new: changed.join(',') },
    ],
  });

  // Step 4 — one entry per moved DIMENSION KIND, all sharing a correlation id so the timeline
  // shows "moved branch AND position" as one act rather than two unrelated events (A2). The
  // vocabulary distinguishes the branch move from everything else that redefines the seat.
  const entryTypes = new Set(changed.map((d) => (d === 'branch' ? 'branchChanged' : 'positionChanged')));
  for (const type of entryTypes) {
    await recruitmentTimelineService.record({
      applicantId: id,
      applicantCode: before.code,
      branchId: placement.branchId,
      type,
      correlation: { type: 'placementChange', id: correlationId },
      entity: { type: 'applicant', id },
      discriminator: `${correlationId}:${type}`,
      actorUserId: ctx.userId,
      reason: input.reason,
      note: input.note ?? null,
      placement,
      placementLabel: toLabel,
      at: now,
      metadata: { changed, from: label(before.placementLabel), to: label(toLabel) },
    });
  }

  await emit(HrRecruitmentWorkflowEvents.PlacementChanged, {
    applicantId: id,
    applicantCode: before.code,
    from: before.placement,
    to: placement,
    changed,
    reason: input.reason,
    source: input.source,
    correlationId,
  });

  // Step 5 — a live offer follows the placement as a normal versioned revision.
  await jobOfferService.followPlacement(ctx, id, placement, scope).catch(() => null);

  return updated;
};
