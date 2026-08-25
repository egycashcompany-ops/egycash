// The chokepoint wiring (ADR-029): `record()` announces every audited change exactly once, and
// a publisher that misbehaves can never break the audit write it rides on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../realtime', () => ({
  publishAuditedChange: vi.fn(),
  publishActivity: vi.fn(),
}));
vi.mock('../../infrastructure/queue/jobs', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  registerJobHandler: vi.fn(),
}));

const { publishAuditedChange, publishActivity } = await import('../realtime');
const { enqueue } = await import('../../infrastructure/queue/jobs');
const { auditService } = await import('./audit.service');

const published = vi.mocked(publishAuditedChange);
const activityPublished = vi.mocked(publishActivity);
const enqueued = vi.mocked(enqueue);

beforeEach(() => {
  published.mockReset();
  activityPublished.mockReset();
  enqueued.mockReset();
  enqueued.mockResolvedValue(undefined);
});

describe('audit record → realtime signal', () => {
  it('announces the change once, with the same entityRef, action and timestamp as the row', async () => {
    await auditService.record({
      entityRef: { moduleId: 'gold', entityType: 'bar', entityId: 'bar1' },
      action: 'update',
      changes: [],
    });
    expect(published).toHaveBeenCalledTimes(1);
    const change = published.mock.calls[0]?.[0];
    expect(change?.entityRef).toEqual({ moduleId: 'gold', entityType: 'bar', entityId: 'bar1' });
    expect(change?.action).toBe('update');
    const row = enqueued.mock.calls[0]?.[2] as { at: string };
    expect(change?.at).toBe(row.at);
  });

  it('still records the audit row when the publisher blows up', async () => {
    published.mockImplementation(() => {
      throw new Error('publisher bug');
    });
    // The publisher contracts to never throw; if a bug breaks that contract anyway, the audit
    // trail — the system's memory — must not lose the row over it.
    await expect(
      auditService.record({
        entityRef: { moduleId: 'gold', entityType: 'bar', entityId: 'bar2' },
        action: 'delete',
      }),
    ).resolves.toBeUndefined();
    expect(enqueued).toHaveBeenCalledTimes(1);
  });

  it('announces activity entries on their own stream', async () => {
    await auditService.recordActivity({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e1' },
      messageKey: 'hr.employee.noted',
    });
    expect(activityPublished).toHaveBeenCalledTimes(1);
    expect(published).not.toHaveBeenCalled();
  });
});
