// Who is on the system now, and for how long — the «المستخدمون النشطون» page.
//
// «عايز فى مديول الإدارة تضيف صفحة جديدة أسمها المستخدمين النشطين .. وتقولى مين فاتح دلوقتى
// وشغال .. ووقت كل واحد على السيستم..».
//
// Two signals, each answering one half of the question:
//   • OPEN — a live session (not revoked, not expired) renewed within the idle window. The server
//     already ends a session that sat untouched for that long, so this is "signed in and here".
//   • WORKING — a heartbeat the browser sends at most once a minute, and only while a person is
//     actually using the page (pointer, keys, scroll) and it is in front of them. Each heartbeat
//     marks one minute of the Cairo day; the minutes are a SET, so two tabs, two devices or a
//     retried request never count the same minute twice. "Time on the system" is that count.
import { z } from 'zod';
import { objectId, type LocalizedString } from '../common/index.js';

/** A heartbeat this recent means the person is working now; older, and an open session is idle. */
export const PRESENCE_ACTIVE_SECONDS = 120;

/** How long a day of activity minutes is kept before it expires. */
export const PRESENCE_RETENTION_DAYS = 90;

/**
 * `active`  — a heartbeat within `PRESENCE_ACTIVE_SECONDS`: using the system right now.
 * `idle`    — signed in with a live session inside the idle window, but no recent heartbeat:
 *             the page is open and nobody is touching it.
 * `offline` — neither: worked earlier on the day shown, or signed out since.
 */
export const PRESENCE_STATUSES = ['active', 'idle', 'offline'] as const;
export const PresenceStatusSchema = z.enum(PRESENCE_STATUSES);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

const YmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a day as YYYY-MM-DD');

/** `GET /platform/presence/active-users` — the day defaults to today in Cairo. */
export const ListActiveUsersQuerySchema = z
  .object({
    day: YmdSchema.optional(),
    status: PresenceStatusSchema.optional(),
    search: z.string().trim().max(100).optional(),
    branchId: objectId().optional(),
  })
  .strict();
export type ListActiveUsersQuery = z.infer<typeof ListActiveUsersQuerySchema>;

/** One device the person is signed in on now. */
export interface PresenceDeviceDto {
  /** «Chrome», «Edge», «Safari»… or null when the user agent says nothing recognisable. */
  browser: string | null;
  /** «Windows», «Android», «iOS», «macOS»… or null. */
  os: string | null;
  mobile: boolean;
  /** When this device signed in (the session's start). */
  signedInAt: string;
  /** When this device last renewed its session. */
  lastUsedAt: string;
}

export interface ActiveUserRowDto {
  userId: string;
  name: { firstName: LocalizedString; lastName: LocalizedString };
  email: string | null;
  username: string | null;
  /** The employee behind the login, when there is one. */
  employeeId: string | null;
  employeeCode: string | null;
  branch: LocalizedString | null;
  /** Now — meaningful for today only; any other day reads `offline` for everyone. */
  status: PresenceStatus;
  /** The earliest start among the live sessions: signed in since. Null when not signed in now. */
  signedInAt: string | null;
  /** Minutes with activity on the day shown. */
  activeMinutes: number;
  /** The first and the last minute with activity on the day shown. */
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  /** Live sessions now, one per device. Empty when not signed in now. */
  devices: PresenceDeviceDto[];
}

export interface ActiveUsersDto {
  /** The day shown, `YYYY-MM-DD` in Cairo. */
  day: string;
  /** Whether the day shown is today — only then do statuses and devices mean "now". */
  today: boolean;
  generatedAt: string;
  /** The server's idle window, in minutes: an untouched session ends after this long. */
  idleMinutes: number;
  rows: ActiveUserRowDto[];
  /** Over every row the caller may see, before the status and search filters. */
  totals: { active: number; idle: number; offline: number; activeMinutes: number };
}
