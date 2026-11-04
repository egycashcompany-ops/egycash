// Reject, the whole selection at once: ONE scoped write that only a still-pending ticket matches,
// ONE read of what that write decided, ONE batch of audit rows. The database is mocked here — the
// filters are the point; the race with a concurrent accept is proven over a real mongod in
// tests/integration/atm-no-double-open.spec.ts, the return to pending in atm-mail-restore.spec.ts.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuditEntry } from '../../../platform/audit';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { type AtmMailTicketDoc } from './mail-ticket.model';

const recordMany = vi.hoisted(() => vi.fn(async (_entries: readonly AuditEntry[]) => undefined));
const record = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../platform/audit', () => ({ auditService: { record, recordMany } }));

// The real audit service loads first, as the app loads it: the organization models import it
// directly (not through the mocked index), and entering that cycle from their side finds
// `org-unit` half-built. The service under test sees only the mocked `auditService`.
await import('../../../platform/audit/audit.service');
const { atmMailTicketService } = await import('./mail-ticket.service');
const { atmMailTicketRepository } = await import('./mail-ticket.repository');
const { AtmMailTicketModel } = await import('./mail-ticket.model');

const branchId = new Types.ObjectId();
const scope: ScopeSelector = {
  scope: 'branch',
  userId: String(new Types.ObjectId()),
  branchId: String(branchId),
  departmentId: null,
  sectionId: null,
};
const ticket = (status: AtmMailTicketDoc['status'] = 'rejected'): AtmMailTicketDoc =>
  ({ _id: new Types.ObjectId(), branchId, status, machineCode: '1001' }) as AtmMailTicketDoc;

/** The model's two calls, recorded; `find` answers with `stored`. */
const stubModel = (stored: AtmMailTicketDoc[]) => {
  const updateMany = vi
    .spyOn(AtmMailTicketModel, 'updateMany')
    .mockReturnValue({ exec: async () => ({ matchedCount: stored.length }) } as never);
  const find = vi
    .spyOn(AtmMailTicketModel, 'find')
    .mockReturnValue({ lean: () => ({ exec: async () => stored }) } as never);
  return { updateMany, find };
};

/** Every clause of a `baseFilter` (`$and` of the parts), merged — order-free to assert on. */
const clausesOf = (filter: unknown): Record<string, unknown> => {
  const parts = (filter as { $and?: Record<string, unknown>[] }).$and ?? [filter];
  return Object.assign({}, ...parts) as Record<string, unknown>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('atmMailTicketRepository.decidePending', () => {
  const decision = {
    status: 'rejected' as const,
    actionById: new Types.ObjectId(),
    actionByName: 'م. أحمد',
    actionAt: new Date('2026-11-04T09:15:30.123Z'),
  };

  it('ONE write, matching only the PENDING tickets of the selection the scope reaches', async () => {
    const { updateMany } = stubModel([]);
    const [a, b] = [ticket(), ticket()];
    await atmMailTicketRepository.decidePending([String(a._id), String(b._id)], decision, {
      by: scope.userId,
      scope,
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0] ?? [];
    expect(clausesOf(filter)).toMatchObject({
      _id: { $in: [a._id, b._id] },
      status: 'pending',
      isDeleted: false,
      branchId,
    });
    expect(update).toEqual({
      $set: { ...decision, updatedBy: new Types.ObjectId(scope.userId) },
      $inc: { __v: 1 },
    });
  });

  it('reads back only what THIS write decided — by its decider and its exact instant', async () => {
    const { find } = stubModel([]);
    const a = ticket();
    await atmMailTicketRepository.decidePending([String(a._id)], decision, {
      by: scope.userId,
      scope,
    });
    expect(find).toHaveBeenCalledTimes(1);
    // `find` is overloaded, so its recorded calls type as `[]`: read the filter untyped.
    expect(clausesOf((find.mock.calls[0] as unknown[] | undefined)?.[0])).toMatchObject({
      _id: { $in: [a._id] },
      status: 'rejected',
      actionById: decision.actionById,
      actionAt: decision.actionAt,
      isDeleted: false,
      branchId,
    });
  });

  it('answers in the selection’s order, each ticket once, leaving out what it did not decide', async () => {
    const [a, b, c] = [ticket(), ticket(), ticket()];
    // The read returns them in any order; `c` was already decided, so the write did not match it.
    stubModel([b, a]);
    const rows = await atmMailTicketRepository.decidePending(
      [String(a._id), String(c._id), String(b._id), String(a._id)],
      decision,
      { by: scope.userId, scope },
    );
    expect(rows.map((row) => String(row._id))).toEqual([String(a._id), String(b._id)]);
  });

  it('no valid id: no write at all', async () => {
    const { updateMany, find } = stubModel([]);
    expect(
      await atmMailTicketRepository.decidePending(['not-an-id'], decision, {
        by: scope.userId,
        scope,
      }),
    ).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('atmMailTicketService.reject', () => {
  const ctx = {
    userId: String(new Types.ObjectId()),
    sessionId: 's',
    branchId: String(branchId),
    departmentId: null,
    sectionId: null,
    locale: 'ar',
    permissions: { 'atmMailTicket.decide': 'branch' },
    permissionVersion: 1,
    isPrivileged: false,
    identity: {
      displayName: { ar: 'م. أحمد', en: 'Ahmed' },
      jobTitle: null,
      avatarFileId: null,
    },
  } as unknown as AuthContext;

  beforeEach(() => {
    recordMany.mockClear();
    record.mockClear();
  });

  it('decides the selection in one call, stamped with the decider, and audits each rejected ticket in one batch', async () => {
    const [a, b] = [ticket(), ticket()];
    const decide = vi.spyOn(atmMailTicketRepository, 'decidePending').mockResolvedValue([a, b]);
    const ids = [String(a._id), String(b._id), String(new Types.ObjectId())];

    const answer = await atmMailTicketService.reject({ ids }, ctx);

    expect(answer).toEqual([a, b]);
    expect(decide).toHaveBeenCalledTimes(1);
    const [passedIds, decision, meta] = decide.mock.calls[0] ?? [];
    expect(passedIds).toEqual(ids);
    expect(decision).toMatchObject({
      status: 'rejected',
      actionById: new Types.ObjectId(ctx.userId),
      actionByName: 'م. أحمد',
    });
    expect(decision?.actionAt).toBeInstanceOf(Date);
    expect(meta).toMatchObject({ by: ctx.userId, scope: { scope: 'branch' } });

    expect(record).not.toHaveBeenCalled();
    expect(recordMany).toHaveBeenCalledTimes(1);
    expect(recordMany.mock.calls[0]?.[0]).toEqual(
      [a, b].map((row) => ({
        entityRef: { moduleId: 'atm', entityType: 'mailTicket', entityId: String(row._id) },
        action: 'reject',
        changes: [],
      })),
    );
  });

  it('nothing decided — every ticket already decided or out of reach: an empty answer and no trail', async () => {
    vi.spyOn(atmMailTicketRepository, 'decidePending').mockResolvedValue([]);
    expect(await atmMailTicketService.reject({ ids: [String(new Types.ObjectId())] }, ctx)).toEqual(
      [],
    );
    expect(recordMany).toHaveBeenCalledWith([]);
  });
});
