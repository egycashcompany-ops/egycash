// The presence service against stubbed collections: the exact upsert one heartbeat performs, and
// how the page's two reads are joined — who is asked about, with which scope, and what a past day
// leaves out. The rules themselves are pinned in `presence.logic.spec.ts`; this file pins the
// wiring around them.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ScopeSelector } from '../../shared/types';

const chain = <T>(result: T) => {
  const query = {
    select: vi.fn(() => query),
    lean: vi.fn(() => query),
    exec: vi.fn(async () => result),
  };
  return query;
};

const activityModel = vi.hoisted(() => ({ updateOne: vi.fn(), find: vi.fn() }));
const sessionModel = vi.hoisted(() => ({ find: vi.fn() }));
const users = vi.hoisted(() => ({ staffAmong: vi.fn() }));
const branches = vi.hoisted(() => ({ findByIdsSystem: vi.fn() }));
const directory = vi.hoisted(() => ({ getDirectoryEmployees: vi.fn() }));

vi.mock('./presence.model', () => ({ UserActivityDayModel: activityModel }));
vi.mock('../auth/session.model', () => ({ SessionModel: sessionModel }));
vi.mock('../auth/auth.service', () => ({ authService: { idleMinutes: () => 10 } }));
vi.mock('../users/user.repository', () => ({ userRepository: users }));
vi.mock('../organization/branches/branch.repository', () => ({ branchRepository: branches }));
vi.mock('../directory', () => directory);

const { heartbeatUpsert, presenceService } = await import('./presence.service');

const USER = new Types.ObjectId().toHexString();
const OTHER = new Types.ObjectId().toHexString();
const BRANCH = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();

beforeEach(() => {
  vi.clearAllMocks();
  activityModel.updateOne.mockReturnValue(chain({ acknowledged: true }));
});

describe('the heartbeat upsert', () => {
  // 10:30 in Cairo on 2026-11-03 (winter time, UTC+2).
  const now = new Date('2026-11-03T08:30:15Z');

  it('marks the Cairo minute in a set and keeps the first and last heartbeat', () => {
    const { filter, update } = heartbeatUpsert(USER, now);
    expect(filter.userId.toHexString()).toBe(USER);
    expect(filter.day).toBe('2026-11-03');
    expect(update).toEqual({
      $addToSet: { minutes: 630 },
      $min: { firstAt: now },
      $max: { lastAt: now },
      // The end of Cairo's 3rd November (00:00 on the 4th) plus 90 days: 2 February, 00:00 Cairo.
      $setOnInsert: { expiresAt: new Date('2027-02-01T22:00:00Z') },
    });
  });

  it('files a heartbeat just after Cairo midnight under the NEW Cairo day, at minute 0', () => {
    // 22:00Z on the 3rd is already 00:00 on the 4th in Cairo; the UTC date would say the 3rd.
    const { filter, update } = heartbeatUpsert(USER, new Date('2026-11-03T22:00:30Z'));
    expect(filter.day).toBe('2026-11-04');
    expect(update.$addToSet.minutes).toBe(0);
  });

  it('is ONE upsert, with no defaults to collide with the $addToSet', async () => {
    await presenceService.recordHeartbeat(USER, now);
    expect(activityModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = activityModel.updateOne.mock.calls[0] as unknown[];
    expect(filter).toEqual(heartbeatUpsert(USER, now).filter);
    expect(update).toEqual(heartbeatUpsert(USER, now).update);
    expect(options).toEqual({ upsert: true, setDefaultsOnInsert: false });
  });

  it('applies the same update once more when two first heartbeats raced to insert the row', async () => {
    const raced = chain(null);
    raced.exec.mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));
    activityModel.updateOne.mockReturnValueOnce(raced);
    await presenceService.recordHeartbeat(USER, now);
    expect(activityModel.updateOne).toHaveBeenCalledTimes(2);
    const [filter, update, options] = activityModel.updateOne.mock.calls[1] as unknown[];
    expect(filter).toEqual(heartbeatUpsert(USER, now).filter);
    expect(update).toEqual(heartbeatUpsert(USER, now).update);
    expect(options).toBeUndefined();
  });

  it('lets any other failure through', async () => {
    const failing = chain(null);
    failing.exec.mockRejectedValueOnce(new Error('down'));
    activityModel.updateOne.mockReturnValueOnce(failing);
    await expect(presenceService.recordHeartbeat(USER, now)).rejects.toThrow('down');
    expect(activityModel.updateOne).toHaveBeenCalledTimes(1);
  });
});

describe('listActiveUsers — the join', () => {
  const now = new Date('2026-11-03T08:30:00Z');
  const scope: ScopeSelector = {
    scope: 'branch',
    userId: USER,
    branchId: String(BRANCH),
    departmentId: null,
    sectionId: null,
  };

  const staffDoc = {
    _id: new Types.ObjectId(USER),
    email: 'ahmed@ecms.local',
    username: 'ahmed',
    employeeId: EMPLOYEE,
    externalSubject: null,
    profile: { firstName: { ar: 'أحمد', en: 'Ahmed' }, lastName: { ar: 'سمير', en: 'Samir' } },
    organization: { branchId: BRANCH, departmentId: null, sectionId: null, jobTitleId: null },
  };

  beforeEach(() => {
    sessionModel.find.mockReturnValue(
      chain([
        {
          userId: new Types.ObjectId(USER),
          device: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0 Safari/537.36' },
          createdAt: new Date('2026-11-03T06:00:00Z'),
          lastUsedAt: new Date('2026-11-03T08:25:00Z'),
        },
      ]),
    );
    activityModel.find.mockReturnValue(
      chain([
        {
          userId: new Types.ObjectId(OTHER),
          minutes: [480, 481],
          firstAt: new Date('2026-11-03T06:00:00Z'),
          lastAt: new Date('2026-11-03T06:01:00Z'),
        },
      ]),
    );
    users.staffAmong.mockResolvedValue([staffDoc]);
    branches.findByIdsSystem.mockResolvedValue([
      { _id: BRANCH, name: { ar: 'الرئيسي', en: 'HQ' } },
    ]);
    directory.getDirectoryEmployees.mockResolvedValue(
      new Map([[String(EMPLOYEE), { employeeId: String(EMPLOYEE), code: 'EMP-7' }]]),
    );
  });

  it('asks about everyone with a live session OR a day of activity, through the caller’s scope', async () => {
    const result = await presenceService.listActiveUsers({}, scope, 'en', now);
    const [ids, passedScope, branchId] = users.staffAmong.mock.calls[0] as [
      string[],
      ScopeSelector,
      string | undefined,
    ];
    expect([...ids].sort()).toEqual([USER, OTHER].sort());
    expect(passedScope).toBe(scope);
    expect(branchId).toBeUndefined();

    // OTHER was not returned by the scoped read, so OTHER is not on the page.
    expect(result.rows.map((row) => row.userId)).toEqual([USER]);
    const [row] = result.rows;
    expect(row?.status).toBe('idle');
    expect(row?.employeeCode).toBe('EMP-7');
    expect(row?.branch).toEqual({ ar: 'الرئيسي', en: 'HQ' });
    expect(row?.signedInAt).toBe('2026-11-03T06:00:00.000Z');
    expect(row?.devices).toHaveLength(1);
    expect(result).toMatchObject({
      day: '2026-11-03',
      today: true,
      generatedAt: now.toISOString(),
      idleMinutes: 10,
      totals: { active: 0, idle: 1, offline: 0, activeMinutes: 0 },
    });
  });

  it('reads sessions renewed inside the idle window only, and never their address', async () => {
    await presenceService.listActiveUsers({}, scope, 'en', now);
    const [filter] = sessionModel.find.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toEqual({
      revokedAt: null,
      expiresAt: { $gt: now },
      lastUsedAt: { $gte: new Date(now.getTime() - 10 * 60_000) },
    });
    const query = sessionModel.find.mock.results[0]?.value as ReturnType<typeof chain>;
    const [selected] = query.select.mock.calls[0] as unknown as [string];
    expect(selected).not.toContain('ip');
  });

  it('passes the branch filter to the scoped read', async () => {
    const branchId = String(BRANCH);
    await presenceService.listActiveUsers({ branchId }, scope, 'en', now);
    expect(users.staffAmong.mock.calls[0]?.[2]).toBe(branchId);
  });

  it('a past day reads no sessions at all, and shows everyone offline', async () => {
    users.staffAmong.mockResolvedValue([{ ...staffDoc, _id: new Types.ObjectId(OTHER) }]);
    const result = await presenceService.listActiveUsers({ day: '2026-11-01' }, scope, 'en', now);
    expect(sessionModel.find).not.toHaveBeenCalled();
    expect(activityModel.find.mock.calls[0]?.[0]).toEqual({ day: '2026-11-01' });
    expect(result.today).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      userId: OTHER,
      status: 'offline',
      activeMinutes: 2,
      devices: [],
      signedInAt: null,
    });
  });

  it('refuses a day that has the shape of a date and is not one', async () => {
    await expect(
      presenceService.listActiveUsers({ day: '2026-02-30' }, scope, 'en', now),
    ).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('nobody on the system: no lookups for names', async () => {
    sessionModel.find.mockReturnValue(chain([]));
    activityModel.find.mockReturnValue(chain([]));
    users.staffAmong.mockResolvedValue([]);
    const result = await presenceService.listActiveUsers({}, scope, 'en', now);
    expect(result.rows).toEqual([]);
    expect(directory.getDirectoryEmployees).not.toHaveBeenCalled();
    expect(branches.findByIdsSystem).not.toHaveBeenCalled();
  });
});
