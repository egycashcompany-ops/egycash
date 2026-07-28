// The recruitment timeline's repair task (I5).
//
// `hr_recruitment_timeline` is THE history: every screen reads it and no screen keeps its own. That
// makes a missing entry invisible rather than loud — nothing errors, the history is simply shorter
// than the truth. Two holes can produce one, and this task closes both:
//
//   ① An event that was committed but never projected. The engine writes the aggregate change and
//      its event in ONE transaction and publishes after commit (I15), so a process killed in that
//      gap leaves a durable event with no entry. The outbox sweep normally redelivers it; this is
//      the belt to that braces, and it also catches an entry deleted or lost after the fact.
//   ② An entry that has no event to replay. Two facts are not workflow transitions and so were
//      never in the outbox — the application itself (`applied`) and the identity check
//      (`identityVerified`). Both are written with `recordSafe`, which logs and swallows rather
//      than failing the business operation that produced them, on the explicit promise that
//      reconciliation would rebuild them. This is that promise being kept.
//
// Rebuilding is safe because both halves are keyed, not timed. ① replays through the same
// projection the dispatcher uses, which derives its `sourceKey` from the event's own id. ② derives
// its `sourceKey` from facts on the applicant document — never the clock, never a random value —
// so the key a rebuild computes is the key the original write used, and the unique index turns a
// duplicate into a no-op (`append` returns the stored row). Running this twice changes nothing;
// running it on a healthy database changes nothing.
//
// It lives at the module level rather than inside a feature because it reads across three of them
// (the outbox, the timeline, the applicant registry) — the same reason the boot migration does.
import { logger } from '../../../infrastructure/logging/logger';
import { ApplicantModel, type ApplicantDoc } from './applicants/applicant.model';
import { ApplicantSourceModel } from './applicants/applicant-source.model';
import { recruitmentTimelineService, timelineSourceKey } from './timeline';
import { projectToTimeline, workflowEventRepository } from './workflow';

/** What one run put back. Every number is zero on a healthy database. */
export interface TimelineReconcileReport {
  /** Committed workflow events that had no timeline entry, now replayed. */
  eventsReplayed: number;
  /** `applied` entries rebuilt from the applicant document. */
  appliedRebuilt: number;
  /** `identityVerified` entries rebuilt from the applicant document. */
  identityRebuilt: number;
  /** Repairs that threw. Logged, never rethrown — one bad row must not stop the sweep. */
  failed: number;
}

const EMPTY: TimelineReconcileReport = {
  eventsReplayed: 0,
  appliedRebuilt: 0,
  identityRebuilt: 0,
  failed: 0,
};

/**
 * ① Replay events whose projection is missing.
 *
 * The scan is over events, not entries, because the event is the durable fact and the entry is the
 * projection of it — asking "which facts have no projection?" is the only direction that can find
 * an absence.
 */
const replayUnprojectedEvents = async (
  report: TimelineReconcileReport,
  batchSize: number,
): Promise<void> => {
  const events = await workflowEventRepository.listForReconciliation(batchSize);
  if (events.length === 0) return;

  const projected = new Set(
    (await recruitmentTimelineService.findByEventIds(events.map((e) => e.eventId))).map(
      (entry) => entry.eventId,
    ),
  );

  for (const event of events) {
    if (projected.has(event.eventId)) continue;
    try {
      await projectToTimeline(event);
      report.eventsReplayed += 1;
    } catch (error) {
      report.failed += 1;
      logger.error(
        { err: error, eventId: event.eventId, name: event.name },
        'recruitment timeline reconciliation could not replay an event',
      );
    }
  }
};

/**
 * ② Rebuild the two entries that have no event behind them.
 *
 * Scoped to candidates the timeline has never heard of OR is missing one of these two entries for,
 * which is why it reads the source keys per applicant rather than loading the collection: the
 * question is per-candidate and the answer is a set membership.
 */
const rebuildApplicantFacts = async (
  report: TimelineReconcileReport,
  batchSize: number,
): Promise<void> => {
  const applicants = await ApplicantModel.find({ isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(batchSize)
    .lean<ApplicantDoc[]>()
    .exec();
  if (applicants.length === 0) return;

  const sourceIds = [...new Set(applicants.map((a) => String(a.sourceId)))];
  const sources = await ApplicantSourceModel.find({ _id: { $in: sourceIds } })
    .select('key')
    .lean<{ _id: unknown; key: string }[]>()
    .exec();
  const sourceKeyById = new Map(sources.map((s) => [String(s._id), s.key]));

  for (const applicant of applicants) {
    const applicantId = String(applicant._id);
    const present = await recruitmentTimelineService.existingSourceKeys(applicantId);

    const appliedKey = timelineSourceKey({
      applicantId,
      type: 'applied',
      entityType: 'applicant',
      entityId: applicantId,
    });
    if (!present.has(appliedKey)) {
      try {
        await recruitmentTimelineService.record({
          applicantId,
          applicantCode: applicant.code,
          type: 'applied',
          correlation: { type: 'applicant', id: applicantId },
          // The ACTOR is not recoverable — it was the request's user, and the applicant document
          // does not keep it. `null` reads as "the system", which is honest for a repaired row;
          // inventing a plausible actor would be worse than admitting the gap.
          actorUserId: null,
          at: applicant.createdAt,
          entity: { type: 'applicant', id: applicantId },
          placement: applicant.placement,
          placementLabel: applicant.placementLabel,
          branchId: applicant.branchId,
          metadata: {
            source: sourceKeyById.get(String(applicant.sourceId)) ?? 'unknown',
            intakeChannel: applicant.intakeChannel,
            reconciled: true,
          },
        });
        report.appliedRebuilt += 1;
      } catch (error) {
        report.failed += 1;
        logger.error(
          { err: error, applicantId },
          'recruitment timeline reconciliation could not rebuild the `applied` entry',
        );
      }
    }

    if (applicant.identityVerification !== 'verified' || applicant.identityVerifiedAt === null) {
      continue;
    }
    // The verification instant discriminates the entry, exactly as the original write does, so a
    // corrected-and-re-verified candidate keeps both entries and neither collides.
    const identityKey = timelineSourceKey({
      applicantId,
      type: 'identityVerified',
      entityType: 'applicant',
      entityId: applicantId,
      discriminator: applicant.identityVerifiedAt.toISOString(),
    });
    if (present.has(identityKey)) continue;
    try {
      await recruitmentTimelineService.record({
        applicantId,
        applicantCode: applicant.code,
        type: 'identityVerified',
        correlation: { type: 'applicant', id: applicantId },
        actorUserId:
          applicant.identityVerifiedBy === null ? null : String(applicant.identityVerifiedBy),
        at: applicant.identityVerifiedAt,
        entity: { type: 'applicant', id: applicantId },
        discriminator: applicant.identityVerifiedAt.toISOString(),
        branchId: applicant.branchId,
        metadata: { reconciled: true },
      });
      report.identityRebuilt += 1;
    } catch (error) {
      report.failed += 1;
      logger.error(
        { err: error, applicantId },
        'recruitment timeline reconciliation could not rebuild the `identityVerified` entry',
      );
    }
  }
};

/**
 * Put back every timeline entry that should exist and does not. Idempotent, safe to run at any
 * time, and safe to overlap with live traffic: every write it makes is keyed, so a row that already
 * exists is left exactly as it is — including its original `eventId`, which is never regenerated.
 */
export const reconcileRecruitmentTimeline = async (
  batchSize = 500,
): Promise<TimelineReconcileReport> => {
  const report: TimelineReconcileReport = { ...EMPTY };
  await replayUnprojectedEvents(report, batchSize);
  await rebuildApplicantFacts(report, batchSize);

  const repaired = report.eventsReplayed + report.appliedRebuilt + report.identityRebuilt;
  if (repaired > 0 || report.failed > 0) {
    logger.warn({ ...report }, 'recruitment timeline reconciliation repaired missing entries');
  }
  return report;
};
