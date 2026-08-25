// What the service decides ON TOP of storing a row, with the storage mocked away.
//
// Two of those decisions are worth pinning, because both were wrong on the first pass and neither
// is visible from reading the happy path:
//
//   • SWITCHING A RULE OFF MUST ALWAYS WORK. Validation exists to stop a rule that would never
//     fire from being installed. Applied to every write, it does the opposite: a rule that became
//     invalid AFTER it was saved — an event renamed, a permission retired — can no longer be
//     disabled, and disabling it is exactly what somebody is trying to do at that moment.
//
//   • THE MERGED RULE IS VALIDATED, NOT THE PATCH. Changing the event and leaving the old filters
//     behind is the ordinary way to produce a rule that can never match, and a check that only
//     looks at what changed waves it straight through.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { type NotificationRuleDoc } from './notification-rule.model';

const repo = {
  create: vi.fn(),
  findById: vi.fn(),
  updateAtVersion: vi.fn(),
  softDelete: vi.fn(),
  list: vi.fn(),
};

vi.mock('./notification-rule.repository', () => ({ notificationRuleRepository: repo }));
vi.mock('../../../platform/audit', () => ({ auditService: { record: vi.fn() } }));
// The audience count is a courtesy on the check path and irrelevant to every case below; leaving
// it real would drag a database in for a number nothing here asserts.
vi.mock('./rule-bridge', () => ({ resolveUserIds: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../platform/rbac', () => ({
  rbacService: {
    listPermissions: vi
      .fn()
      .mockResolvedValue([{ key: 'employee.view', name: { ar: '', en: '' }, moduleId: 'hr' }]),
  },
}));

const { notificationRuleService } = await import('./notification-rule.service');

/** A rule that validates: a real event, a real field, a real subject path. */
const VALID = {
  name: 'leave decided',
  event: 'hr.leave.decided',
  filters: [{ field: 'decision', op: 'eq' as const, value: 'approved' }],
  audience: { kind: 'subject' as const, path: 'employeeId', includeManager: false },
  title: { ar: 'ت', en: 't' },
  body: { ar: 'ن', en: 'b' },
  enabled: true,
};

const stored = (over: Partial<NotificationRuleDoc> = {}): NotificationRuleDoc =>
  ({
    _id: new Types.ObjectId(),
    ...VALID,
    firedCount: 0,
    lastFiredAt: null,
    createdBy: new Types.ObjectId(),
    createdAt: new Date(),
    isDeleted: false,
    __v: 3,
    ...over,
  }) as NotificationRuleDoc;

beforeEach(() => {
  vi.clearAllMocks();
  repo.create.mockImplementation((input: NotificationRuleDoc) => Promise.resolve(stored(input)));
  repo.updateAtVersion.mockImplementation((_id, _v, patch: { $set?: Partial<NotificationRuleDoc> }) =>
    Promise.resolve(stored(patch.$set ?? {})),
  );
});

const actor = new Types.ObjectId().toHexString();

/** The per-field reasons a refusal carries — the summary message is the same for every one. */
const refusalDetails = async (promise: Promise<unknown>): Promise<string[]> => {
  try {
    await promise;
  } catch (error) {
    return ((error as { details?: { field?: string; message: string }[] }).details ?? []).map(
      (detail) => `${detail.field ?? ''}: ${detail.message}`,
    );
  }
  throw new Error('expected the rule to be refused, but it was accepted');
};

describe('a rule that could never fire', () => {
  it('is refused on create while it is enabled', async () => {
    await expect(
      notificationRuleService.create({ ...VALID, event: 'hr.leave.nonsense' }, actor),
    ).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('is SAVEABLE as a disabled draft — the same latitude automation gives a workflow', async () => {
    await notificationRuleService.create(
      { ...VALID, event: 'hr.leave.nonsense', enabled: false },
      actor,
    );
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe('switching a rule off', () => {
  it('works even when the stored rule can no longer be validated', async () => {
    // The case that matters: the rule was fine when it was written and is not any more. Refusing
    // this write would leave somebody with a rule they cannot stop.
    repo.findById.mockResolvedValue(stored({ event: 'hr.leave.retired' }));
    await notificationRuleService.update('x', { enabled: false, version: 3 });
    expect(repo.updateAtVersion).toHaveBeenCalledWith('x', 3, { $set: { enabled: false } });
  });

  it('but switching it back ON is checked', async () => {
    repo.findById.mockResolvedValue(stored({ event: 'hr.leave.retired', enabled: false }));
    await expect(notificationRuleService.update('x', { enabled: true, version: 3 })).rejects.toThrow();
    expect(repo.updateAtVersion).not.toHaveBeenCalled();
  });
});

describe('editing an enabled rule', () => {
  it('carries the untouched FILTERS into the check when the event changes', async () => {
    // The filter is untouched and was valid for the OLD event. Against the new one it names a
    // field that is never sent — so the rule would fire on nothing.
    //
    // The audience here is `everyone`, which nothing about the event can invalidate: without that
    // this case would pass on the audience's error instead, and would keep passing if the filters
    // stopped being carried at all.
    repo.findById.mockResolvedValue(
      stored({
        filters: [{ field: 'decision', op: 'eq', value: 'approved' }],
        audience: { kind: 'everyone' },
      }),
    );
    const details = await refusalDetails(
      notificationRuleService.update('x', { event: 'hr.contract.expired', version: 3 }),
    );
    expect(details).toEqual([
      expect.stringContaining("filters[0].field: 'decision' is not a field of hr.contract.expired"),
    ]);
    expect(repo.updateAtVersion).not.toHaveBeenCalled();
  });

  it('carries the untouched AUDIENCE into the check when the event changes', async () => {
    // The mirror of the case above, isolated the same way: no filters at all, so the only thing
    // that can fail is the subject path the stored rule still carries.
    repo.findById.mockResolvedValue(
      stored({
        filters: [],
        audience: { kind: 'subject', path: 'employeeId', includeManager: false },
      }),
    );
    const details = await refusalDetails(
      notificationRuleService.update('x', { event: 'hr.contract.expired', version: 3 }),
    );
    expect(details).toEqual([
      expect.stringContaining("audience.path: 'employeeId' is not a field of hr.contract.expired"),
    ]);
    expect(repo.updateAtVersion).not.toHaveBeenCalled();
  });

  it('allows the same edit when the filters move with it', async () => {
    repo.findById.mockResolvedValue(stored());
    await notificationRuleService.update('x', {
      event: 'hr.contract.expired',
      filters: [{ field: 'code', op: 'eq', value: 'C-1' }],
      audience: { kind: 'everyone' },
      version: 3,
    });
    expect(repo.updateAtVersion).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an edit it never saw', async () => {
    repo.findById.mockResolvedValue(stored());
    repo.updateAtVersion.mockResolvedValue(null); // the version moved underneath the caller
    await expect(notificationRuleService.update('x', { enabled: false, version: 1 })).rejects.toThrow(
      /modified by someone else/i,
    );
  });

  it('sends no empty $set for a patch that changes nothing', async () => {
    // Mongo refuses an empty `$set`. A version-only request is a legitimate no-op write, not a
    // 500 about a document nobody touched.
    repo.findById.mockResolvedValue(stored());
    await notificationRuleService.update('x', { version: 3 });
    expect(repo.updateAtVersion).toHaveBeenCalledWith('x', 3, {});
  });
});
