// `recordMany` — a batch write's trail. The promise: the SAME rows `record` would write, one per
// entry, for one queue round trip and one realtime signal per changed topic — and the same
// never-throws fallback when the queue is down.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry } from './audit.service';

const written = vi.hoisted(() => [] as Record<string, unknown>[]);
const failWrite = vi.hoisted(() => ({ codes: new Set<string>() }));

vi.mock('../realtime', () => ({
  publishAuditedChange: vi.fn(),
  publishActivity: vi.fn(),
}));
vi.mock('../../infrastructure/queue/jobs', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  enqueueMany: vi.fn().mockResolvedValue(undefined),
  registerJobHandler: vi.fn(),
}));
vi.mock('../../infrastructure/observability/sentry', () => ({ captureError: vi.fn() }));
vi.mock('./audit.model', () => ({
  AuditLogModel: {
    create: vi.fn(async (docs: Record<string, unknown>[]) => {
      for (const doc of docs) {
        const id = (doc.entityRef as { entityId: string }).entityId;
        if (failWrite.codes.has(id)) throw new Error(`disk full for ${id}`);
        written.push(doc);
      }
    }),
  },
  ActivityLogModel: { create: vi.fn() },
}));

const { publishAuditedChange } = await import('../realtime');
const { enqueue, enqueueMany } = await import('../../infrastructure/queue/jobs');
const { captureError } = await import('../../infrastructure/observability/sentry');
const { runWithContext } = await import('../../infrastructure/http/request-context');
const { auditService } = await import('./audit.service');

const published = vi.mocked(publishAuditedChange);
const enqueued = vi.mocked(enqueue);
const enqueuedMany = vi.mocked(enqueueMany);
const alarmed = vi.mocked(captureError);

const ACTOR = { userId: '6a71ba261db68a923e529c01', ip: '10.0.0.1', userAgent: 'spec' };
const IDENTITY = {
  displayName: { ar: 'أحمد سالم', en: 'Ahmed Salem' },
  jobTitle: null,
  avatarFileId: null,
};
const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithContext({ requestId: 'req_batch', actor: { ...ACTOR, identity: IDENTITY } }, fn);

const opened = (entityId: string, entityType = 'replenishment'): AuditEntry => ({
  entityRef: { moduleId: 'atm', entityType, entityId },
  action: 'create',
  changes: [{ field: 'machineCode', old: null, new: entityId }],
});

type Job = { name: string; data: Record<string, unknown> };
const jobsOf = (call = 0): Job[] => (enqueuedMany.mock.calls[call]?.[1] ?? []) as Job[];

beforeEach(() => {
  published.mockReset();
  enqueued.mockReset();
  enqueued.mockResolvedValue(undefined);
  enqueuedMany.mockReset();
  enqueuedMany.mockResolvedValue(undefined);
  alarmed.mockReset();
  written.length = 0;
  failWrite.codes.clear();
});

describe('recordMany — the queue', () => {
  it('queues every entry in ONE batch, each the very row `record` would queue', async () => {
    const entries = [opened('r1'), opened('r2'), opened('r3')];
    await inRequest(() => auditService.recordMany(entries));

    expect(enqueuedMany).toHaveBeenCalledTimes(1);
    expect(enqueued).not.toHaveBeenCalled();
    expect(enqueuedMany.mock.calls[0]?.[0]).toBe('audit');
    const jobs = jobsOf();
    expect(jobs.map((job) => job.name)).toEqual(['audit.write', 'audit.write', 'audit.write']);
    expect(jobs.map((job) => (job.data.entityRef as { entityId: string }).entityId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);

    // The same entry through `record`: the payloads differ in nothing but the instant.
    await inRequest(() => auditService.record(entries[0] as AuditEntry));
    const single = enqueued.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(enqueued.mock.calls[0]?.[1]).toBe('audit.write');
    expect({ ...jobs[0]?.data, at: null }).toEqual({ ...single, at: null });
    expect(jobs[0]?.data).toMatchObject({
      actor: ACTOR,
      actorIdentity: IDENTITY,
      requestId: 'req_batch',
    });
  });

  it('stamps the batch with ONE instant — they are one act', async () => {
    await inRequest(() => auditService.recordMany([opened('r1'), opened('r2')]));
    const [first, second] = jobsOf();
    expect(typeof first?.data.at).toBe('string');
    expect(second?.data.at).toBe(first?.data.at);
  });

  it('honours an entry that names its own actor, as `record` does', async () => {
    const other = { userId: '6a71ba261db68a923e529c02', ip: null, userAgent: null };
    await inRequest(() => auditService.recordMany([{ ...opened('r1'), actor: other }]));
    // Another person: the request's identity is not lent to them.
    expect(jobsOf()[0]?.data).toMatchObject({ actor: other, actorIdentity: null });
  });

  it('an empty batch queues nothing and announces nothing', async () => {
    await auditService.recordMany([]);
    expect(enqueuedMany).not.toHaveBeenCalled();
    expect(published).not.toHaveBeenCalled();
  });
});

describe('recordMany — the realtime signal', () => {
  it('announces each entity type and action ONCE, at the rows’ own instant', async () => {
    await inRequest(() =>
      auditService.recordMany([
        opened('r1'),
        opened('r2'),
        opened('m1', 'maintenance'),
        opened('r3'),
        { ...opened('r4'), action: 'update' },
      ]),
    );
    expect(published).toHaveBeenCalledTimes(3);
    expect(
      published.mock.calls.map(([change]) => [change.entityRef.entityType, change.action]),
    ).toEqual([
      ['replenishment', 'create'],
      ['maintenance', 'create'],
      ['replenishment', 'update'],
    ]);
    expect(published.mock.calls[0]?.[0].at).toBe(jobsOf()[0]?.data.at);
  });

  it('a publisher that blows up costs the signal, never the rows', async () => {
    published.mockImplementation(() => {
      throw new Error('publisher bug');
    });
    await expect(auditService.recordMany([opened('r1'), opened('r2')])).resolves.toBeUndefined();
    expect(jobsOf()).toHaveLength(2);
  });
});

describe('recordMany — the queue is down', () => {
  it('writes every row in the request, in order, as `record` falls back for its one', async () => {
    enqueuedMany.mockRejectedValue(new Error('no redis'));
    await expect(
      inRequest(() => auditService.recordMany([opened('r1'), opened('r2'), opened('r3')])),
    ).resolves.toBeUndefined();
    expect(written.map((row) => (row.entityRef as { entityId: string }).entityId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    expect(written[0]).toMatchObject({ action: 'create', requestId: 'req_batch' });
    expect(alarmed).not.toHaveBeenCalled();
  });

  it('a row that cannot be written either is alarmed — and the rows after it are still written', async () => {
    enqueuedMany.mockRejectedValue(new Error('no redis'));
    failWrite.codes.add('r2');
    await expect(
      auditService.recordMany([opened('r1'), opened('r2'), opened('r3')]),
    ).resolves.toBeUndefined();
    expect(written.map((row) => (row.entityRef as { entityId: string }).entityId)).toEqual([
      'r1',
      'r3',
    ]);
    expect(alarmed).toHaveBeenCalledTimes(1);
    expect(alarmed.mock.calls[0]?.[1]).toMatchObject({ audit: true });
  });
});
