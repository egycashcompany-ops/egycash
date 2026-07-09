// Background-work wiring (ADR-009). One queue per domain; every payload carries
// the originating requestId for log correlation. In tests the driver runs jobs
// inline so suites stay hermetic (no Redis).
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { env, isTest } from '../config/env';
import { logger } from '../logging/logger';
import { getRequestId, newRequestId, runWithContext } from '../http/request-context';

export const QUEUES = ['audit', 'outbox', 'scheduled', 'files'] as const;
export type QueueName = (typeof QUEUES)[number];

export const JobEnvelopeSchema = z.object({
  requestId: z.string(),
  data: z.unknown(),
});
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

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

const queues = new Map<QueueName, Queue>();

const getQueue = (name: QueueName): Queue => {
  let queue = queues.get(name);
  if (queue === undefined) {
    queue = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 5,
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
): Promise<void> => {
  const envelope: JobEnvelope = { requestId: getRequestId() ?? newRequestId(), data };
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
        const envelope = JobEnvelopeSchema.parse(job.data);
        const handler = getJobHandler(queueName, job.name);
        if (handler === undefined) {
          logger.error({ queue: queueName, job: job.name }, 'no handler registered for job');
          return;
        }
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
