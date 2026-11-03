// Who is on the system now, and for how long (the «المستخدمون النشطون» page).
//
// Two reads, joined in memory, because each answers half the question and neither collection knows
// about the other: `sessions` says who has the system OPEN (a session renewed inside the idle
// window), `user_activity_days` says who is WORKING and for how many minutes (heartbeats). The
// population is a few thousand sessions at most, so the join is two queries and two `$in` lookups
// for the names — never one per person.
import { Types } from 'mongoose';
import {
  cairoYmd,
  isYmd,
  type ActiveUsersDto,
  type ListActiveUsersQuery,
  type LocalizedString,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { ValidationError } from '../../shared/errors';
import { type ScopeSelector } from '../../shared/types';
import { authService } from '../auth/auth.service';
import { SessionModel } from '../auth/session.model';
import { getDirectoryEmployees } from '../directory';
import { branchRepository } from '../organization/branches/branch.repository';
import { userRepository } from '../users/user.repository';
import { UserActivityDayModel } from './presence.model';
import {
  activityExpiresAt,
  buildActiveUserRow,
  liveWindowMinutes,
  minuteOfCairoDay,
  presentActiveUsers,
  type PresenceActivity,
  type PresenceSession,
  type PresenceUser,
} from './presence.logic';

/**
 * The upsert one heartbeat performs — exported so its shape is pinned by a test.
 *
 * `$addToSet` makes the minute idempotent, `$min`/`$max` keep the first and last heartbeat
 * whatever order two replicas apply them in, and the expiry is written once, with the row.
 */
export const heartbeatUpsert = (
  userId: string,
  now: Date,
): {
  filter: { userId: Types.ObjectId; day: string };
  update: {
    $addToSet: { minutes: number };
    $min: { firstAt: Date };
    $max: { lastAt: Date };
    $setOnInsert: { expiresAt: Date };
  };
} => {
  const day = cairoYmd(now);
  return {
    filter: { userId: new Types.ObjectId(userId), day },
    update: {
      $addToSet: { minutes: minuteOfCairoDay(now) },
      $min: { firstAt: now },
      $max: { lastAt: now },
      $setOnInsert: { expiresAt: activityExpiresAt(day) },
    },
  };
};

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

const oid = (id: Types.ObjectId | null | undefined): string | null =>
  id === null || id === undefined ? null : String(id);

class PresenceService {
  /**
   * Mark this minute of today as worked. One small upsert, and deliberately nothing else: not
   * audited (it would be a row per person per minute), and the session is not touched — the idle
   * sign-out keeps deciding on renewals alone, so a heartbeat can never keep a session alive.
   */
  async recordHeartbeat(userId: string, now: Date = new Date()): Promise<void> {
    const { filter, update } = heartbeatUpsert(userId, now);
    try {
      // No defaults on insert: every field the row needs is written by the update itself, and a
      // default for `minutes` would collide with the `$addToSet` that creates it.
      await UserActivityDayModel.updateOne(filter, update, {
        upsert: true,
        setDefaultsOnInsert: false,
      }).exec();
    } catch (error) {
      // A person's FIRST heartbeats of the day can race to insert the same row from two tabs; the
      // loser meets the unique index. The row exists now, so the same update simply applies to it.
      if (!isDuplicateKey(error)) throw error;
      await UserActivityDayModel.updateOne(filter, update).exec();
    }
  }

  /** The window that makes a session OPEN, in minutes — the idle window, or the token's life. */
  windowMinutes(): number {
    return liveWindowMinutes(authService.idleMinutes(), env.JWT_ACCESS_TTL_SECONDS);
  }

  async listActiveUsers(
    query: ListActiveUsersQuery,
    scope: ScopeSelector,
    locale: 'ar' | 'en',
    now: Date = new Date(),
  ): Promise<ActiveUsersDto> {
    const todayYmd = cairoYmd(now);
    const day = query.day ?? todayYmd;
    // The schema checks the SHAPE; `2026-02-30` has it and is still not a day.
    if (!isYmd(day)) {
      throw new ValidationError([
        { field: 'query.day', code: 'INVALID_DATE', message: 'day must be a real calendar date' },
      ]);
    }
    const today = day === todayYmd;
    const windowMinutes = this.windowMinutes();

    const [sessions, activity] = await Promise.all([
      today ? this.liveSessions(now, windowMinutes) : Promise.resolve([]),
      this.activityOn(day),
    ]);

    const sessionsByUser = new Map<string, PresenceSession[]>();
    for (const session of sessions) {
      const list = sessionsByUser.get(session.userId) ?? [];
      list.push(session);
      sessionsByUser.set(session.userId, list);
    }
    const activityByUser = new Map(activity.map((row) => [row.userId, row]));

    const users = await this.staffNamed(
      [...new Set([...sessionsByUser.keys(), ...activityByUser.keys()])],
      scope,
      query.branchId,
    );

    const rows = users.map((user) =>
      buildActiveUserRow({
        user,
        activity: activityByUser.get(user.userId) ?? null,
        sessions: sessionsByUser.get(user.userId) ?? [],
        today,
        now,
      }),
    );

    return {
      day,
      today,
      generatedAt: now.toISOString(),
      idleMinutes: windowMinutes,
      ...presentActiveUsers(rows, query, locale),
    };
  }

  /** Sessions open now: not revoked, not expired, renewed inside the window. Never the address. */
  private async liveSessions(now: Date, windowMinutes: number): Promise<PresenceSession[]> {
    const docs = await SessionModel.find({
      revokedAt: null,
      expiresAt: { $gt: now },
      lastUsedAt: { $gte: new Date(now.getTime() - windowMinutes * 60_000) },
    })
      .select('userId device.userAgent createdAt lastUsedAt')
      .lean<
        {
          userId: Types.ObjectId;
          device?: { userAgent?: string | null };
          createdAt: Date;
          lastUsedAt: Date;
        }[]
      >()
      .exec();
    return docs.map((doc) => ({
      userId: String(doc.userId),
      userAgent: doc.device?.userAgent ?? null,
      createdAt: doc.createdAt,
      lastUsedAt: doc.lastUsedAt,
    }));
  }

  private async activityOn(day: string): Promise<PresenceActivity[]> {
    const docs = await UserActivityDayModel.find({ day })
      .select('userId minutes firstAt lastAt')
      .lean<
        { userId: Types.ObjectId; minutes?: number[]; firstAt: Date; lastAt: Date }[]
      >()
      .exec();
    return docs.map((doc) => ({
      userId: String(doc.userId),
      minutes: doc.minutes ?? [],
      firstAt: doc.firstAt,
      lastAt: doc.lastAt,
    }));
  }

  /**
   * The candidates the caller may see, named: scope and staff-only through the users repository
   * (the same clause the users list applies), then the employee code through the directory seam
   * and the branch name from the branches — one `$in` each.
   */
  private async staffNamed(
    userIds: readonly string[],
    scope: ScopeSelector,
    branchId: string | undefined,
  ): Promise<PresenceUser[]> {
    const users = await userRepository.staffAmong(userIds, scope, branchId);
    if (users.length === 0) return [];
    const employeeIds = users.flatMap((user) => {
      const id = oid(user.employeeId);
      return id === null ? [] : [id];
    });
    const branchIds = users.flatMap((user) => {
      const id = oid(user.organization?.branchId);
      return id === null ? [] : [id];
    });
    const [employees, branches] = await Promise.all([
      getDirectoryEmployees([...new Set(employeeIds)]),
      branchRepository.findByIdsSystem(branchIds),
    ]);
    const branchNames = new Map<string, LocalizedString>(
      branches.map((branch) => [String(branch._id), branch.name]),
    );
    const blank: LocalizedString = { ar: '', en: '' };
    return users.map((user) => {
      const employeeId = oid(user.employeeId);
      const branch = oid(user.organization?.branchId);
      return {
        userId: String(user._id),
        firstName: user.profile?.firstName ?? blank,
        lastName: user.profile?.lastName ?? blank,
        email: user.email ?? null,
        username: user.username ?? null,
        employeeId,
        employeeCode: employeeId === null ? null : (employees.get(employeeId)?.code ?? null),
        branch: branch === null ? null : (branchNames.get(branch) ?? null),
      };
    });
  }
}

export const presenceService = new PresenceService();
