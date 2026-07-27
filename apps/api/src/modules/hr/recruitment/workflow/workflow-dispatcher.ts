// The outbox dispatcher (I15). Publishes committed workflow events to their consumers, after the
// transaction that produced them has committed.
//
// Consumers register here; none of them may write workflow state back — events are facts, not
// commands. A consumer that throws does not block the others and does not affect the workflow:
// the event stays undispatched and is retried on the next sweep, which is what makes side effects
// replayable rather than lost.
import { logger } from '../../../../infrastructure/logging/logger';
import { emit } from '../../../../platform/kernel/event-bus';
import { workflowEventRepository } from './workflow-event.repository';
import { type WorkflowEventDoc } from './workflow-event.model';

export type WorkflowEventConsumer = (event: WorkflowEventDoc) => Promise<void>;

interface Registration {
  id: string;
  /** Event names this consumer wants, or a prefix ending in `*`. */
  pattern: string;
  handler: WorkflowEventConsumer;
}

const registrations: Registration[] = [];

const matches = (pattern: string, name: string): boolean =>
  pattern === '*' || (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name);

/** Register a consumer (timeline, audit, notifications, counters, analytics, …). */
export const onWorkflowEvent = (id: string, pattern: string, handler: WorkflowEventConsumer): void => {
  if (registrations.some((r) => r.id === id && r.pattern === pattern)) return;
  registrations.push({ id, pattern, handler });
};

/** Test seam — drops every registration. */
export const resetWorkflowConsumers = (): void => {
  registrations.length = 0;
};

export const workflowConsumerIds = (): string[] => registrations.map((r) => r.id);

/**
 * Deliver one event to its consumers. Every consumer runs; a failure is logged and reported so the
 * caller can leave the event undispatched for the next sweep.
 */
export const deliver = async (event: WorkflowEventDoc): Promise<{ failures: number }> => {
  let failures = 0;
  for (const registration of registrations) {
    if (!matches(registration.pattern, event.name)) continue;
    try {
      await registration.handler(event);
    } catch (error) {
      failures += 1;
      logger.error(
        { err: error, consumer: registration.id, eventId: event.eventId, name: event.name },
        'recruitment workflow consumer failed; the event stays queued for retry',
      );
    }
  }
  // Also surface on the platform bus so existing module subscriptions keep working (ADR-008).
  await emit(event.name, {
    applicantId: String(event.applicantId),
    applicantCode: event.applicantCode,
    entityId: event.entityId === null ? undefined : String(event.entityId),
    from: event.from,
    to: event.to,
    ...event.payload,
  }).catch(() => undefined);
  return { failures };
};

/** Drain the outbox: publish everything committed but not yet delivered. */
export const dispatchPendingWorkflowEvents = async (batchSize = 200): Promise<number> => {
  const pending = await workflowEventRepository.listUndispatched(batchSize);
  let dispatched = 0;
  for (const event of pending) {
    const { failures } = await deliver(event);
    if (failures === 0) {
      await workflowEventRepository.markDispatched(event.eventId);
      dispatched += 1;
    } else {
      await workflowEventRepository.markDispatchFailed(event.eventId, `${failures} consumer(s) failed`);
    }
  }
  return dispatched;
};
