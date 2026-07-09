// Typed event bus (ADR-008) with two delivery tiers behind one publishing API:
//   in-process — best-effort synchronous fan-out (cache invalidation, live pushes)
//   reliable   — outbox inside the emitter's transaction → BullMQ → idempotent consumers
// Envelopes are versioned (Review R22); consumers parse payloads NON-strict.
import { randomUUID } from 'node:crypto';
import { type ClientSession } from 'mongoose';
import { EVENT_SCHEMA_VERSIONS, type EventEnvelope, type PlatformEventName } from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { enqueue, registerJobHandler } from '../../infrastructure/queue/jobs';
import { getContext, getRequestId } from '../../infrastructure/http/request-context';
import { OutboxModel, ProcessedEventModel } from './outbox.model';

export type EventHandler = (envelope: EventEnvelope) => Promise<void> | void;

interface Subscription {
  handlerId: string;
  handler: EventHandler;
}

const subscriptions = new Map<string, Subscription[]>();

export const subscribe = (eventName: string, handlerId: string, handler: EventHandler): void => {
  const list = subscriptions.get(eventName) ?? [];
  if (list.some((s) => s.handlerId === handlerId)) {
    throw new Error(`duplicate event subscription: ${eventName} → ${handlerId}`);
  }
  list.push({ handlerId, handler });
  subscriptions.set(eventName, list);
};

const buildEnvelope = (
  name: string,
  payload: unknown,
  actorId: string | undefined,
): EventEnvelope => {
  const schemaVersion = EVENT_SCHEMA_VERSIONS[name as PlatformEventName] ?? 1;
  const requestId = getRequestId();
  const contextActor = getContext()?.actor?.userId ?? undefined;
  const actor = actorId ?? contextActor ?? undefined;
  return {
    id: randomUUID(),
    name,
    schemaVersion,
    occurredAt: new Date(),
    ...(requestId === undefined ? {} : { requestId }),
    ...(actor === undefined ? {} : { actorId: actor }),
    payload,
  };
};

const dispatchInProcess = (envelope: EventEnvelope): void => {
  for (const { handlerId, handler } of subscriptions.get(envelope.name) ?? []) {
    Promise.resolve()
      .then(() => handler(envelope))
      .catch((error: unknown) => {
        logger.error({ err: error, event: envelope.name, handlerId }, 'event handler failed');
      });
  }
};

export interface EmitOptions {
  /** Business-consequence events survive crashes via the outbox (ADR-008 tier 2). */
  reliable?: boolean;
  /** Required for reliable emission inside a transaction. */
  session?: ClientSession;
  actorId?: string;
}

export const emit = async (
  name: string,
  payload: unknown,
  options: EmitOptions = {},
): Promise<void> => {
  const envelope = buildEnvelope(name, payload, options.actorId);

  if (options.reliable === true) {
    await OutboxModel.create(
      [
        {
          eventId: envelope.id,
          eventName: envelope.name,
          schemaVersion: envelope.schemaVersion,
          payload: envelope.payload,
          actorId: envelope.actorId ?? null,
          requestId: envelope.requestId ?? null,
          occurredAt: envelope.occurredAt,
          status: 'pending',
        },
      ],
      { session: options.session ?? null },
    );
    // The relay is nudged after commit; the scheduled sweep is the crash-recovery net.
    return;
  }

  dispatchInProcess(envelope);
};

/** Reliable-tier consumer dispatch with event-ID dedup (idempotency, ADR-008). */
const dispatchReliable = async (envelope: EventEnvelope): Promise<void> => {
  for (const { handlerId, handler } of subscriptions.get(envelope.name) ?? []) {
    try {
      await ProcessedEventModel.create([{ _id: `${envelope.id}:${handlerId}`, at: new Date() }]);
    } catch {
      continue; // duplicate delivery — already handled
    }
    await handler(envelope);
  }
};

export const OUTBOX_RELAY_JOB = 'outbox.relay';
export const OUTBOX_DISPATCH_JOB = 'outbox.dispatch';

/** Move pending outbox rows to the dispatch job. Runs after commits and on a schedule. */
export const relayOutbox = async (): Promise<void> => {
  const pending = await OutboxModel.find({ status: 'pending' })
    .sort({ occurredAt: 1 })
    .limit(100)
    .lean()
    .exec();
  for (const row of pending) {
    const envelope: EventEnvelope = {
      id: row.eventId,
      name: row.eventName,
      schemaVersion: row.schemaVersion,
      occurredAt: row.occurredAt,
      ...(row.requestId === null ? {} : { requestId: row.requestId }),
      ...(row.actorId === null ? {} : { actorId: row.actorId }),
      payload: row.payload,
    };
    await enqueue('outbox', OUTBOX_DISPATCH_JOB, envelope);
    await OutboxModel.updateOne(
      { _id: row._id },
      { $set: { status: 'dispatched' }, $inc: { attempts: 1 } },
    ).exec();
  }
};

/** Fire-and-forget nudge used by services right after a reliable emit commits. */
export const nudgeOutboxRelay = (): void => {
  enqueue('outbox', OUTBOX_RELAY_JOB, {}).catch((error: unknown) => {
    logger.warn({ err: error }, 'outbox relay nudge failed — sweep will pick it up');
  });
};

export const registerOutboxJobHandlers = (): void => {
  registerJobHandler('outbox', OUTBOX_RELAY_JOB, async () => {
    await relayOutbox();
  });
  registerJobHandler('outbox', OUTBOX_DISPATCH_JOB, async (data) => {
    // Envelope shapes come from our own relay; tolerate date serialization.
    const raw = data as EventEnvelope & { occurredAt: string | Date };
    await dispatchReliable({ ...raw, occurredAt: new Date(raw.occurredAt) });
  });
};

/** Test-only: reset subscriptions between suites. */
export const clearSubscriptions = (): void => {
  subscriptions.clear();
};
