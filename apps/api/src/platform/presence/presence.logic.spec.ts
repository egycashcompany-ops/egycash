// The active users page's rules, one at a time and without a database: the minute a heartbeat
// lands in, how long its day is kept, what makes a session open, how a device is named, what
// "working now" means, and the order a reader sees the rows in.
import { describe, expect, it } from 'vitest';
import {
  PRESENCE_ACTIVE_SECONDS,
  PRESENCE_RETENTION_DAYS,
  type ActiveUserRowDto,
} from '@ecms/contracts';
import {
  activityExpiresAt,
  buildActiveUserRow,
  foldForSearch,
  liveWindowMinutes,
  matchesSearch,
  minuteOfCairoDay,
  parseUserAgent,
  presenceStatusOf,
  presentActiveUsers,
  sortActiveUserRows,
  totalsOf,
  type PresenceUser,
} from './presence.logic';

const at = (iso: string): Date => new Date(iso);

describe('minuteOfCairoDay — the minute of the CAIRO day, 0‥1439', () => {
  it('counts from Cairo midnight, not UTC midnight (winter, UTC+2)', () => {
    // Cairo 2026-01-15 00:00 is 2026-01-14 22:00 UTC.
    expect(minuteOfCairoDay(at('2026-01-14T22:00:00Z'))).toBe(0);
    expect(minuteOfCairoDay(at('2026-01-14T22:00:59.999Z'))).toBe(0);
    expect(minuteOfCairoDay(at('2026-01-14T22:01:00Z'))).toBe(1);
    // 10:30 in Cairo.
    expect(minuteOfCairoDay(at('2026-01-15T08:30:00Z'))).toBe(630);
  });

  it('turns over at the Cairo midnight boundary', () => {
    // The last instant of Cairo's 14th is 1439; the next millisecond is minute 0 of the 15th.
    expect(minuteOfCairoDay(at('2026-01-14T21:59:59.999Z'))).toBe(1439);
    expect(minuteOfCairoDay(at('2026-01-14T22:00:00.000Z'))).toBe(0);
  });

  it('follows summer time (UTC+3)', () => {
    // Cairo 2026-07-01 00:00 is 2026-06-30 21:00 UTC; 09:15 in Cairo is 06:15 UTC.
    expect(minuteOfCairoDay(at('2026-06-30T21:00:00Z'))).toBe(0);
    expect(minuteOfCairoDay(at('2026-07-01T06:15:00Z'))).toBe(555);
  });

  it('a 23-hour day (DST start, Fri 2026-04-24) ends at minute 1379', () => {
    expect(minuteOfCairoDay(at('2026-04-23T22:00:00Z'))).toBe(0);
    expect(minuteOfCairoDay(at('2026-04-24T20:59:59Z'))).toBe(23 * 60 - 1);
  });

  it('a 25-hour day (DST end, Thu 2026-10-29) is clamped to 1439, never past it', () => {
    // The repeated hour: 21:30Z is 23:30 the second time round, 24.5 hours into the day.
    expect(minuteOfCairoDay(at('2026-10-29T21:30:00Z'))).toBe(1439);
    expect(minuteOfCairoDay(at('2026-10-29T21:59:59Z'))).toBe(1439);
    // …and the next day starts at 0 as usual.
    expect(minuteOfCairoDay(at('2026-10-29T22:00:00Z'))).toBe(0);
  });
});

describe('activityExpiresAt — the end of the Cairo day, plus the retention', () => {
  it('keeps a day for PRESENCE_RETENTION_DAYS after it ends', () => {
    expect(PRESENCE_RETENTION_DAYS).toBe(90);
    // 2026-01-15 ends at Cairo midnight of the 16th (22:00Z on the 15th); 90 days later is
    // 2026-04-16 00:00 Cairo — still winter time, so 22:00Z on the 15th.
    expect(activityExpiresAt('2026-01-15').toISOString()).toBe('2026-04-15T22:00:00.000Z');
    // In summer the same rule lands on 21:00Z: calendar days in Cairo, never a fixed 24 hours.
    expect(activityExpiresAt('2026-06-01').toISOString()).toBe('2026-08-30T21:00:00.000Z');
  });
});

describe('liveWindowMinutes — what makes a session OPEN', () => {
  it('is the idle window when the server enforces one', () => {
    expect(liveWindowMinutes(10, 900)).toBe(10);
  });

  // Without idle sign-out the browser renews only when a request finds the token expired: the
  // window must outlast the token by the minute until the next heartbeat makes that request.
  it('is the access token life plus the gap to the next request when idle sign-out is off', () => {
    expect(liveWindowMinutes(0, 900)).toBe(19);
    expect(liveWindowMinutes(0, 61)).toBe(6);
  });
});

describe('parseUserAgent — a browser and a system a person recognises', () => {
  const cases: [string, string | null, string | null, boolean][] = [
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge',
      'Windows',
      false,
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'Windows',
      false,
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Safari',
      'macOS',
      false,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari',
      'iOS',
      true,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome',
      'iOS',
      true,
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
      'Firefox',
      'iOS',
      true,
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      'Samsung Internet',
      'Android',
      true,
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome',
      'Android',
      true,
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
      'Edge',
      'Android',
      true,
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
      'Opera',
      'Windows',
      false,
    ],
    [
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox',
      'Linux',
      false,
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome',
      'ChromeOS',
      false,
    ],
  ];

  it.each(cases)('%s', (userAgent, browser, os, mobile) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, os, mobile });
  });

  it('answers null for what it does not recognise, rather than guessing', () => {
    expect(parseUserAgent('curl/8.5.0')).toEqual({ browser: null, os: null, mobile: false });
    expect(parseUserAgent('')).toEqual({ browser: null, os: null, mobile: false });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
  });
});

describe('presenceStatusOf — working, open, or neither', () => {
  const now = at('2026-11-03T10:00:00Z');
  const secondsAgo = (s: number): Date => new Date(now.getTime() - s * 1000);

  it('is active within PRESENCE_ACTIVE_SECONDS of a heartbeat, inclusive', () => {
    expect(PRESENCE_ACTIVE_SECONDS).toBe(120);
    expect(
      presenceStatusOf({ today: true, lastActivityAt: secondsAgo(120), live: true, now }),
    ).toBe('active');
  });

  it('is idle with an open session and an older heartbeat, or none at all', () => {
    expect(
      presenceStatusOf({ today: true, lastActivityAt: secondsAgo(121), live: true, now }),
    ).toBe('idle');
    expect(presenceStatusOf({ today: true, lastActivityAt: null, live: true, now })).toBe('idle');
  });

  it('is offline with neither', () => {
    expect(
      presenceStatusOf({ today: true, lastActivityAt: secondsAgo(600), live: false, now }),
    ).toBe('offline');
  });

  // Signing out ends being «on the system» at once: a heartbeat sent a moment before does not
  // keep somebody «working now» with no session behind it.
  it('is offline the moment the session is gone, however recent the last heartbeat', () => {
    expect(presenceStatusOf({ today: true, lastActivityAt: secondsAgo(5), live: false, now })).toBe(
      'offline',
    );
  });

  it('is offline for everyone on any day but today', () => {
    expect(presenceStatusOf({ today: false, lastActivityAt: now, live: true, now })).toBe(
      'offline',
    );
  });
});

const user = (id: string, overrides: Partial<PresenceUser> = {}): PresenceUser => ({
  userId: id,
  firstName: { ar: 'أحمد', en: 'Ahmed' },
  lastName: { ar: 'سمير', en: 'Samir' },
  email: `${id}@ecms.local`,
  username: id,
  employeeId: null,
  employeeCode: null,
  branch: null,
  ...overrides,
});

describe('buildActiveUserRow', () => {
  const now = at('2026-11-03T10:00:00Z');
  const sessions = [
    {
      userId: 'u1',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      createdAt: at('2026-11-03T06:00:00Z'),
      lastUsedAt: at('2026-11-03T09:55:00Z'),
    },
    {
      userId: 'u1',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      createdAt: at('2026-11-03T07:00:00Z'),
      lastUsedAt: at('2026-11-03T09:58:00Z'),
    },
  ];
  const activity = {
    userId: 'u1',
    activeMinutes: 4,
    firstAt: at('2026-11-03T06:00:10Z'),
    lastAt: at('2026-11-03T09:59:30Z'),
  };

  it('today: status, signed-in-since, devices newest first, minutes', () => {
    const row = buildActiveUserRow({ user: user('u1'), activity, sessions, today: true, now });
    expect(row.status).toBe('active');
    expect(row.signedInAt).toBe('2026-11-03T06:00:00.000Z');
    expect(row.activeMinutes).toBe(4);
    expect(row.firstActivityAt).toBe('2026-11-03T06:00:10.000Z');
    expect(row.lastActivityAt).toBe('2026-11-03T09:59:30.000Z');
    expect(row.devices).toEqual([
      {
        browser: 'Safari',
        os: 'iOS',
        mobile: true,
        signedInAt: '2026-11-03T07:00:00.000Z',
        lastUsedAt: '2026-11-03T09:58:00.000Z',
      },
      {
        browser: 'Chrome',
        os: 'Windows',
        mobile: false,
        signedInAt: '2026-11-03T06:00:00.000Z',
        lastUsedAt: '2026-11-03T09:55:00.000Z',
      },
    ]);
  });

  it('never carries the raw user agent or an address', () => {
    const row = buildActiveUserRow({ user: user('u1'), activity, sessions, today: true, now });
    const text = JSON.stringify(row);
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain('"ip"');
    expect(text).not.toContain('userAgent');
  });

  it('a signed-in person with no heartbeat yet: idle, no minutes', () => {
    const row = buildActiveUserRow({
      user: user('u1'),
      activity: null,
      sessions,
      today: true,
      now,
    });
    expect(row.status).toBe('idle');
    expect(row.activeMinutes).toBe(0);
    expect(row.firstActivityAt).toBeNull();
    expect(row.lastActivityAt).toBeNull();
  });

  it('another day: offline, the minutes of that day, no devices, no signed-in-since', () => {
    const row = buildActiveUserRow({ user: user('u1'), activity, sessions, today: false, now });
    expect(row.status).toBe('offline');
    expect(row.activeMinutes).toBe(4);
    expect(row.devices).toEqual([]);
    expect(row.signedInAt).toBeNull();
  });

  it('takes the day’s count as the store keeps it — a set of minutes, counted there', () => {
    const row = buildActiveUserRow({
      user: user('u1'),
      activity: { ...activity, activeMinutes: 2 },
      sessions: [],
      today: true,
      now,
    });
    expect(row.activeMinutes).toBe(2);
  });
});

// ── Totals, filters, order ─────────────────────────────────────────────────

const row = (
  id: string,
  status: ActiveUserRowDto['status'],
  lastActivityAt: string | null,
  overrides: Partial<ActiveUserRowDto> = {},
): ActiveUserRowDto => ({
  userId: id,
  name: { firstName: { ar: id, en: id }, lastName: { ar: '', en: '' } },
  email: null,
  username: null,
  employeeId: null,
  employeeCode: null,
  branch: null,
  status,
  signedInAt: null,
  activeMinutes: 10,
  firstActivityAt: lastActivityAt,
  lastActivityAt,
  devices: [],
  ...overrides,
});

describe('totalsOf', () => {
  it('counts each status and sums the minutes', () => {
    expect(
      totalsOf([
        row('a', 'active', '2026-11-03T09:59:00.000Z'),
        row('b', 'active', '2026-11-03T09:58:00.000Z', { activeMinutes: 5 }),
        row('c', 'idle', null, { activeMinutes: 0 }),
        row('d', 'offline', '2026-11-03T07:00:00.000Z', { activeMinutes: 100 }),
      ]),
    ).toEqual({ active: 2, idle: 1, offline: 1, activeMinutes: 115 });
  });
});

describe('sortActiveUserRows', () => {
  it('active, then idle, then offline; most recent first; then by name', () => {
    const sorted = sortActiveUserRows(
      [
        row('offline-late', 'offline', '2026-11-03T09:00:00.000Z'),
        row('idle-none', 'idle', null),
        row('active-early', 'active', '2026-11-03T09:58:00.000Z'),
        row('idle-recent', 'idle', '2026-11-03T09:40:00.000Z'),
        row('active-late', 'active', '2026-11-03T09:59:00.000Z'),
        row('beta', 'offline', '2026-11-03T08:00:00.000Z'),
        row('alpha', 'offline', '2026-11-03T08:00:00.000Z'),
      ],
      'en',
    );
    expect(sorted.map((r) => r.userId)).toEqual([
      'active-late',
      'active-early',
      'idle-recent',
      'idle-none',
      'offline-late',
      'alpha',
      'beta',
    ]);
  });
});

describe('search', () => {
  const target = row('u1', 'active', null, {
    name: {
      firstName: { ar: 'أحمد', en: 'Ahmed' },
      lastName: { ar: 'عطية', en: 'Attia' },
    },
    email: 'ahmed.attia@ecms.local',
    username: 'a.attia',
    employeeCode: 'EMP-0042',
  });

  it('folds the Arabic letters people type interchangeably', () => {
    expect(foldForSearch('أحمد عطيّة')).toBe('احمد عطيه');
    expect(matchesSearch(target, 'احمد')).toBe(true);
    expect(matchesSearch(target, 'عطيه')).toBe(true);
    expect(matchesSearch(target, 'احمد عطية')).toBe(true);
  });

  it('matches the English name, email, username and employee code, ignoring case', () => {
    expect(matchesSearch(target, 'AHMED att')).toBe(true);
    expect(matchesSearch(target, 'ECMS.LOCAL')).toBe(true);
    expect(matchesSearch(target, 'a.attia')).toBe(true);
    expect(matchesSearch(target, 'emp-0042')).toBe(true);
    expect(matchesSearch(target, 'mohamed')).toBe(false);
  });

  it('an empty search matches everybody', () => {
    expect(matchesSearch(target, '   ')).toBe(true);
  });
});

describe('presentActiveUsers — totals before the filters, then the order', () => {
  const rows = [
    row('ahmed', 'offline', '2026-11-03T08:00:00.000Z'),
    row('mona', 'active', '2026-11-03T09:59:00.000Z'),
    row('omar', 'idle', null, { activeMinutes: 0 }),
    row('ahmad', 'active', '2026-11-03T09:58:00.000Z'),
  ];

  it('totals describe every row, whatever the status filter shows', () => {
    const shown = presentActiveUsers(rows, { status: 'active' }, 'en');
    expect(shown.rows.map((r) => r.userId)).toEqual(['mona', 'ahmad']);
    expect(shown.totals).toEqual({ active: 2, idle: 1, offline: 1, activeMinutes: 30 });
  });

  it('and whatever the search shows', () => {
    const shown = presentActiveUsers(rows, { search: 'ahm' }, 'en');
    expect(shown.rows.map((r) => r.userId)).toEqual(['ahmad', 'ahmed']);
    expect(shown.totals.active + shown.totals.idle + shown.totals.offline).toBe(4);
  });

  it('applies both filters together', () => {
    const shown = presentActiveUsers(rows, { status: 'offline', search: 'ahm' }, 'en');
    expect(shown.rows.map((r) => r.userId)).toEqual(['ahmed']);
  });

  it('no filter: everybody, in the page order', () => {
    expect(presentActiveUsers(rows, {}, 'en').rows.map((r) => r.userId)).toEqual([
      'mona',
      'ahmad',
      'omar',
      'ahmed',
    ]);
  });
});
