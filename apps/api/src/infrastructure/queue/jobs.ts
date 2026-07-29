// Background-work wiring (ADR-009). One queue per domain; every payload carries
// the originating requestId for log correlation. In tests the driver runs jobs
// inline so suites stay hermetic (no Redis).
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { env, isTest } from '../config/env';
import { logger } from '../logging/logger';
import { getRequestId, newRequestId, runWithContext } from '../http/request-context';

export const QUEUES = [
  'audit',
  'outbox',
  'scheduled',
  'files',
  'notifications',
  /**
   * Automation (A-1). Deliberately carries NO provider-specific meaning: it moves envelopes, and
   * what runs them is decided by `platform/automation`'s registry. Nothing here knows n8n exists,
   * and a provider swap does not touch this file.
   */
  'automation',
] as const;
export type QueueName = (typeof QUEUES)[number];

/**
 * What every queue message carries.
 *
 * **Additive by contract.** `requestId` and `data` are the original v1 shape and keep their exact
 * meaning; everything added since is OPTIONAL, so a message enqueued by an older deploy still
 * parses on a newer worker and vice versa. That matters during a rolling deploy, when both
 * versions are draining the same Redis at once — a required field would drop those jobs on the
 * floor. New fields are added the same way: optional, defaulted at the read site, never required.
 *
 * The metadata exists because debugging a job you cannot see is guesswork. Given a failed
 * execution, these answer: which HTTP request started this (`correlationId`), which business fact
 * caused it (`eventId`), whose data it touches (`branchId`), whose authority it runs under
 * (`principal`), when it was created rather than when it ran (`enqueuedAt`), and how many times it
 * has already been tried (`attempt`).
 */
export const JobEnvelopeSchema = z.object({
  /** v1. Kept as-is: the request that produced the job. Also the correlation id's default. */
  requestId: z.string(),
  /** v1. The handler's own payload — opaque to the queue. */
  data: z.unknown(),

  // ── Added in A-1. All optional; readers default them. ──
  /** Follows a chain of work across services and retries. Defaults to `requestId`. */
  correlationId: z.string().optional(),
  /** The domain event that caused this job, when there was one. Ties a run back to its cause. */
  eventId: z.string().optional(),
  /** Branch scope of the data being acted on — ECMS is single-organization (ADR-015). */
  branchId: z.string().optional(),
  /** WHOSE authority the work runs under. Absent for system-initiated jobs, never faked. */
  principal: z
    .object({ userId: z.string(), kind: z.enum(['user', 'system', 'automation']).default('user') })
    .optional(),
  /** When the job was CREATED. Distinct from when it ran, which is what makes lag visible. */
  enqueuedAt: z.coerce.date().optional(),
  /** Which attempt this is, 1-based, and the ceiling the queue will allow. */
  attempt: z.number().int().min(1).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

/** Metadata a caller may attach when enqueuing. Everything is optional by design. */
export interface JobContext {
  correlationId?: string | undefined;
  eventId?: string | undefined;
  branchId?: string | undefined;
  principal?: { userId: string; kind?: 'user' | 'system' | 'automation' } | undefined;
}

export type JobHandler = (data: unknown, jobName: string) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const handlerKey = (queue: QueueName, jobName: string) => `${queue}:${jobName}`;

/** Handlers are registered by platform services; the worker process runs them. */
export const registerJobHandler = (
  queue: QueueName,
  jobName: string,
  handler: JobHandler,
): void => {
  const key = handlerKey(queue, jobName);
  if (handlers.has(key)) throw new Error(`duplicate job handler: ${key}`);
  handlers.set(key, handler);
};

export const getJobHandler = (queue: QueueName, jobName: string): JobHandler | undefined =>
  handlers.get(handlerKey(queue, jobName));

const redisConnection = () => ({
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null,
});

/** Kept as a constant so the envelope can report the ceiling it was enqueued under. */
export const DEFAULT_ATTEMPTS = 5;

const queues = new Map<QueueName, Queue>();

const getQueue = (name: QueueName): Queue => {
  let queue = queues.get(name);
  if (queue === undefined) {
    queue = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: DEFAULT_ATTEMPTS,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: false,
      },
    });
    queues.set(name, queue);
  }
  return queue;
};

/**
 * Enqueue a job. Inline in tests (awaited, same process); BullMQ otherwise.
 * Throws when the queue is unreachable — callers that must never fail a business
 * operation (audit) catch and fall back.
 */
export const enqueue = async (
  queue: QueueName,
  jobName: string,
  data: unknown,
  options?: JobsOptions,
  context?: JobContext,
): Promise<void> => {
  const requestId = getRequestId() ?? newRequestId();
  const envelope: JobEnvelope = {
    requestId,
    data,
    correlationId: context?.correlationId ?? requestId,
    enqueuedAt: new Date(),
    attempt: 1,
    maxAttempts: (options?.attempts ?? DEFAULT_ATTEMPTS) as number,
    ...(context?.eventId === undefined ? {} : { eventId: context.eventId }),
    ...(context?.branchId === undefined ? {} : { branchId: context.branchId }),
    ...(context?.principal === undefined
      ? {}
      : { principal: { userId: context.principal.userId, kind: context.principal.kind ?? 'user' } }),
  };
  if (isTest) {
    const handler = getJobHandler(queue, jobName);
    if (handler === undefined) throw new Error(`no handler for ${handlerKey(queue, jobName)}`);
    await runWithContext({ requestId: envelope.requestId }, () => handler(envelope.data, jobName));
    return;
  }
  await getQueue(queue).add(jobName, envelope, options);
};

export const scheduleRepeatable = async (
  queue: QueueName,
  jobName: string,
  cron: string,
  data: unknown,
): Promise<void> => {
  if (isTest) return; // repeatable schedules are exercised by the scheduler unit tests
  await getQueue(queue).add(jobName, { requestId: `cron_${jobName}`, data } satisfies JobEnvelope, {
    repeat: { pattern: cron },
    jobId: `repeat:${jobName}`,
  });
};

export const removeRepeatable = async (
  queue: QueueName,
  jobName: string,
  cron: string,
): Promise<void> => {
  if (isTest) return;
  await getQueue(queue).removeRepeatable(jobName, { pattern: cron, jobId: `repeat:${jobName}` });
};

/** Started by the worker entrypoint only (apps/api/src/worker.ts). */
export const startWorkers = (): Worker[] => {
  return QUEUES.map((queueName) =>
    new Worker(
      queueName,
      async (job) => {
        // Non-strict on purpose: a message enqueued by an older deploy lacks the A-1 metadata, and
        // during a rolling deploy both versions drain the same Redis. Refusing those would drop
        // real work; the fields are optional precisely so this parse cannot fail on age.
        const envelope = JobEnvelopeSchema.parse(job.data);
        const handler = getJobHandler(queueName, job.name);
        if (handler === undefined) {
          logger.error({ queue: queueName, job: job.name }, 'no handler registered for job');
          return;
        }
        // BullMQ owns the retry count, so the ATTEMPT comes from the job rather than the envelope
        // — the envelope's value is what it was on first enqueue and would be wrong on a retry.
        logger.debug(
          {
            queue: queueName,
            job: job.name,
            correlationId: envelope.correlationId ?? envelope.requestId,
            eventId: envelope.eventId,
            branchId: envelope.branchId,
            attempt: job.attemptsMade + 1,
            maxAttempts: envelope.maxAttempts,
            lagMs:
              envelope.enqueuedAt === undefined
                ? undefined
                : Date.now() - envelope.enqueuedAt.getTime(),
          },
          'job started',
        );
        await runWithContext({ requestId: envelope.requestId }, () =>
          handler(envelope.data, job.name),
        );
      },
      { connection: redisConnection(), concurrency: 5 },
    )
      .on('failed', (job, error) => {
        logger.error({ queue: queueName, job: job?.name, err: error }, 'job failed');
      })
      .on('error', (error) => {
        logger.error({ queue: queueName, err: error }, 'worker error');
      }),
  );
};

export const closeQueues = async (): Promise<void> => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
};
