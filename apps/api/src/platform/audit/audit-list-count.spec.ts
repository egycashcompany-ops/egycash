// The audit and activity lists' totals: an unfiltered page reads the collection's own count
// (metadata), never every document — `countDocuments({})` on audit_logs read the whole collection
// at every load of the audit page. A filtered page still counts exactly what it matches.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const models = vi.hoisted(() => {
  const chain = () => {
    const query = {
      sort: vi.fn(() => query),
      skip: vi.fn(() => query),
      limit: vi.fn(() => query),
      lean: vi.fn(() => query),
      exec: vi.fn(async () => []),
    };
    return query;
  };
  const model = () => ({
    find: vi.fn(() => chain()),
    countDocuments: vi.fn(() => ({ exec: vi.fn(async () => 7) })),
    estimatedDocumentCount: vi.fn(() => ({ exec: vi.fn(async () => 1234) })),
  });
  return { audit: model(), activity: model() };
});

vi.mock('./audit.model', () => ({
  AuditLogModel: models.audit,
  ActivityLogModel: models.activity,
}));
vi.mock('../realtime', () => ({ publishAuditedChange: vi.fn(), publishActivity: vi.fn() }));
vi.mock('../../infrastructure/queue/jobs', () => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
  registerJobHandler: vi.fn(),
}));

const { auditService } = await import('./audit.service');

beforeEach(() => {
  for (const model of [models.audit, models.activity]) {
    model.countDocuments.mockClear();
    model.estimatedDocumentCount.mockClear();
  }
});

describe('the audit list total', () => {
  it('unfiltered: the collection count from metadata — no document is read to count', async () => {
    const page = await auditService.listAuditLogs({ page: 1, pageSize: 20 } as never);
    expect(page.meta.totalItems).toBe(1234);
    expect(page.meta.totalPages).toBe(62);
    expect(models.audit.estimatedDocumentCount).toHaveBeenCalledTimes(1);
    expect(models.audit.countDocuments).not.toHaveBeenCalled();
  });

  it('filtered: counts exactly what the filter matches', async () => {
    const page = await auditService.listAuditLogs({
      page: 1,
      pageSize: 20,
      moduleId: 'atm',
    } as never);
    expect(page.meta.totalItems).toBe(7);
    expect(models.audit.countDocuments).toHaveBeenCalledWith({ 'entityRef.moduleId': 'atm' });
    expect(models.audit.estimatedDocumentCount).not.toHaveBeenCalled();
  });
});

describe('the activity list total', () => {
  it('unfiltered: metadata; filtered: an exact count', async () => {
    await auditService.listActivityLogs({ page: 1, pageSize: 20 } as never);
    expect(models.activity.estimatedDocumentCount).toHaveBeenCalledTimes(1);
    expect(models.activity.countDocuments).not.toHaveBeenCalled();
    await auditService.listActivityLogs({ page: 1, pageSize: 20, entityType: 'user' } as never);
    expect(models.activity.countDocuments).toHaveBeenCalledWith({
      'entityRef.entityType': 'user',
    });
  });
});
