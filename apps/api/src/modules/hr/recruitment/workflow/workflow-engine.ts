// The recruitment workflow engine (I13). The ONLY component that moves a record between states.
//
// Three responsibilities and nothing else:
//   1. validate the transition against the rulebook (workflow-transitions)
//   2. update the aggregate atomically
//   3. publish one immutable domain event
//
// Every side effect — timeline, audit, notifications, counters, badges, file generation,
// integrations, analytics — is a CONSUMER of that event (I15), subscribed through the dispatcher.
// The engine performs none of them itself, which is what keeps it deterministic.
import { Types, type ClientSession, type Model } from 'mongoose';
import { BusinessRuleError, ConflictError, NotFoundError, StaleDocumentError } from '../../../../shared/errors';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { type BaseDocFields } from '../../../../shared/base/base.model';
import { newCorrelationId, newEventId } from '../timeline/recruitment-timeline.keys';
import { noteWorkflowEvent } from './workflow-capture';
import { dispatchPendingWorkflowEvents } from './workflow-dispatcher';
import { workflowEventRepository } from './workflow-event.repository';
import { type WorkflowEventDoc } from './workflow-event.model';
import {
  eventForLifecycle,
  eventForMaterialization,
  eventForSupersede,
  eventForTransition,
  type WorkflowEventName,
} from './workflow-events';
import {
  lifecycleEffectOf,
  validateLifecycleEvent,
  type LifecycleEvent,
} from './workflow-lifecycle';
import { WORKFLOW_ENGINE_TOKEN } from './workflow-guard';
import {
  validateTransition,
  type ApplicantWorkflowStatus,
  type StageObject,
  type WorkflowObject,
  type WorkflowStatus,
} from './workflow-transitions';
import { emptyPlacement, emptyPlacementLabel, type StageDocFields } from './stage-fields';

/** The shape every stage record satisfies, as far as the engine is concerned. */
export interface StageRecord extends BaseDocFields, StageDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  branchId: Types.ObjectId | null;
  status: string;
}

/** What identifies a stage: its model, its object name, and the discriminating stage field. */
export interface StageBinding<T extends StageRecord> {
  object: StageObject;
  model: Model<T>;
  entityType: string;
  /** `stageId` for interviews, `phaseId` for evaluations; absent for the singleton stages. */
  stageField?: 'stageId' | 'phaseId';
}

/**
 * Every stage collection the engine must reach when the APPLICANT's lifecycle moves. Stage
 * features register their binding at module load (the same seam pattern as the queue
 * materializer), so the engine can propagate liveness without importing any of them.
 */
const stageBindings = new Map<StageObject, StageBinding<StageRecord>>();

export const registerStageBinding = <T extends StageRecord>(binding: StageBinding<T>): void => {
  stageBindings.set(binding.object, binding as unknown as StageBinding<StageRecord>);
};

/** Test seam. */
export const resetStageBindings = (): void => stageBindings.clear();

/**
 * The registered stage bindings in PIPELINE order, so a reader scanning for "where does this
 * candidate stand" walks the stages the way the business does rather than in registration order.
 */
const PIPELINE_ORDER: StageObject[] = ['screening', 'interview', 'evaluation', 'offer'];

export const stageBindingsInOrder = (): StageBinding<StageRecord>[] =>
  PIPELINE_ORDER.map((object) => stageBindings.get(object)).filter(
    (b): b is StageBinding<StageRecord> => b !== undefined,
  );

export interface EnsureStageInput<T extends StageRecord> {
  binding: StageBinding<T>;
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  branchId: Types.ObjectId | null;
  /** The interview stage / evaluation phase this record belongs to. */
  stageRefId?: Types.ObjectId | null;
  attempt?: number;
  /** Extra fields set only when the record is CREATED (never on a re-ensure). */
  defaults?: Partial<T>;
  actorUserId?: string | null;
  placement?: StageDocFields['placementSnapshot'];
  placementLabel?: StageDocFields['placementSnapshotLabel'];
}

export interface TransitionInput<T extends StageRecord> {
  binding: StageBinding<T>;
  id: string;
  to: WorkflowStatus;
  actorUserId: string | null;
  reason?: string | null;
  /** Interview outcome, needed to decide whether a completion is a rejection (I14). */
  outcome?: string | null;
  /** Optimistic-concurrency token; omitted for engine-internal moves (sweeps, returns). */
  version?: number;
  /** Domain fields written together with the status, in the same atomic update. */
  set?: Partial<T>;
  payload?: Record<string, unknown>;
  correlationId?: string;
}

export interface TransitionResult<T extends StageRecord> {
  record: T;
  event: WorkflowEventDoc;
  /** The lifecycle event this transition raised, if any (I14). */
  lifecycle: LifecycleEvent | null;
}

/**
 * States from which a stage record can no longer move forward. A candidate returning to this
 * stage gets a NEW attempt rather than reviving a terminal row (I11/I12) — e.g. re-scheduling
 * after a cancelled round, or drafting a fresh offer after one was withdrawn.
 */
const TERMINAL_STATUSES: Record<StageObject, readonly string[]> = {
  screening: ['cancelled'],
  interview: ['completed', 'cancelled'],
  evaluation: ['cancelled'],
  offer: ['accepted', 'rejected', 'expired', 'withdrawn', 'superseded'],
};

/**
 * What an OPEN stage record becomes when the candidate leaves the pipeline, and which statuses
 * count as open (I14). The lifecycle never edits a decided record — an accepted screening or a
 * completed round is history and stays exactly as it was; only the unfinished work closes.
 *
 * This is the whole mechanism by which a withdrawn or rejected candidate leaves every queue and
 * every counter: their rows carry a terminal STATUS. No mirrored lifecycle field exists anywhere
 * on a stage record (I1/I10), and because each closure status is terminal above, reactivating the
 * candidate re-opens the stage on a fresh attempt rather than reviving a closed row (I11/I12).
 */
const LIFECYCLE_CLOSE: Record<StageObject, { open: readonly string[]; to: WorkflowStatus }> = {
  screening: { open: ['waiting'], to: 'cancelled' },
  interview: { open: ['waiting', 'scheduled', 'inProgress'], to: 'cancelled' },
  evaluation: { open: ['waiting'], to: 'cancelled' },
  // The offer has always had a word for this; it needs no new one.
  offer: { open: ['waiting', 'draft', 'sent'], to: 'withdrawn' },
};

interface ApplicantLike extends BaseDocFields {
  code: string;
  status: ApplicantWorkflowStatus;
  branchId: Types.ObjectId | null;
}

class RecruitmentWorkflowEngine {
  /**
   * Materialize a stage record in `waiting` (I11), idempotently (I12). A single atomic upsert
   * keyed on (applicant, stage, attempt) — not a read-then-write — so retries, concurrent
   * transitions and the boot migration all converge on the same row.
   */
  async ensureStageRecord<T extends StageRecord>(
    input: EnsureStageInput<T>,
    session?: ClientSession,
  ): Promise<{ record: T; created: boolean }> {
    const stageFilter: Record<string, unknown> = {
      applicantId: new Types.ObjectId(input.applicantId),
      supersededAt: null,
      isDeleted: false,
    };
    if (input.binding.stageField !== undefined) {
      stageFilter[input.binding.stageField] = input.stageRefId;
    }

    // The live record is the highest attempt that has not been superseded. When it is terminal
    // (a cancelled round, a withdrawn offer) the stage re-opens on the NEXT attempt.
    const latest = await input.binding.model
      .findOne(stageFilter)
      .sort({ attempt: -1 })
      .lean<T>()
      .exec();
    const terminal = TERMINAL_STATUSES[input.binding.object];
    if (latest !== null && !terminal.includes(latest.status)) {
      return { record: latest, created: false };
    }
    const attempt = input.attempt ?? (latest === null ? 1 : latest.attempt + 1);
    const filter = { ...stageFilter, attempt };

    const setOnInsert = {
      ...filter,
      applicantCode: input.applicantCode,
      applicantName: input.applicantName,
      branchId: input.branchId,
      status: 'waiting',
      placementSnapshot: input.placement ?? emptyPlacement(),
      placementSnapshotLabel: input.placementLabel ?? emptyPlacementLabel(),
      supersededBy: null,
      supersededByReturnId: null,
      createdBy: input.actorUserId === undefined || input.actorUserId === null
        ? null
        : new Types.ObjectId(input.actorUserId),
      ...(input.defaults ?? {}),
    };

    try {
      const record = await input.binding.model
        .findOneAndUpdate(filter, { $setOnInsert: setOnInsert }, { new: true, upsert: true, session: session ?? null })
        .lean<T>()
        .exec();
      // The upsert either inserted or matched a row created by a racing request.
      const created = record !== null && record.status === 'waiting' && record.__v === 0;
      await this.publish(
        {
          name: eventForMaterialization(),
          applicantId: input.applicantId,
          applicantCode: input.applicantCode,
          object: input.binding.object,
          entityType: input.binding.entityType,
          entityId: record._id,
          attempt,
          from: null,
          to: 'waiting',
          reason: null,
          actorUserId: input.actorUserId ?? null,
          branchId: input.branchId,
          correlationId: String(record._id),
          payload: { stageRefId: input.stageRefId === null || input.stageRefId === undefined ? null : String(input.stageRefId) },
        },
        session,
      );
      if (session === undefined) await this.flush();
      return { record, created };
    } catch (error) {
      // The unique index is the race backstop: re-read and return the winner (I12).
      if (error instanceof Error && error.message.includes('E11000')) {
        const existing = await input.binding.model.findOne(filter).lean<T>().exec();
        if (existing !== null) return { record: existing, created: false };
      }
      throw error;
    }
  }

  /**
   * Move a stage record between states. Validates against the rulebook, applies the change and the
   * caller's domain fields in ONE atomic update, raises the lifecycle event when the transition
   * constitutes one (I14), and publishes exactly one domain event (I15).
   */
  async transition<T extends StageRecord>(input: TransitionInput<T>): Promise<TransitionResult<T>> {
    const result = await unitOfWork(async (session) => this.transitionIn(input, session));
    // The outbox is published only AFTER the producing transaction commits (I15) — consumers must
    // never observe a state change that could still roll back.
    await this.flush();
    return result;
  }

  /**
   * Publish everything the outbox is holding. Safe to call at any time: delivery is per-event and
   * marked, so a second call publishes nothing twice. The scheduled sweep is the crash-recovery
   * net for events whose dispatch never ran.
   */
  async flush(): Promise<void> {
    await dispatchPendingWorkflowEvents();
  }

  /** The transactional body — reused by bulk operations that already hold a session (I4). */
  async transitionIn<T extends StageRecord>(
    input: TransitionInput<T>,
    session: ClientSession,
  ): Promise<TransitionResult<T>> {
    const before = await input.binding.model
      .findOne({ _id: new Types.ObjectId(input.id), isDeleted: false })
      .session(session)
      .lean<T>()
      .exec();
    if (before === null) throw new NotFoundError();
    if (before.supersededAt !== null) {
      throw new BusinessRuleError('this attempt was superseded by a return to an earlier stage');
    }

    const check = validateTransition(
      input.binding.object,
      before.status as WorkflowStatus,
      input.to,
      input.reason,
    );
    if (!check.ok) throw new BusinessRuleError(check.message);

    const filter: Record<string, unknown> = { _id: new Types.ObjectId(input.id), isDeleted: false };
    if (input.version !== undefined) filter.__v = input.version;

    const updated = await input.binding.model
      .findOneAndUpdate(
        filter,
        {
          $set: {
            ...(input.set ?? {}),
            status: input.to,
            updatedBy: input.actorUserId === null ? null : new Types.ObjectId(input.actorUserId),
          },
          $inc: { __v: 1 },
        },
        { new: true, session },
      )
      .lean<T>()
      .exec();
    if (updated === null) throw new ConflictError('the record changed since it was read');

    const lifecycle = lifecycleEffectOf(
      input.binding.object,
      input.to,
      (input.outcome ?? null) as never,
    );

    const name = eventForTransition(input.binding.object, before.status as WorkflowStatus, input.to);
    const event = await this.publish(
      {
        name: name ?? eventForMaterialization(),
        applicantId: String(before.applicantId),
        applicantCode: before.applicantCode,
        object: input.binding.object,
        entityType: input.binding.entityType,
        entityId: updated._id,
        attempt: updated.attempt,
        from: before.status,
        to: input.to,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId,
        branchId: updated.branchId,
        correlationId: input.correlationId ?? String(updated._id),
        payload: { action: check.transition.action, ...(input.payload ?? {}) },
      },
      session,
    );

    return { record: updated, event, lifecycle };
  }

  /**
   * Move the APPLICANT lifecycle (I14). Called by the engine itself when a stage transition
   * constitutes a lifecycle event, and by the explicit lifecycle actions (hire, withdraw,
   * reactivate). Never invoked as a hidden side effect of a stage move.
   */
  async applyLifecycleEvent(
    model: Model<ApplicantLike>,
    applicantId: string,
    event: LifecycleEvent,
    actorUserId: string | null,
    reason: string | null,
    session: ClientSession,
    correlationId?: string,
    /**
     * `set` carries the non-managed fields that belong to the SAME act (a withdrawal's reason and
     * timestamp), so the status and its detail commit together. `expectedVersion` preserves the
     * optimistic-concurrency guarantee a caller coming from an HTTP PATCH already had.
     */
    options?: { set?: Record<string, unknown>; expectedVersion?: number },
  ): Promise<{ applicant: ApplicantLike; event: WorkflowEventDoc } | null> {
    const before = await model
      .findOne({ _id: new Types.ObjectId(applicantId), isDeleted: false })
      .session(session)
      .lean<ApplicantLike>()
      .exec();
    if (before === null) throw new NotFoundError();

    const check = validateLifecycleEvent(event, before.status, reason);
    // A lifecycle event that does not apply (already rejected, already hired) is a no-op rather
    // than a failure: the stage transition that raised it is still valid.
    if (!check.ok) return null;

    const updated = await model
      .findOneAndUpdate(
        {
          _id: before._id,
          isDeleted: false,
          ...(options?.expectedVersion === undefined ? {} : { __v: options.expectedVersion }),
        },
        {
          $set: {
            status: check.rule.to,
            updatedBy: actorUserId === null ? null : new Types.ObjectId(actorUserId),
            ...(options?.set ?? {}),
          },
          $inc: { __v: 1 },
        },
        { new: true, session },
      )
      .lean<ApplicantLike>()
      .exec();
    if (updated === null) {
      // With a version supplied, matching nothing means the caller read a stale copy — the same
      // answer the repository gives, so the HTTP status does not change with the code path.
      if (options?.expectedVersion !== undefined) throw new StaleDocumentError();
      throw new ConflictError('the applicant changed since it was read');
    }

    // I14 — the candidate left the pipeline, so the work that was still open closes. Each closure
    // is a REAL transition through this same engine: validated against the rulebook, publishing
    // its own event, and therefore audited and on the timeline like any other. Nothing derived,
    // nothing mirrored — a departed candidate leaves the queues because their rows now carry a
    // terminal status (I1/I10).
    if (check.rule.to !== 'new') {
      await this.closeOpenStages(applicantId, reason, actorUserId, session);
    }

    const published = await this.publish(
      {
        name: eventForLifecycle(event),
        applicantId,
        applicantCode: before.code,
        object: 'applicant' as WorkflowObject,
        entityType: 'applicant',
        entityId: before._id,
        attempt: null,
        from: before.status,
        to: check.rule.to,
        reason,
        actorUserId,
        branchId: updated.branchId,
        correlationId: correlationId ?? newCorrelationId(),
        payload: { lifecycleEvent: event },
      },
      session,
    );
    return { applicant: updated, event: published };
  }

  /**
   * Close every still-open stage record for a candidate who has left the pipeline. Runs inside the
   * lifecycle transaction, so the applicant's status and the closures commit together or not at
   * all: there is no window in which a withdrawn candidate still holds an open queue row.
   *
   * A decided record is never touched — only the statuses `LIFECYCLE_CLOSE` calls open.
   */
  private async closeOpenStages(
    applicantId: string,
    reason: string | null,
    actorUserId: string | null,
    session: ClientSession,
  ): Promise<void> {
    for (const binding of stageBindings.values()) {
      const rule = LIFECYCLE_CLOSE[binding.object];
      const open = await binding.model
        .find({
          applicantId: new Types.ObjectId(applicantId),
          supersededAt: null,
          isDeleted: false,
          status: { $in: rule.open },
        })
        .session(session)
        .lean<StageRecord[]>()
        .exec();
      for (const record of open) {
        await this.transitionIn(
          {
            binding,
            id: String(record._id),
            to: rule.to,
            actorUserId,
            reason: reason ?? 'the candidate left the pipeline',
          },
          session,
        );
      }
    }
  }

  /** Retire an attempt when a return to an earlier stage supersedes it (RW13). */
  async supersede<T extends StageRecord>(
    binding: StageBinding<T>,
    id: string,
    returnEventId: string,
    actorUserId: string | null,
    session: ClientSession,
  ): Promise<T | null> {
    const at = new Date();
    const updated = await binding.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), supersededAt: null, isDeleted: false },
        {
          $set: {
            supersededAt: at,
            supersededBy: actorUserId === null ? null : new Types.ObjectId(actorUserId),
            supersededByReturnId: returnEventId,
          },
          $inc: { __v: 1 },
        },
        { new: true, session },
      )
      .lean<T>()
      .exec();
    if (updated === null) return null;

    await this.publish(
      {
        name: eventForSupersede(),
        applicantId: String(updated.applicantId),
        applicantCode: updated.applicantCode,
        object: binding.object,
        entityType: binding.entityType,
        entityId: updated._id,
        attempt: updated.attempt,
        from: updated.status,
        to: updated.status,
        reason: null,
        actorUserId,
        branchId: updated.branchId,
        correlationId: String(updated._id),
        payload: { returnEventId },
      },
      session,
    );
    return updated;
  }

  /** Write one event to the outbox, in the caller's transaction (I15). */
  private async publish(
    input: {
      name: WorkflowEventName;
      applicantId: string;
      applicantCode: string;
      object: WorkflowObject;
      entityType: string | null;
      entityId: Types.ObjectId | null;
      attempt: number | null;
      from: string | null;
      to: string;
      reason: string | null;
      actorUserId: string | null | undefined;
      branchId: Types.ObjectId | null;
      correlationId: string;
      payload: Record<string, unknown>;
    },
    session?: ClientSession,
  ): Promise<WorkflowEventDoc> {
    const occurredAt = new Date();
    const eventId = newEventId(occurredAt);
    // I6 — tell the open capture scope, if any, that this action produced this event. The
    // envelope echoes exactly these entries back rather than guessing from a timestamp.
    noteWorkflowEvent(eventId);
    return workflowEventRepository.append(
      {
        eventId,
        name: input.name,
        occurredAt,
        actorUserId:
          input.actorUserId === null || input.actorUserId === undefined
            ? null
            : new Types.ObjectId(input.actorUserId),
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: input.applicantCode,
        object: input.object,
        entityType: input.entityType,
        entityId: input.entityId,
        attempt: input.attempt,
        from: input.from,
        to: input.to,
        reason: input.reason,
        correlationId: input.correlationId,
        branchId: input.branchId,
        payload: input.payload,
      },
      session,
    );
  }

  /** The capability token stage repositories demand for `applyTransition()` (I13). */
  get token(): typeof WORKFLOW_ENGINE_TOKEN {
    return WORKFLOW_ENGINE_TOKEN;
  }
}

export const recruitmentWorkflowEngine = new RecruitmentWorkflowEngine();
