// MongoDB connection (ADR-005) + slow-query telemetry (Review R30):
// command monitoring logs any operation slower than SLOW_QUERY_MS so index
// gaps surface before users feel them.
import mongoose from 'mongoose';
import { env, isProduction } from '../config/env';
import { logger } from '../logging/logger';

/**
 * Commands that name their collection as the value of their own first key —
 * `{ find: 'audit_logs', filter: … }`. A slow-operation line that says only `find` cannot be acted
 * on; one that says `find` on `audit_logs` points straight at the index that is missing.
 */
const NAMED_BY_THEIR_OWN_KEY = new Set([
  'find',
  'aggregate',
  'count',
  'distinct',
  'insert',
  'update',
  'delete',
  'findAndModify',
]);

/**
 * Pure: the collection a monitored command reads or writes, or null when it names none — `ping`,
 * `hello`, a database-level `aggregate: 1`. A cursor's next batch (`getMore`) carries the
 * collection in a field of its own, so a slow page of a long cursor is attributed too.
 */
export const commandCollection = (
  commandName: string,
  command: Readonly<Record<string, unknown>> | undefined,
): string | null => {
  if (command === undefined) return null;
  const named = NAMED_BY_THEIR_OWN_KEY.has(commandName)
    ? command[commandName]
    : commandName === 'getMore'
      ? command['collection']
      : undefined;
  return typeof named === 'string' && named !== '' ? named : null;
};

/** Five pings: enough for a median, few enough to cost a handful of milliseconds. */
const ROUND_TRIP_SAMPLES = 5;
/**
 * The whole measurement's budget. A database that cannot answer five pings in a second is a
 * problem the boot's own queries will report far more loudly; this line must not add to it.
 */
const ROUND_TRIP_BUDGET_MS = 1_000;

export interface RoundTripSamples {
  samplesMs: number[];
  /** Why fewer than the samples asked for were taken; null when all of them were. */
  stopped: 'budget' | 'failed' | null;
}

/**
 * Times up to `samples` SEQUENTIAL pings — one at a time, so each is one round trip and not a
 * share of a burst — and stops early when the budget is spent or a ping fails. Never throws, and
 * never waits past the budget: a ping still in flight then is abandoned, not awaited.
 */
export const measureRoundTrips = async (
  ping: () => Promise<unknown>,
  {
    samples = ROUND_TRIP_SAMPLES,
    budgetMs = ROUND_TRIP_BUDGET_MS,
    now = (): number => performance.now(),
  }: { samples?: number; budgetMs?: number; now?: () => number } = {},
): Promise<RoundTripSamples> => {
  const deadline = now() + budgetMs;
  const samplesMs: number[] = [];
  while (samplesMs.length < samples) {
    const remaining = deadline - now();
    if (remaining <= 0) return { samplesMs, stopped: 'budget' };
    const started = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      // Settled either way here, so an abandoned ping that fails later is no unhandled rejection.
      Promise.resolve()
        .then(ping)
        .then(
          () => 'answered' as const,
          () => 'failed' as const,
        ),
      new Promise<'budget'>((resolve) => {
        timer = setTimeout(() => resolve('budget'), remaining);
      }),
    ]);
    clearTimeout(timer);
    if (outcome !== 'answered') return { samplesMs, stopped: outcome };
    samplesMs.push(now() - started);
  }
  return { samplesMs, stopped: null };
};

/** Pure: the median and the fastest sample, to a tenth of a millisecond; null with no samples. */
export const roundTripSummary = (
  samplesMs: readonly number[],
): { medianMs: number; minMs: number } | null => {
  if (samplesMs.length === 0) return null;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const tenth = (ms: number): number => Math.round(ms * 10) / 10;
  return { medianMs: tenth(median), minMs: tenth(sorted[0] as number) };
};

/**
 * One line per boot saying how far away the database is. The api is query-bound, not CPU-bound:
 * a request that runs fifty sequential queries pays the round trip fifty times, so this is the
 * number every slow endpoint is multiplied by — and the one that should drop when the database
 * moves next to the app. The MEDIAN, because the first ping may also open the pool's first
 * connection; the MINIMUM, because that is the wire itself.
 *
 * Telemetry only: it never fails the boot and never holds it past the budget above.
 */
const logRoundTrip = async (): Promise<void> => {
  try {
    const db = mongoose.connection.db;
    if (db === undefined) return;
    const { samplesMs, stopped } = await measureRoundTrips(() => db.command({ ping: 1 }));
    const summary = roundTripSummary(samplesMs);
    if (summary === null) {
      logger.warn({ stopped }, 'mongo round trip not measured');
      return;
    }
    logger.info({ ...summary, samples: samplesMs.length }, 'mongo round trip');
  } catch {
    /* a measurement that cannot be taken is not worth a boot */
  }
};

export const connectMongo = async (uri: string = env.MONGO_URI): Promise<void> => {
  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', !isProduction); // index sync is a deploy step in production

  // The collection is read from the STARTED event: the succeeded one carries the reply, not the
  // command, so this is the only moment it is known.
  const started = new Map<number, { name: string; collection: string | null; startedAt: number }>();

  await mongoose.connect(uri, { monitorCommands: true });

  const client = mongoose.connection.getClient();
  client.on('commandStarted', (event) => {
    started.set(event.requestId, {
      name: event.commandName,
      collection: commandCollection(event.commandName, event.command),
      startedAt: Date.now(),
    });
  });
  const finish = (requestId: number) => {
    const entry = started.get(requestId);
    started.delete(requestId);
    return entry;
  };
  client.on('commandSucceeded', (event) => {
    const entry = finish(event.requestId);
    if (entry !== undefined && event.duration >= env.SLOW_QUERY_MS) {
      logger.warn(
        {
          command: entry.name,
          ...(entry.collection === null ? {} : { collection: entry.collection }),
          durationMs: event.duration,
        },
        'slow mongo operation',
      );
    }
  });
  client.on('commandFailed', (event) => {
    finish(event.requestId);
  });

  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  await logRoundTrip();
};

export const disconnectMongo = async (): Promise<void> => {
  await mongoose.disconnect();
};

export const mongoReady = (): boolean => mongoose.connection.readyState === 1;
