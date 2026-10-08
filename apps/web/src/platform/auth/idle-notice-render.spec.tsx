// The inactivity rule as the person meets it: the explanation on the sign-in screen they land on,
// and the portal pages still rendering once the guard wraps them.
//
// Rendered, not grepped. A source scan for `t('auth.idle.signedOutNotice')` passes on a screen that
// shows the notice only after an error, or never; a scan for `<IdleSessionGuard` passes on a guard
// wrapped around nothing. Both are markup facts, so they are asserted against markup.
//
// What a static render cannot hold — that the sign-out and the navigation land as ONE update, so a
// route gate's own redirect cannot drop `?reason=idle` — is `idle-session-wiring.spec.ts`.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../localization/i18n';
import { LoginPage } from './LoginPage';
import { PortalLoginPage } from '../../modules/gold/portal/PortalLoginPage';
import { RequirePortal } from '../../modules/gold/portal/RequirePortal';
import { ApplicantPortalLoginPage } from '../../modules/hr/recruitment/applicant-portal/ApplicantPortalLoginPage';
import { RequireApplicantPortal } from '../../modules/hr/recruitment/applicant-portal/RequireApplicantPortal';
import { APPLICANT_PORTAL_SUBJECT } from '../../modules/hr/recruitment/applicant-portal/subject';

const account = (external: MeDto['external']): MeDto => ({
  id: 'u-1',
  email: null,
  username: 'customer',
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  theme: 'system',
  branchId: null,
  branchIds: [],
  employeeId: null,
  permissions: {},
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  external,
});

const GOLD_CUSTOMER = account({ moduleId: 'gold', subjectType: 'goldCompany', subjectId: 'c-1', label: null });
const CANDIDATE = account({ moduleId: 'hr', subjectType: APPLICANT_PORTAL_SUBJECT, subjectId: 'a-1', label: null });

const render = (
  node: JSX.Element,
  { locale = 'en', path, me = null }: { locale?: Locale; path: string; me?: MeDto | null },
): string => {
  const store = configureStore({
    // `ui` is here because the sign-in screens render the theme toggle, which reads it.
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: me === null ? { me: null, status: 'signedOut' as const } : { me, status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

/** Text as React writes it into markup. */
const escaped = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const SIGN_IN_SCREENS: [string, JSX.Element, string][] = [
  ['the staff sign-in', <LoginPage />, '/login'],
  ['the gold customer portal sign-in', <PortalLoginPage />, '/portal/login'],
  ['the applicant portal sign-in', <ApplicantPortalLoginPage />, '/applicant-portal/login'],
];

describe.each(SIGN_IN_SCREENS)('%s', (_name, screen, signIn) => {
  it.each(['en', 'ar'] as const)('says why the person is back after an idle sign-out (%s)', (locale) => {
    const markup = render(screen, { locale, path: `${signIn}?reason=idle` });
    expect(markup).toContain(escaped(translate(locale, 'auth.idle.signedOutNotice')));
    expect(markup).toContain('role="status"');
  });

  it('shows no such notice to somebody who simply came to sign in', () => {
    for (const locale of ['en', 'ar'] as const) {
      const markup = render(screen, { locale, path: signIn });
      expect(markup).not.toContain(escaped(translate(locale, 'auth.idle.signedOutNotice')));
    }
  });
});

const PORTAL_GATES: [string, (child: JSX.Element) => JSX.Element, string, MeDto][] = [
  ['the gold customer portal', (child) => <RequirePortal>{child}</RequirePortal>, '/portal', GOLD_CUSTOMER],
  [
    'the applicant portal',
    (child) => <RequireApplicantPortal>{child}</RequireApplicantPortal>,
    '/applicant-portal',
    CANDIDATE,
  ],
];

describe.each(PORTAL_GATES)('%s, behind its inactivity guard', (_name, gate, path, me) => {
  it('still renders its pages for the account it is for', () => {
    const markup = render(gate(<p>portal-page</p>), { path, me });
    expect(markup).toContain('<p>portal-page</p>');
  });

  it('shows no warning while the person is there', () => {
    // The dialog only opens in the last minute of an idle window; a fresh render is not that.
    const markup = render(gate(<p>portal-page</p>), { path, me });
    expect(markup).not.toContain(escaped(translate('en', 'auth.idle.warningTitle')));
  });
});
