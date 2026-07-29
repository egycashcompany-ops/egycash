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
import { logger } from '../../../infrastructure/logging/logger';
import { automationService } from '../../../platform/automation';
import { automationWorkflowRepository } from '../workflows';
import { redactSnapshot } from '../credentials';
import { automationExecutionRepository } from '../executions/execution.repository';
import { type AutomationWorkflowDoc } from '../workflows/workflow.model';
import { matchesFilters } from './filter-eval';

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
    payload: envelope.payload,
    actor: {
      userId: String(workflow.ownerUserId),
      ...(workflow.branchId === null ? {} : { branchId: String(workflow.branchId) }),
    },
    depth,
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
 * automation is a plain consumer. It swallows its own errors: a failure here must degrade
 * automation, never the event's delivery to other modules.
 */
export const handleTriggerEvent = async (envelope: EventEnvelope): Promise<void> => {
  try {
    const summary = await dispatchForEvent(envelope, 0);
    if (summary.matched > 0) {
      logger.info({ event: envelope.name, eventId: envelope.id, ...summary }, 'automation: dispatched');
    }
  } catch (error) {
    logger.error(
      { err: error, event: envelope.name, eventId: envelope.id },
      'automation: trigger bridge failed; the business event is unaffected',
    );
  }
};

/** Test seam / A-7 hook: the execution id scheme, so a caller can find the row a dispatch created. */
export const executionIdFor = (eventId: string, workflowId: Types.ObjectId | string): string =>
  `ex_${eventId}_${String(workflowId)}`;
