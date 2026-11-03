// What the welcome page says, for whom.
//
// «عايز بقى أى حساب يدخل تظهرله Welcome Page بتقوله أهلاً وتاريخ ميلادة وكام يوم باقى عليه (ولو
// اليوم عيد ميلاده يقوله كل سنة وأنت طيب).. وتظهرله الـ Recent Pages اللى كان فيها».
//
// Rendered statically against seeded queries, with the clock fixed: the count is a Cairo calendar
// day, so every case below names the day it is "today".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type MyApplicationCategoryDto,
  type MyEmployeeSummaryDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../localization/i18n';
import { NavPrefsProvider } from '../navigation/NavPrefs';
import { WelcomePage } from './WelcomePage';
import { MY_SUMMARY_KEY } from './home-api';

const USER = 'u00000000000000000000001';
const OTHER_USER = 'u00000000000000000000002';

const me = (employeeId: string | null): MeDto => ({
  id: USER,
  email: 'ahmed@example.test',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أحمد', en: 'Ahmed' }, lastName: { ar: 'محمود', en: 'Mahmoud' } },
  locale: 'ar',
  navLayout: 'rail',
  theme: 'light',
  branchId: null,
  branchIds: [],
  employeeId,
  permissions: {},
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  external: null,
});

const summary = (over: Partial<MyEmployeeSummaryDto> = {}): MyEmployeeSummaryDto => ({
  employeeId: 'e1',
  code: '0100201',
  fullNameAr: 'أحمد محمود عبد الرحمن',
  fullNameEn: 'Ahmed Mahmoud Abdelrahman',
  birthDate: '1990-03-12',
  hasPhoto: false,
  jobTitle: { ar: 'محاسب أول', en: 'Senior Accountant' },
  department: { ar: 'الإدارة المالية', en: 'Finance' },
  branch: { ar: 'الفرع الرئيسي', en: 'Head Office' },
  ...over,
});

const MENU: MyApplicationCategoryDto[] = [
  {
    id: 'fleet',
    name: { ar: 'الحركة', en: 'Fleet' },
    icon: 'truck',
    applications: [
      {
        id: 'vehicles',
        name: { ar: 'السيارات', en: 'Vehicles' },
        icon: 'truck',
        route: '/fleet/vehicles',
        personal: false,
      },
      {
        id: 'odometer',
        name: { ar: 'عدادات السيارات', en: 'Odometers' },
        icon: 'gauge',
        route: '/fleet/odometer',
        personal: false,
      },
    ],
    sections: [],
  },
];

/** A localStorage for a node test: the history lives there, keyed by account. */
const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = ({
  locale = 'ar',
  employee = summary(),
  menu = MENU,
}: {
  locale?: Locale;
  /** `null`: an account with no employee behind it. */
  employee?: MyEmployeeSummaryDto | null;
  menu?: MyApplicationCategoryDto[];
} = {}): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(employee === null ? null : employee.employeeId), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(['me', 'applications'], menu);
  if (employee !== null) qc.setQueryData(MY_SUMMARY_KEY, employee);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NavPrefsProvider>
            <WelcomePage />
          </NavPrefsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the greeting — every account', () => {
  it('greets an employee by the first name on file, with where they sit and today’s date', () => {
    const html = render();
    expect(html).toContain(translate('ar', 'home.greeting', { name: 'أحمد' }));
    expect(html).toContain('محاسب أول · الإدارة المالية · الفرع الرئيسي');
    expect(html).toContain('الثلاثاء، 3 نوفمبر 2026');
  });

  it('greets in English by the English name when there is one', () => {
    expect(render({ locale: 'en' })).toContain(translate('en', 'home.greeting', { name: 'Ahmed' }));
  });

  it('greets an account with no employee behind it by its own name, and shows no birthday', () => {
    const html = render({ employee: null });
    expect(html).toContain(translate('ar', 'home.greeting', { name: 'أحمد' }));
    expect(html).not.toContain('data-birthday');
  });

  it('shows the initial while there is no photo', () => {
    expect(render()).toMatch(/<span aria-hidden="true">أ<\/span>/);
  });
});

describe('the birthday — the person’s own, and only theirs', () => {
  it('counts the days to the next birthday, with the date of birth and the day it falls on', () => {
    const html = render();
    expect(html).toContain('data-birthday="countdown"');
    expect(html).toContain('>129<');
    // «129 يومًا»: a count ending in 11–99 takes the accusative singular.
    expect(html).toContain(translate('ar', 'home.birthday.daysLeft.many'));
    expect(html).toContain('12 مارس 1990');
    expect(html).toContain('الجمعة، 12 مارس 2027');
  });

  it('takes the Arabic form the count needs', () => {
    // 3 Nov → 10 Nov is 7 days («أيام»); → 20 Nov is 17 («يومًا»).
    expect(render({ employee: summary({ birthDate: '1990-11-10' }) })).toContain(
      translate('ar', 'home.birthday.daysLeft.few'),
    );
    expect(render({ employee: summary({ birthDate: '1990-11-20' }) })).toContain(
      translate('ar', 'home.birthday.daysLeft.many'),
    );
  });

  it('says «غدًا» on the eve rather than counting one day', () => {
    const html = render({ employee: summary({ birthDate: '1990-11-04' }) });
    expect(html).toContain(translate('ar', 'home.birthday.tomorrow'));
    expect(html).not.toContain('>1<');
  });

  it('wishes on the day itself, in the greeting and on the card', () => {
    const html = render({ employee: summary({ birthDate: '1990-11-03' }) });
    expect(html).toContain('data-birthday="today"');
    expect(html).toContain(translate('ar', 'home.birthday.wish'));
    expect(html).toContain(translate('ar', 'home.greetingBirthday', { name: 'أحمد' }));
  });

  it('turns over at Cairo midnight, not at the device’s', () => {
    // 22:30 UTC on the 2nd is already the 3rd in Cairo (UTC+2): the birthday is today.
    vi.setSystemTime(new Date('2026-11-02T22:30:00Z'));
    expect(render({ employee: summary({ birthDate: '1990-11-03' }) })).toContain(
      'data-birthday="today"',
    );
  });

  it('says so when no date of birth is on file, rather than inventing a count', () => {
    const html = render({ employee: summary({ birthDate: null }) });
    expect(html).toContain('data-birthday="unknown"');
    expect(html).toContain(translate('ar', 'home.birthday.notOnFile'));
  });
});

describe('the recent pages — this account’s, newest first, each a link', () => {
  const now = new Date('2026-11-03T10:00:00Z').getTime();

  it('lists the pages this account opened, with when', () => {
    storage.set(
      `ecms.nav.recent.${USER}`,
      JSON.stringify([
        { id: 'odometer', at: now - 5 * 60_000 },
        { id: 'vehicles', at: now - 26 * 3_600_000 },
      ]),
    );
    const html = render();
    expect(html).toContain('data-recent-pages="true"');
    expect(html.indexOf('href="/fleet/odometer"')).toBeLessThan(
      html.indexOf('href="/fleet/vehicles"'),
    );
    expect(html).toContain('قبل 5 دقائق');
    expect(html).toContain('أمس');
  });

  it('never shows another account’s history from the same browser', () => {
    storage.set(`ecms.nav.recent.${OTHER_USER}`, JSON.stringify([{ id: 'odometer', at: now }]));
    const html = render();
    expect(html).not.toContain('data-recent-pages="true"');
  });

  it('drops a page the account can no longer open', () => {
    storage.set(
      `ecms.nav.recent.${USER}`,
      JSON.stringify([
        { id: 'revoked-page', at: now },
        { id: 'vehicles', at: now },
      ]),
    );
    const html = render();
    expect(html).toContain('href="/fleet/vehicles"');
    expect(html).not.toContain('revoked-page');
  });

  it('offers the first pages of the menu while there is no history yet', () => {
    const html = render();
    expect(html).toContain('data-starting-pages="true"');
    expect(html).toContain(translate('ar', 'home.recent.emptyStart'));
    expect(html).toContain('href="/fleet/vehicles"');
  });
});
