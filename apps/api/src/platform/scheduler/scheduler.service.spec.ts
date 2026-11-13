// What becomes of a scheduled task that fails: recorded and logged, and handed back to the job queue
// to retry — unless the task says its next run IS the retry (`retry: false`). 2026-11-13: the ATM
// mailbox poll, a per-minute task, was retried four more times over the next two minutes; the
// retries met those minutes' runs in the mailbox and every request queued behind the others until
// it timed out.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => Promise<void>>(),
  updateOne: vi.fn(),
}));

vi.mock('../../infrastructure/queue/jobs', () => ({
  registerJobHandler: (_queue: string, name: string, handler: () => Promise<void>) => {
    mocks.handlers.set(name, handler);
  },
  enqueue: vi.fn(),
  removeRepeatable: vi.fn(),
  scheduleRepeatable: vi.fn(),
}));
vi.mock('./scheduled-task.model', () => ({
  ScheduledTaskModel: {
    updateOne: (...args: unknown[]) => {
      mocks.updateOne(...args);
      return { exec: async () => undefined };
    },
  },
}));
vi.mock('../audit', () => ({ auditService: { record: vi.fn() } }));

const { schedulerService } = await import('./scheduler.service');

/** The handler the queue would run for `key`. */
const queued = (key: string): (() => Promise<void>) => {
  const handler = mocks.handlers.get(key);
  if (handler === undefined) throw new Error(`no job handler for ${key}`);
  return handler;
};

const lastResult = (key: string): unknown => {
  const call = mocks.updateOne.mock.calls.findLast(
    ([filter]) => (filter as { key?: string }).key === key,
  );
  return (call?.[1] as { $set?: { lastResult?: unknown } } | undefined)?.$set?.lastResult;
};

beforeEach(() => {
  mocks.updateOne.mockClear();
});

describe('a scheduled task that fails', () => {
  it('is handed back to the queue to retry — what every task has always done', async () => {
    schedulerService.declareTask({
      key: 'test.retried',
      description: 'fails',
      cron: '0 3 * * *',
      ownerService: 'test',
      handler: async () => {
        throw new Error('down');
      },
    });

    await expect(queued('test.retried')()).rejects.toThrow('down');
    expect(lastResult('test.retried')).toBe('failed');
  });

  it('is not retried when its next run is the retry — recorded failed all the same', async () => {
    schedulerService.declareTask({
      key: 'test.notRetried',
      description: 'fails, every minute',
      cron: '* * * * *',
      ownerService: 'test',
      retry: false,
      handler: async () => {
        throw new Error('This operation was aborted');
      },
    });

    await expect(queued('test.notRetried')()).resolves.toBeUndefined();
    expect(lastResult('test.notRetried')).toBe('failed');
  });

  it('records a run that succeeds as ok, retried or not', async () => {
    schedulerService.declareTask({
      key: 'test.ok',
      description: 'works',
      cron: '* * * * *',
      ownerService: 'test',
      retry: false,
      handler: async () => {},
    });

    await expect(queued('test.ok')()).resolves.toBeUndefined();
    expect(lastResult('test.ok')).toBe('ok');
  });
});
