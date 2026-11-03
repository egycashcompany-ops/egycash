// «المستخدمون النشطون» — what the page shows for each person, rendered against a seeded answer.
//
// «وتقولى مين فاتح دلوقتى وشغال .. ووقت كل واحد على السيستم». The figures are the server's; what
// is pinned here is that each one reaches the screen, said the way the page says it.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ActiveUserRowDto,
  type ActiveUsersDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { ActiveUsersPage } from './pages/ActiveUsersPage';

const NOW = '2026-11-03T10:00:00.000Z'; // 12:00 in Cairo

// Fixed before anything renders: the describes below render while the file is collected.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(NOW));
afterAll(() => vi.useRealTimers());

const row = (over: Partial<ActiveUserRowDto>): ActiveUserRowDto => ({
  userId: 'u1',
  name: { firstName: { ar: 'أحمد', en: 'Ahmed' }, lastName: { ar: 'محمود', en: 'Mahmoud' } },
  email: 'ahmed@example.test',
  username: null,
  employeeId: 'e1',
  employeeCode: '0100201',
  branch: { ar: 'الفرع الرئيسي', en: 'Head Office' },
  status: 'active',
  signedInAt: '2026-11-03T06:40:00.000Z', // 08:40 Cairo — 3h 20m before NOW
  activeMinutes: 185,
  firstActivityAt: '2026-11-03T06:41:00.000Z',
  lastActivityAt: '2026-11-03T09:59:00.000Z',
  devices: [
    {
      browser: 'Chrome',
      os: 'Windows',
      mobile: false,
      signedInAt: '2026-11-03T06:40:00.000Z',
      lastUsedAt: '2026-11-03T09:58:00.000Z',
    },
  ],
  ...over,
});

const ANSWER: ActiveUsersDto = {
  day: '2026-11-03',
  today: true,
  generatedAt: NOW,
  idleMinutes: 10,
  rows: [
    row({}),
    row({
      userId: 'u2',
      name: { firstName: { ar: 'منى', en: '' }, lastName: { ar: 'سعيد', en: '' } },
      employeeCode: '0200015',
      status: 'idle',
      activeMinutes: 42,
      devices: [
        {
          browser: 'Safari',
          os: 'iOS',
          mobile: true,
          signedInAt: '2026-11-03T09:00:00.000Z',
          lastUsedAt: '2026-11-03T09:50:00.000Z',
        },
      ],
    }),
    row({
      userId: 'u3',
      status: 'offline',
      signedInAt: null,
      devices: [],
      activeMinutes: 7,
    }),
  ],
  totals: { active: 1, idle: 1, offline: 1, activeMinutes: 234 },
};

const me = { id: 'admin', permissions: { 'activeUser.view': 'organization' } } as unknown as MeDto;

const render = ({
  locale = 'ar' as Locale,
  answer = ANSWER,
  search = '',
  query = {},
}: {
  locale?: Locale;
  answer?: ActiveUsersDto;
  search?: string;
  query?: Record<string, string>;
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me, status: 'signedIn' as const },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(['platform', 'presence', 'active-users', query], answer);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/system/active-users${search}`]}>
          <ActiveUsersPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('who is on now', () => {
  const html = render();

  // On the BADGE in the row — the status filter's options carry the same words, so a match
  // anywhere on the page would prove nothing.
  it('says each person’s status in words, on a coloured badge in the row', () => {
    const dot = {
      active: 'bg-emerald-500',
      idle: 'bg-amber-500',
      offline: 'bg-slate-400',
    } as const;
    for (const status of ['active', 'idle', 'offline'] as const) {
      const label = translate('ar', `systemAdmin.activeUsers.status.${status}`);
      expect(html, status).toMatch(new RegExp(`${dot[status]}[^"]*"></span>${label}`));
    }
  });

  it('says when each person signed in, in Cairo time, and for how long', () => {
    expect(html).toContain('8:40');
    expect(html).toContain(
      translate('ar', 'systemAdmin.activeUsers.signedInFor', {
        duration: translate('ar', 'systemAdmin.activeUsers.duration.hoursMinutes', { h: 3, m: 20 }),
      }),
    );
  });

  it('says how long each person worked, as hours and minutes or minutes alone', () => {
    expect(html).toContain(
      translate('ar', 'systemAdmin.activeUsers.duration.hoursMinutes', { h: 3, m: 5 }),
    );
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.duration.minutes', { m: 42 }));
  });

  it('names each device by browser and system, and a phone as one — never by address', () => {
    expect(html).toContain('Chrome · Windows');
    expect(html).toContain(`Safari · iOS · ${translate('ar', 'systemAdmin.activeUsers.mobile')}`);
    expect(html).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('counts who is working and who is idle, and the day’s total time', () => {
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.totals.active'));
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.totals.idle'));
    expect(html).toContain(
      translate('ar', 'systemAdmin.activeUsers.duration.hoursMinutes', { h: 3, m: 54 }),
    );
  });

  it('shows the code and the branch under each name, and an Arabic-only name on an English page', () => {
    expect(html).toContain('0100201 · الفرع الرئيسي');
    expect(render({ locale: 'en' })).toContain('منى سعيد');
  });
});

describe('another day', () => {
  const past: ActiveUsersDto = {
    ...ANSWER,
    day: '2026-11-01',
    today: false,
    rows: ANSWER.rows.map((r) => ({ ...r, status: 'offline', signedInAt: null, devices: [] })),
    totals: { active: 0, idle: 0, offline: 3, activeMinutes: 234 },
  };
  const html = render({ answer: past, search: '?day=2026-11-01', query: { day: '2026-11-01' } });

  it('shows the day’s average beside its total, and no «now» tiles', () => {
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.totals.average'));
    // 234 minutes over 3 people.
    expect(html).toContain(
      translate('ar', 'systemAdmin.activeUsers.duration.hoursMinutes', { h: 1, m: 18 }),
    );
    expect(html).not.toContain(translate('ar', 'systemAdmin.activeUsers.totals.active'));
  });

  // A status remembered from today must not empty a past day's table: it is not asked for.
  it('does not ask a past day for a status', () => {
    const remembered = render({
      answer: past,
      search: '?day=2026-11-01&status=active',
      query: { day: '2026-11-01' },
    });
    expect(remembered).toContain('منى');
  });

  it('shows the day’s working time, and no «now»: no status, no sign-in, no devices', () => {
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.columns.worked'));
    expect(html).not.toContain(translate('ar', 'systemAdmin.activeUsers.columns.status'));
    expect(html).not.toContain(translate('ar', 'systemAdmin.activeUsers.columns.devices'));
    expect(html).not.toContain(translate('ar', 'systemAdmin.activeUsers.status.offline'));
  });
});

describe('the filters live in the address', () => {
  it('asks for the status the URL names', () => {
    const html = render({
      search: '?status=idle',
      query: { status: 'idle' },
      answer: { ...ANSWER, rows: ANSWER.rows.filter((r) => r.status === 'idle') },
    });
    expect(html).toContain('منى');
    expect(html).not.toContain('0100201 · ');
  });

  it('never asks for a day after today', () => {
    // A future day in the URL falls back to today — the default query, which has no day: the rows
    // seeded under it are the ones on screen.
    expect(render({ search: '?day=2027-01-01' })).toContain('0100201 · الفرع الرئيسي');
  });

  it('says nobody matches the filters, not that nobody used the system', () => {
    const html = render({
      search: '?q=zzz',
      query: { search: 'zzz' },
      answer: { ...ANSWER, rows: [] },
    });
    expect(html).toContain(translate('ar', 'systemAdmin.activeUsers.noMatches'));
    expect(html).not.toContain(translate('ar', 'systemAdmin.activeUsers.emptyToday'));
  });
});

describe('the server’s clock, not this computer’s', () => {
  it('measures «منذ» from the answer’s own time, however wrong the PC clock is', () => {
    vi.setSystemTime(new Date('2026-11-03T11:00:00.000Z')); // an hour fast
    const html = render();
    vi.setSystemTime(new Date(NOW));
    expect(html).toContain(
      translate('ar', 'systemAdmin.activeUsers.signedInFor', {
        duration: translate('ar', 'systemAdmin.activeUsers.duration.hoursMinutes', { h: 3, m: 20 }),
      }),
    );
  });
});
