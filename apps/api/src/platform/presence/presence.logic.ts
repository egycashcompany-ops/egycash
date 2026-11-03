// The arithmetic of the active users page — every rule, and nothing that reads a database.
//
// Kept pure on purpose: what counts as "working now", which minute of the day a heartbeat lands
// in, how a browser is named and how the rows are ordered are each a rule somebody will one day
// ask about, and each is answered here with a test beside it rather than inside a query.
import {
  PRESENCE_ACTIVE_SECONDS,
  PRESENCE_RETENTION_DAYS,
  addDaysYmd,
  cairoDayStart,
  cairoYmd,
  type ActiveUserRowDto,
  type ActiveUsersDto,
  type ListActiveUsersQuery,
  type LocalizedString,
  type PresenceDeviceDto,
  type PresenceStatus,
} from '@ecms/contracts';

export const MINUTES_PER_DAY = 1440;

/**
 * The minute of the Cairo day an instant falls in, 0‥1439.
 *
 * Counted from the instant the Cairo day began, not read off the wall clock, so the answer is a
 * position in the day rather than a time of day. Clamped because a DST change day is 23 or 25
 * hours long: the autumn day's last hour would otherwise count past 1439, and a set of minutes
 * whose size can exceed the minutes in a day would be a number nobody can explain.
 */
export const minuteOfCairoDay = (now: Date): number => {
  const elapsed = Math.floor((now.getTime() - cairoDayStart(cairoYmd(now)).getTime()) / 60_000);
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, elapsed));
};

/** When a day's minutes expire: the end of that Cairo day, plus the retention, in calendar days. */
export const activityExpiresAt = (day: string): Date =>
  cairoDayStart(addDaysYmd(day, 1 + PRESENCE_RETENTION_DAYS));

/**
 * How recently a session must have been renewed to count as OPEN, in minutes.
 *
 * The idle window when the server enforces one: a session older than that is closed at its next
 * renewal anyway, so it is somebody who walked away. With idle sign-out switched off (`0`) the
 * browser does not renew ahead of time: it renews only when a request finds the access token
 * expired. So the token's life alone would drop a person who is working to «offline» for the
 * minute between the token expiring and their next request — the window is the token's life plus
 * that gap (the active span, twice: the heartbeat that makes the request comes within it).
 */
export const liveWindowMinutes = (idleMinutes: number, accessTtlSeconds: number): number =>
  idleMinutes > 0
    ? idleMinutes
    : Math.max(1, Math.ceil(accessTtlSeconds / 60)) + Math.ceil((2 * PRESENCE_ACTIVE_SECONDS) / 60);

// ── The user agent, as a reader names it ──────────────────────────────────────────────────────

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  mobile: boolean;
}

/**
 * First match wins, so the ORDER is the rule. Every Chromium browser also says `Chrome/`, so Edge,
 * Opera and Samsung's go before Chrome; Chrome, Firefox and Edge on an iPhone also say `Safari/`,
 * so Safari goes last.
 */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOPiOS\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, 'Chrome'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bSafari\//, 'Safari'],
];

/** An iPhone says `like Mac OS X` and an Android phone says `Linux`, so each precedes the other. */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\bWindows\b/, 'Windows'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
];

const MOBILE = /\bMobi|\b(?:iPhone|iPad|iPod|Android)\b/;

/**
 * A browser and an operating system a person recognises, from a user agent string.
 *
 * Deliberately small: the page needs «Chrome on Windows» beside a session, not a device database.
 * Anything it does not recognise is null — a blank is honest, a guess is not. The raw string never
 * leaves the server.
 */
export const parseUserAgent = (userAgent: string | null): ParsedUserAgent => {
  if (userAgent === null || userAgent.trim() === '') {
    return { browser: null, os: null, mobile: false };
  }
  const first = (table: readonly (readonly [RegExp, string])[]): string | null =>
    table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  return { browser: first(BROWSERS), os: first(SYSTEMS), mobile: MOBILE.test(userAgent) };
};

// ── Status ───────────────────────────────────────────────────────────────────────────────────

/**
 * Signed in with a live session: `active` when the last heartbeat is at most
 * `PRESENCE_ACTIVE_SECONDS` old, `idle` otherwise. No live session — signed out, or the session
 * ended — is `offline` at once, however recent the last heartbeat. Only today has a "now": any
 * other day reads `offline` for everyone, whatever they did on it.
 */
export const presenceStatusOf = (input: {
  today: boolean;
  lastActivityAt: Date | null;
  live: boolean;
  now: Date;
}): PresenceStatus => {
  if (!input.today || !input.live) return 'offline';
  if (
    input.lastActivityAt !== null &&
    input.now.getTime() - input.lastActivityAt.getTime() <= PRESENCE_ACTIVE_SECONDS * 1000
  ) {
    return 'active';
  }
  return 'idle';
};

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────

/** A staff account as the page names it — already resolved, so building a row reads nothing. */
export interface PresenceUser {
  userId: string;
  firstName: LocalizedString;
  lastName: LocalizedString;
  email: string | null;
  username: string | null;
  employeeId: string | null;
  employeeCode: string | null;
  branch: LocalizedString | null;
}

/** A session open inside the window. No address: nothing on this page may carry one. */
export interface PresenceSession {
  userId: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface PresenceActivity {
  userId: string;
  /** The day's minutes with activity — counted by the store, which keeps them as a set. */
  activeMinutes: number;
  firstAt: Date;
  lastAt: Date;
}

const toDevice = (session: PresenceSession): PresenceDeviceDto => ({
  ...parseUserAgent(session.userAgent),
  signedInAt: session.createdAt.toISOString(),
  lastUsedAt: session.lastUsedAt.toISOString(),
});

/** One person's row for the day shown. `sessions` are their LIVE sessions now — ignored on other days. */
export const buildActiveUserRow = (input: {
  user: PresenceUser;
  activity: PresenceActivity | null;
  sessions: readonly PresenceSession[];
  today: boolean;
  now: Date;
}): ActiveUserRowDto => {
  const { user, activity } = input;
  const live = input.today ? input.sessions : [];
  const devices = [...live]
    .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    .map(toDevice);
  const signedInAt =
    live.length === 0
      ? null
      : new Date(Math.min(...live.map((session) => session.createdAt.getTime()))).toISOString();
  return {
    userId: user.userId,
    name: { firstName: user.firstName, lastName: user.lastName },
    email: user.email,
    username: user.username,
    employeeId: user.employeeId,
    employeeCode: user.employeeCode,
    branch: user.branch,
    status: presenceStatusOf({
      today: input.today,
      lastActivityAt: activity?.lastAt ?? null,
      live: live.length > 0,
      now: input.now,
    }),
    signedInAt,
    // A set by construction; counted as one anyway, so a duplicate could never inflate the time.
    activeMinutes: activity === null ? 0 : activity.activeMinutes,
    firstActivityAt: activity?.firstAt.toISOString() ?? null,
    lastActivityAt: activity?.lastAt.toISOString() ?? null,
    devices,
  };
};

// ── Totals, filters, order ───────────────────────────────────────────────────────────────────

export const totalsOf = (rows: readonly ActiveUserRowDto[]): ActiveUsersDto['totals'] => {
  const totals = { active: 0, idle: 0, offline: 0, activeMinutes: 0 };
  for (const row of rows) {
    totals[row.status] += 1;
    totals.activeMinutes += row.activeMinutes;
  }
  return totals;
};

/**
 * Text folded for comparison: case, and the Arabic letters people type interchangeably — «أ إ آ ٱ»
 * as «ا», «ة» as «ه», «ى» as «ي», «ؤ» «ئ» as «و» «ي» — with diacritics and tatweel dropped.
 * Someone searching «احمد» finds «أحمد».
 */
export const foldForSearch = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();

/** The name in Arabic and in English (each name alone and both together), email, username, code. */
const searchableTextOf = (row: ActiveUserRowDto): string[] => {
  const { firstName, lastName } = row.name;
  return [
    `${firstName.ar} ${lastName.ar}`,
    `${firstName.en} ${lastName.en}`,
    row.email ?? '',
    row.username ?? '',
    row.employeeCode ?? '',
  ];
};

export const matchesSearch = (row: ActiveUserRowDto, search: string): boolean => {
  const needle = foldForSearch(search);
  if (needle === '') return true;
  return searchableTextOf(row).some((text) => foldForSearch(text).includes(needle));
};

const STATUS_RANK: Record<PresenceStatus, number> = { active: 0, idle: 1, offline: 2 };

const displayNameOf = (row: ActiveUserRowDto, locale: 'ar' | 'en'): string =>
  `${row.name.firstName[locale]} ${row.name.lastName[locale]}`.trim();

/** Most recent first; a row with no activity at all after every row with some. ISO strings sort as instants. */
const byLastActivityDesc = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
};

/** Working now first, then open and idle, then the rest; most recent activity first; then by name. */
export const sortActiveUserRows = (
  rows: readonly ActiveUserRowDto[],
  locale: 'ar' | 'en',
): ActiveUserRowDto[] =>
  [...rows].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      byLastActivityDesc(a.lastActivityAt, b.lastActivityAt) ||
      displayNameOf(a, locale).localeCompare(displayNameOf(b, locale), locale) ||
      a.userId.localeCompare(b.userId),
  );

/**
 * Totals over every row the caller may see, THEN the status and search filters, then the order.
 *
 * The totals are taken before the filters so the counts beside each status stay the same while
 * somebody clicks between them — a count that changed with the filter would only ever echo the
 * table under it. The branch filter is not among these: it narrows WHO is being looked at (like
 * the branch switcher does) and is applied with the scope, so the totals describe that branch.
 */
export const presentActiveUsers = (
  rows: readonly ActiveUserRowDto[],
  query: Pick<ListActiveUsersQuery, 'status' | 'search'>,
  locale: 'ar' | 'en',
): Pick<ActiveUsersDto, 'rows' | 'totals'> => {
  const totals = totalsOf(rows);
  const search = query.search ?? '';
  const shown = rows.filter(
    (row) =>
      (query.status === undefined || row.status === query.status) && matchesSearch(row, search),
  );
  return { rows: sortActiveUserRows(shown, locale), totals };
};
