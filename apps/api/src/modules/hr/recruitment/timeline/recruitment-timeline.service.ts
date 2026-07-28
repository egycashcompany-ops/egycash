// The recruitment timeline service — THE single writer of candidate history (I5).
//
// Every workflow transition in every stage feature calls `record()` and nothing else; no feature
// keeps a parallel history, and a transition that does not write here is an incomplete
// implementation. Reads are served from this collection alone, including the Electronic Employee
// File's recruitment milestones.
//
// Durability (I5): when the caller already runs inside a transaction it passes its session, so
// the entry commits with the state change or not at all. Outside a transaction the write happens
// immediately after the state change and a failure is LOGGED rather than failing the business
// operation — the deterministic `sourceKey` plus the reconciliation task then rebuild whatever was
// missed, so history is self-healing instead of silently lossy.
import { Types, type ClientSession } from 'mongoose';
import {
  type LocalizedString,
  type RecruitmentStageKind,
  type RecruitmentTimelineType,
  type TimelineCorrelationType,
} from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { type ScopeSelector } from '../../../../shared/types';
import {
  recruitmentTimelineRepository,
  type TimelineListFilter,
} from './recruitment-timeline.repository';
import { noteTimelineEntry } from './recruitment-timeline.capture';
import { newCorrelationId, newEventId, timelineSourceKey } from './recruitment-timeline.keys';
import {
  type RecruitmentTimelineDoc,
  type TimelinePlacement,
  type TimelinePlacementLabel,
} from './recruitment-timeline.model';

/** What a caller supplies; the ids, timestamps and defaults are the service's business. */
export interface RecordTimelineInput {
  applicantId: string;
  applicantCode: string;
  type: RecruitmentTimelineType;
  /** The episode (I9). `id` defaults to the entity id, or a generated one for standalone events. */
  correlation: { type: TimelineCorrelationType; id?: string };
  actorUserId?: string | null;
  actorName?: string;
  at?: Date;
  stage?: { kind: RecruitmentStageKind; refId?: string | null; name?: LocalizedString | null };
  fromStatus?: string | null;
  toStatus?: string | null;
  placement?: TimelinePlacement | null;
  placementLabel?: TimelinePlacementLabel | null;
  entity?: { type: string; id: string } | null;
  reason?: string | null;
  note?: string | null;
  branchId?: Types.ObjectId | string | null;
  /** Separates several entries of one type on one entity (attempt number, changed dimension…). */
  discriminator?: string | number | null;
  metadata?: Record<string, unknown>;
  /**
   * The entry's public identity, supplied ONLY by the workflow projection: an entry that projects
   * an outbox event takes that event's id, so "which entries did this action produce?" (I6) can be
   * answered from the ids the engine reported at publish time — before the entry existed.
   */
  eventId?: string;
}

const toObjectId = (value: Types.ObjectId | string | null | undefined): Types.ObjectId | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Types.ObjectId) return value;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
};

class RecruitmentTimelineService {
  /**
   * Append one entry. Idempotent on the derived `sourceKey`, so a retry or a concurrent writer
   * returns the stored entry rather than duplicating it. Returns the entry (callers echo the ones
   * they produced back in the workflow envelope, I6).
   */
  async record(input: RecordTimelineInput, session?: ClientSession): Promise<RecruitmentTimelineDoc> {
    const at = input.at ?? new Date();
    const sourceKey = timelineSourceKey({
      applicantId: input.applicantId,
      type: input.type,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      discriminator: input.discriminator ?? null,
    });
    const newEntryId = input.eventId ?? newEventId(at);
    // I6 — an entry written OUTSIDE the engine (an application, an identity check, a placement
    // change) has no outbox event to name it, so it reports itself into the capture scope. A
    // projected entry does not: the engine already reported its id at publish time, and reporting
    // it again here would let a foreign event — one this request merely happened to drain from the
    // shared outbox — into this action's envelope.
    if (input.eventId === undefined) noteTimelineEntry(newEntryId);
    return recruitmentTimelineRepository.append(
      {
        eventId: newEntryId,
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: input.applicantCode,
        at,
        actorUserId: toObjectId(input.actorUserId),
        actorName: input.actorName ?? '',
        type: input.type,
        correlationType: input.correlation.type,
        // The episode is the subject: its own id when there is one, a generated id otherwise.
        correlationId: input.correlation.id ?? input.entity?.id ?? newCorrelationId(at),
        stageKind: input.stage?.kind ?? null,
        stageRefId: toObjectId(input.stage?.refId),
        stageName: input.stage?.name ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        placement: input.placement ?? null,
        placementLabel: input.placementLabel ?? null,
        entityType: input.entity?.type ?? null,
        entityId: toObjectId(input.entity?.id),
        reason: input.reason ?? null,
        note: input.note ?? null,
        supersededAt: null,
        branchId: toObjectId(input.branchId),
        sourceKey,
        metadata: input.metadata ?? {},
      },
      session,
    );
  }

  /**
   * Record without ever disturbing the business operation. Used at call sites that are NOT inside
   * a transaction: a failure is logged and left for the reconciliation task to repair (I5).
   */
  async recordSafe(input: RecordTimelineInput): Promise<RecruitmentTimelineDoc | null> {
    try {
      return await this.record(input);
    } catch (error) {
      logger.error(
        { err: error, applicantId: input.applicantId, type: input.type },
        'recruitment timeline write failed; reconciliation will repair it',
      );
      return null;
    }
  }

  /** Record several entries for ONE happening — they share a correlation id (I9). */
  async recordGroup(
    inputs: RecordTimelineInput[],
    correlationId: string,
    session?: ClientSession,
  ): Promise<RecruitmentTimelineDoc[]> {
    const written: RecruitmentTimelineDoc[] = [];
    for (const input of inputs) {
      written.push(
        await this.record({ ...input, correlation: { ...input.correlation, id: correlationId } }, session),
      );
    }
    return written;
  }

  /** A fresh episode id for a happening that has no aggregate of its own (placement changes). */
  newCorrelationId(at?: Date): string {
    return newCorrelationId(at);
  }

  async listForApplicant(
    applicantId: string,
    filter: TimelineListFilter,
    limit: number,
    scope?: ScopeSelector,
  ): Promise<RecruitmentTimelineDoc[]> {
    return recruitmentTimelineRepository.listForApplicant(applicantId, filter, limit, scope);
  }

  /**
   * The one USER-AUTHORED entry (RW14). Everything else on the timeline is a projection of a
   * workflow event, so a note carries its own correlation id rather than joining an episode.
   */
  async addNote(input: {
    applicantId: string;
    applicantCode: string;
    branchId: Types.ObjectId | null;
    actorUserId: string;
    note: string;
  }): Promise<RecruitmentTimelineDoc> {
    const correlationId = newCorrelationId();
    return this.record({
      applicantId: input.applicantId,
      applicantCode: input.applicantCode,
      type: 'note',
      correlation: { type: 'applicant', id: correlationId },
      actorUserId: input.actorUserId,
      note: input.note,
      branchId: input.branchId,
      discriminator: correlationId,
    });
  }

  async countForApplicant(applicantId: string): Promise<number> {
    return recruitmentTimelineRepository.countForApplicant(applicantId);
  }

  async findByEventIds(eventIds: string[]): Promise<RecruitmentTimelineDoc[]> {
    return recruitmentTimelineRepository.findByEventIds(eventIds);
  }

  /**
   * The idempotency keys this candidate's history already holds (I5) — how the repair task asks
   * "is this entry missing?" without guessing from counts or timestamps.
   */
  async existingSourceKeys(applicantId: string): Promise<Set<string>> {
    return recruitmentTimelineRepository.existingSourceKeys(applicantId);
  }

  /** Mark a superseded attempt's entries (RW13/A8) — a marker, never a removal. */
  async markSuperseded(
    applicantId: string,
    correlationIds: string[],
    at: Date,
    session?: ClientSession,
  ): Promise<number> {
    return recruitmentTimelineRepository.markSuperseded(applicantId, correlationIds, at, session);
  }

  /** Keep the scope field aligned with the applicant's branch (RW2 step 3). */
  async syncBranch(
    applicantId: string,
    branchId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<void> {
    return recruitmentTimelineRepository.syncBranch(applicantId, branchId, session);
  }
}

export const recruitmentTimelineService = new RecruitmentTimelineService();
