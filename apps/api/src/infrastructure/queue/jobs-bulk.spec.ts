// `enqueueMany` — several jobs in one round trip. What it must keep: each job gets exactly the
// envelope `enqueue` would give it (the envelope is a wire format, jobs.spec.ts), and in tests the
// handlers run inline, in order, as `enqueue`'s do.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EnvModule from '../config/env';

const mode = vi.hoisted(() => ({ isTest: false }));
const added = vi.hoisted(() => ({
  add: vi.fn(async (..._args: unknown[]) => undefined),
  addBulk: vi.fn(async (..._args: unknown[]) => []),
}));

// The real env, but `isTest` switchable: off, `enqueueMany` goes to (the mocked) BullMQ.
vi.mock('../config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  get isTest() {
    return mode.isTest;
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    add = added.add;
    addBulk = added.addBulk;
  },
  Worker: class {},
}));

const { enqueue, enqueueMany, registerJobHandler, DEFAULT_ATTEMPTS, JobEnvelopeSchema } =
  await import('./jobs');
const { runWithContext } = await import('../http/request-context');

beforeEach(() => {
  mode.isTest = false;
  added.add.mockClear();
  added.addBulk.mockClear();
});

describe('enqueueMany — through BullMQ', () => {
  it('adds every job in ONE addBulk, each with the envelope `enqueue` would give it', async () => {
    await runWithContext({ requestId: 'req_bulk' }, async () => {
      await enqueueMany('audit', [
        { name: 'audit.write', data: { n: 1 } },
        { name: 'audit.write', data: { n: 2 }, options: { attempts: 9 } },
      ]);
      await enqueue('audit', 'audit.write', { n: 1 });
    });

    expect(added.addBulk).toHaveBeenCalledTimes(1);
    const bulk = added.addBulk.mock.calls[0]?.[0] as {
      name: string;
      data: Record<string, unknown>;
      opts?: unknown;
    }[];
    expect(bulk.map((job) => [job.name, job.data.data, job.opts])).toEqual([
      ['audit.write', { n: 1 }, undefined],
      ['audit.write', { n: 2 }, { attempts: 9 }],
    ]);
    // Field for field what `enqueue` sends, but for the instant it was built.
    const single = added.add.mock.calls[0]?.[1] as Record<string, unknown>;
    expect({ ...bulk[0]?.data, enqueuedAt: null }).toEqual({ ...single, enqueuedAt: null });
    expect(bulk[0]?.data).toMatchObject({
      requestId: 'req_bulk',
      correlationId: 'req_bulk',
      attempt: 1,
      maxAttempts: DEFAULT_ATTEMPTS,
    });
    expect(bulk[1]?.data).toMatchObject({ maxAttempts: 9 });
    // And it is a valid envelope on the worker's side.
    expect(() => JobEnvelopeSchema.parse(bulk[1]?.data)).not.toThrow();
  });

  it('carries the caller’s job context on every job', async () => {
    await enqueueMany('audit', [{ name: 'audit.write', data: {} }], {
      branchId: 'b1',
      principal: { userId: 'u1' },
    });
    const [job] = added.addBulk.mock.calls[0]?.[0] as { data: Record<string, unknown> }[];
    expect(job?.data).toMatchObject({ branchId: 'b1', principal: { userId: 'u1', kind: 'user' } });
  });

  it('an empty batch is no round trip', async () => {
    await enqueueMany('audit', []);
    expect(added.addBulk).not.toHaveBeenCalled();
  });

  it('throws when the queue is unreachable, as `enqueue` does — the caller falls back', async () => {
    added.addBulk.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(enqueueMany('audit', [{ name: 'audit.write', data: {} }])).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});

describe('enqueueMany — inline in tests', () => {
  it('runs each job’s handler in order, in the request’s context, and never touches Redis', async () => {
    mode.isTest = true;
    const seen: unknown[] = [];
    registerJobHandler('scheduled', 'spec.bulk-inline', async (data) => {
      const { getRequestId } = await import('../http/request-context');
      seen.push([data, getRequestId()]);
    });
    await runWithContext({ requestId: 'req_inline' }, () =>
      enqueueMany('scheduled', [
        { name: 'spec.bulk-inline', data: 'first' },
        { name: 'spec.bulk-inline', data: 'second' },
      ]),
    );
    expect(seen).toEqual([
      ['first', 'req_inline'],
      ['second', 'req_inline'],
    ]);
    expect(added.addBulk).not.toHaveBeenCalled();
  });

  it('a job with no handler is an error, as it is for `enqueue`', async () => {
    mode.isTest = true;
    await expect(enqueueMany('scheduled', [{ name: 'spec.nobody', data: null }])).rejects.toThrow(
      'no handler for scheduled:spec.nobody',
    );
  });
});
