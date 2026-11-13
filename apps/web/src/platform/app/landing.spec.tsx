// `/` is the welcome page — a place of its own, no longer a hop to the first screen.
//
// «عايز بقى أى حساب يدخل تظهرله Welcome Page بتقوله أهلاً … وتظهرله الـ Recent Pages اللى كان
// فيها». What the page says is pinned in `home/welcome.spec.tsx`; this file pins what surrounds
// it, which a refactor could quietly undo: that `/` is routed to it inside the shell, that it
// never redirects away, that an account holding nothing is told so, and that a new session never
// reads the PREVIOUS person's cached menu.
//
// The older complaint still holds and is still pinned: «لو انا عامل لحد ان يشوف الحركه مثلا او
// العمليات او ما بيخش بيجيب الشاشه بتاعت الاتش ار بس مفيهاش معلومات». Nobody lands on an HR page
// now; and a person with no history yet is offered the first pages of THEIR menu, work first.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MyApplicationCategoryDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../localization/i18n';
import { LandingPage } from './pages/LandingPage';
import { NavPrefsProvider } from '../navigation/NavPrefs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
/** Source with comments removed, so a sentence ABOUT a call cannot stand in for the call. */
const code = (path: string): string =>
  readFileSync(join(SRC, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const fleetOnly: MyApplicationCategoryDto[] = [
  {
    id: 'fleet',
    name: { ar: 'الحركة', en: 'Fleet' },
    icon: 'truck',
    applications: [{ id: 'f1', name: { ar: 'لوحة الحركة', en: 'Fleet' }, icon: 'truck', route: '/fleet', personal: false }],
    sections: [],
  },
];

const render = (menu: MyApplicationCategoryDto[] | undefined, locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: null, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  if (menu !== undefined) qc.setQueryData(['me', 'applications'], menu);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <NavPrefsProvider>
            <Routes>
              <Route path="/" element={<LandingPage />} />
            </Routes>
          </NavPrefsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the landing page', () => {
  it('is the welcome page, and never moves on by itself', () => {
    const html = render(fleetOnly);
    expect(html).toContain('data-welcome="true"');
    const page = code('platform/app/pages/LandingPage.tsx');
    expect(page).toMatch(/<WelcomePage \/>/);
    expect(page).not.toMatch(/Navigate/);
  });

  it('offers a person with no history yet the first page of THEIR menu — never an HR page', () => {
    const html = render(fleetOnly);
    expect(html).toContain('data-starting-pages="true"');
    expect(html).toContain('href="/fleet"');
  });

  it('says plainly, in both languages, when nothing has been granted yet', () => {
    for (const locale of ['en', 'ar'] as const) {
      const html = render([], locale);
      expect(html).toContain(translate(locale, 'platform.landing.nothingGrantedTitle'));
      expect(html).toContain(translate(locale, 'platform.landing.nothingGrantedBody'));
    }
  });

  it('does not claim nothing is granted while the menu is still on its way', () => {
    const html = render(undefined);
    expect(html).not.toContain(translate('en', 'platform.landing.nothingGrantedTitle'));
  });
});

describe('`/` belongs to the platform, not to a module', () => {
  it('routes `/` to the landing page, behind the sign-in guard and inside the shell', () => {
    const app = code('platform/app/App.tsx');
    const root = app.slice(app.indexOf('path="/"'), app.indexOf('path="/*"'));
    expect(root, 'a route for `/` itself').not.toBe('');
    expect(root).toMatch(/<RequireAuth>[\s\S]*<AppShell \/>[\s\S]*<\/RequireAuth>/);
    expect(root).toMatch(/<Route index element=\{<LandingPage \/>\} \/>/);
  });

  it('no longer lets the HR catch-all answer `/` — which is how HR became everybody’s front door', () => {
    const recruitment = code('modules/hr/recruitment/routes.tsx');
    expect(recruitment).not.toMatch(/<Route element=\{<RecruitmentLayout \/>\}>\s*<Route index/);
    expect(recruitment).not.toMatch(/RecruitmentOverview/);
  });
});

describe('a new session never lands by the previous person’s menu', () => {
  // Somebody signs out, somebody else signs in, on the same tab and without a reload: the menu
  // cached for five minutes is still the first person's, and `/` reads its first screen from it.

  it('clears the cache where every session begins — before the new person is signed in', () => {
    const login = code('platform/auth/LoginPage.tsx');
    const finish = login.slice(login.indexOf('const finish ='), login.indexOf('const submitCredentials'));
    expect(finish).toMatch(/queryClient\.clear\(\);\s*dispatch\(signedIn\(me\)\)/);
  });

  it('clears it when the top-bar button signs somebody out, as the idle sign-out already did', () => {
    const topbar = code('platform/layout/Topbar.tsx');
    const signOut = topbar.slice(topbar.indexOf('const signOut ='), topbar.indexOf('return ('));
    expect(signOut).toMatch(/dispatch\(signedOut\(\)\);\s*queryClient\.clear\(\);/);
  });
});
