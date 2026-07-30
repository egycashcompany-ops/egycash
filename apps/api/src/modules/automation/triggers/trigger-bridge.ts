// The trigger bridge (A-5) — the seam that turns a published platform event into automation runs.
//
// This is the single most important reuse decision in the design made concrete: automation
// subscribes as an ORDINARY event consumer (design §3.1). No new bus, no new delivery guarantee.
// A business module emits `hr.employee.created` inside its transaction exactly as before; this
// bridge, downstream of that commit, decides which workflows the event fires and starts them.
//
// It never throws into the event bus. A provider outage, a bad filter, a full disk — none of it
// may fail the delivery of a business event to its other consumers (ADR-018 decision 4: automation
// is strictly downstream and degrades alone).
import { type AutomationFilter, type EventEnvelope } from '@ecms/contracts';
import { type Types } from 'mongoose';
import { z } from 'zod';
import { logger } from '../../../infrastructure/logging/logger';
import { enqueue } from '../../../infrastructure/queue/jobs';
import { automationService } from '../../../platform/automation';
import { automationWorkflowRepository } from '../workflows';
import { redactSnapshot } from '../credentials';
import { automationExecutionRepository } from '../executions/execution.repository';
import { type AutomationWorkflowDoc } from '../workflows/workflow.model';
import { matchesFilters } from './filter-eval';

/** The `automation`-queue job the bridge enqueues (A-1 added the queue for exactly this). */
export const AUTOMATION_TRIGGER_JOB = 'automation.trigger';

/**
 * What the enqueued job carries — the envelope fields the dispatch reproduces downstream. The full
 * identity travels (id/name/occurredAt/schemaVersion/requestId) so the worker rebuilds a faithful
 * envelope for the provider rather than a bare payload. Parsed on the way back in because Redis
 * holds JSON and a malformed job must fail cleanly.
 */
const TriggerJobSchema = z.object({
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  schemaVersion: z.number().int().min(1).default(1),
  occurredAt: z.coerce.date().default(() => new Date()),
  requestId: z.string().optional(),
  payload: z.unknown(),
  depth: z.number().int().min(0).default(0),
});
export type TriggerJob = z.infer<typeof TriggerJobSchema>;

/**
 * Re-entrancy ceiling (§7.4). An automation action may emit an event that re-triggers the same
 * workflow; without a bound, `entity.updated → update entity` is an infinite loop writing to
 * production. A business event is depth 0; an event emitted BY an automation action carries its
 * originating execution's depth + 1 — that propagation lands with the action surface (A-6). The
 * guard is enforced now so A-6 does not have to retrofit it into the dispatch path.
 */
export const MAX_TRIGGER_DEPTH = 3;

export interface DispatchSummary {
  matched: number;
  dispatched: number;
  skipped: number;
  filteredOut: number;
}

/**
 * One workflow's run for one event. Idempotent on `(eventId, workflowId)` via the execution
 * collection's unique index, so a redelivered event — the bus retrying, two workers draining the
 * same message — cannot start a second run.
 */
const dispatchOne = async (
  workflow: AutomationWorkflowDoc,
  envelope: EventEnvelope,
  depth: number,
): Promise<'dispatched' | 'skipped' | 'duplicate'> => {
  const executionId = `ex_${envelope.id}_${String(workflow._id)}`;

  const { created, doc } = await automationExecutionRepository.createIfNew({
    workflowId: workflow._id,
    workflowKey: workflow.key,
    executionId,
    trigger: { kind: 'event', eventName: envelope.name, eventId: envelope.id },
    status: 'pending',
    providerRef: null,
    actorUserId: workflow.ownerUserId,
    branchId: workflow.branchId,
    depth,
    // Redacted BEFORE it touches the collection (A-4). The snapshot is retained business data, and
    // a workflow that authenticates would otherwise leave its credential in this row.
    inputSnapshot: redactSnapshot(envelope.payload),
    error: null,
    startedAt: new Date(),
    finishedAt: null,
  });

  // The index already rejected the duplicate; this is not an error, it is idempotency working.
  if (!created || doc === null) return 'duplicate';

  // A workflow that has never been pushed to a provider (draft that got enabled before A-6 exists)
  // has no ref to run. Record the execution as skipped rather than inventing a target.
  if (workflow.providerRef === null) {
    await automationExecutionRepository.setOutcome(doc._id, {
      status: 'skipped',
      error: 'workflow has no provider workflow yet',
      finishedAt: new Date(),
    });
    return 'skipped';
  }

  const outcome = await automationService.trigger({
    workflow: workflow.providerRef,
    executionId,
    // The stable envelope identity the provider wraps the payload in (ADR-008).
    event: {
      id: envelope.id,
      type: envelope.name,
      occurredAt: envelope.occurredAt,
      version: envelope.schemaVersion,
    },
    payload: envelope.payload,
    actor: {
      userId: String(workflow.ownerUserId),
      ...(workflow.branchId === null ? {} : { branchId: String(workflow.branchId) }),
    },
    depth,
    ...(envelope.requestId === undefined ? {} : { requestId: envelope.requestId }),
  });

  await automationExecutionRepository.setOutcome(doc._id, {
    status: outcome.dispatched ? 'running' : 'skipped',
    providerRef: outcome.execution ?? null,
    error: outcome.reason ?? null,
    ...(outcome.dispatched ? {} : { finishedAt: new Date() }),
  });
  return outcome.dispatched ? 'dispatched' : 'skipped';
};

/**
 * Fire every active workflow subscribed to this event whose filters pass. Depth defaults to 0 —
 * the event is the root cause — and A-6 threads a non-zero depth for automation-emitted events.
 */
export const dispatchForEvent = async (
  envelope: EventEnvelope,
  depth = 0,
): Promise<DispatchSummary> => {
  const summary: DispatchSummary = { matched: 0, dispatched: 0, skipped: 0, filteredOut: 0 };

  // The re-entrancy stop. A run past the ceiling is refused and recorded nowhere new — the loop
  // ends here rather than adding another generation of executions.
  if (depth > MAX_TRIGGER_DEPTH) {
    logger.warn(
      { event: envelope.name, eventId: envelope.id, depth },
      'automation: trigger depth exceeded; refusing to dispatch',
    );
    return summary;
  }

  const workflows = await automationWorkflowRepository.listActiveByEvent(envelope.name);
  summary.matched = workflows.length;

  for (const workflow of workflows) {
    // `op` is stored as a plain string but was validated to the enum at save time (A-3); the
    // evaluator treats an unrecognised op as no-match, so the cast cannot widen behaviour.
    if (!matchesFilters(workflow.trigger.filters as AutomationFilter[], envelope.payload)) {
      summary.filteredOut += 1;
      continue;
    }
    const result = await dispatchOne(workflow, envelope, depth);
    if (result === 'dispatched') summary.dispatched += 1;
    else if (result === 'skipped') summary.skipped += 1;
  }
  return summary;
};

/**
 * The event-bus handler. ONE handler, subscribed to every cataloged event name (design §3.1), so
 * automation is a plain consumer. It does the MINIMUM synchronously — enqueue one job — and hands
 * the real work to the worker, for two reasons:
 *
 *   1. **Asynchrony.** Resolving workflows, evaluating filters and dispatching to a provider must
 *      not run on the thread that delivered a business event to its other consumers.
 *   2. **Retry.** The event bus marks a reliable event processed BEFORE calling this handler, so a
 *      failure here would never be retried by the bus. On the `automation` queue (A-1) the job
 *      retries with backoff, and the execution collection's unique index makes those retries
 *      idempotent.
 *
 * It swallows its own errors: a failure to even enqueue must degrade automation, never the event's
 * delivery to other modules (ADR-018 decision 4).
 */
export const handleTriggerEvent = async (envelope: EventEnvelope): Promise<void> => {
  try {
    const job: TriggerJob = {
      eventId: envelope.id,
      eventName: envelope.name,
      schemaVersion: envelope.schemaVersion,
      occurredAt: envelope.occurredAt,
      ...(envelope.requestId === undefined ? {} : { requestId: envelope.requestId }),
      payload: envelope.payload,
      depth: 0,
    };
    await enqueue(
      'automation',
      AUTOMATION_TRIGGER_JOB,
      job,
      // The event id is the idempotency anchor; BullMQ dedups a job id it has already seen, a
      // second layer of protection beneath the execution index.
      { jobId: `trigger_${envelope.id}` },
      { eventId: envelope.id, ...(envelope.actorId === undefined ? {} : { principal: { userId: envelope.actorId, kind: 'system' } }) },
    );
  } catch (error) {
    logger.error(
      { err: error, event: envelope.name, eventId: envelope.id },
      'automation: failed to enqueue a trigger; the business event is unaffected',
    );
  }
};

/**
 * The worker-side job handler (registered on the `automation` queue via the manifest). This is
 * where the dispatch actually happens, under BullMQ's retry policy. A throw here re-runs the job;
 * idempotency keeps that safe.
 */
export const runAutomationTrigger = async (data: unknown): Promise<void> => {
  const job = TriggerJobSchema.parse(data);
  const envelope: EventEnvelope = {
    id: job.eventId,
    name: job.eventName,
    schemaVersion: job.schemaVersion,
    occurredAt: job.occurredAt,
    ...(job.requestId === undefined ? {} : { requestId: job.requestId }),
    payload: job.payload,
  };
  const summary = await dispatchForEvent(envelope, job.depth);
  if (summary.matched > 0) {
    logger.info(
      { event: job.eventName, eventId: job.eventId, ...summary },
      'automation: trigger dispatched',
    );
  }
};

/** Test seam / A-7 hook: the execution id scheme, so a caller can find the row a dispatch created. */
export const executionIdFor = (eventId: string, workflowId: Types.ObjectId | string): string =>
  `ex_${eventId}_${String(workflowId)}`;
