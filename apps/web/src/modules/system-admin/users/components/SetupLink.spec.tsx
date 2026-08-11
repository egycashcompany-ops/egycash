// The setup-link control and the dialog that shows it, rendered.
//
// P9-A is the one place in this product where a secret is put on a screen, and the two things that
// make that defensible are both properties of the RENDER: the control appears only for a principal
// holding `user.setupLink` and only on an account that has no password, and the dialog states — in
// the markup, in both locales — that the link is shown once, works once, kills its predecessor and
// was not sent anywhere.
//
// Source scans would have proved none of that. P7-C shipped a button that satisfied every regex
// written about it and could not be reached, so the claims here are made against the markup
// `renderToStaticMarkup` produces for each state the page is actually in.
//
// Two limits, stated rather than worked around:
//
//   • **The modal wrapper cannot be rendered here.** `Dialog` mounts through
//     `createPortal(…, document.body)` and this environment has no `document`. So the assertions
//     below render `SetupLinkPanel` — the dialog's entire content, extracted for exactly this
//     reason — and the wrapper it sits in is the same shared `Dialog` four other confirmations in
//     this panel already use.
//   • **The click is not proven here.** That pressing the button calls the endpoint, and that the
//     endpoint refuses an account with a password, live in
//     `apps/api/tests/integration/system-admin-setup-link.spec.ts`, where a real request meets real
//     RBAC — which is the right place for a security rule anyway.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AccountStatus,
  type Locale,
  type MeDto,
  type SetupLinkDto,
  type UserDto,
  type UserStatus,
} from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { UserSecurityActions } from './UserSecurityActions';
import { SetupLinkPanel } from './SetupLinkDialog';

const me = (permissions: string[]): MeDto => ({
  id: 'admin-1',
  email: 'admin@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'en',
  navLayout: 'rail',
  branchId: null,
  employeeId: null,
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  isPrivileged: true,
  flags: {},
  totpEnabled: true,
});

const user = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u-1',
  email: 'newcomer@ecms.local',
  username: null,
  mustChangePassword: false,
  setupLinkPending: true,
  accountStatus: 'invitationSent' as AccountStatus,
  invitationSentAt: '2026-08-11T09:00:00.000Z',
  invitationExpiresAt: '2026-08-13T09:00:00.000Z',
  activatedAt: null,
  lastLoginAt: null,
  passwordChangedAt: null,
  lastDelivery: null,
  totpEnabled: false,
  totpRequired: false,
  employeeId: null,
  phone: null,
  firstName: { ar: 'سارة', en: 'Sara' },
  lastName: { ar: 'أحمد', en: 'Ahmed' },
  locale: 'ar',
  status: 'invited' as UserStatus,
  organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
  version: 1,
  createdAt: '2026-08-11T09:00:00.000Z',
  updatedAt: '2026-08-11T09:00:00.000Z',
  ...over,
});

const render = (
  node: JSX.Element,
  { locale = 'en', permissions = ['user.resetPassword', 'user.setupLink'] }: {
    locale?: Locale;
    permissions?: string[];
  } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: me(permissions), status: 'signedIn' as const },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const panel = (
  over: Partial<UserDto> = {},
  options: { locale?: Locale; permissions?: string[] } = {},
): string => render(<UserSecurityActions user={user(over)} />, options);

const LINK: SetupLinkDto = {
  url: 'https://ecms.example.com/activate?token=abc123def456',
  expiresAt: '2026-08-13T09:00:00.000Z',
};

describe('the setup-link button is offered only where it would work', () => {
  it('appears for an account awaiting activation, to a principal holding the key', () => {
    expect(panel()).toContain('Copy setup link');
  });

  // The account that has been reset: no password, activation pending again. The server issues a
  // link here, so hiding the button would be the P7-C shape — the capability present, unreachable.
  it('appears for an account whose link has expired', () => {
    expect(panel({ accountStatus: 'expired', setupLinkPending: false })).toContain(
      'Copy setup link',
    );
  });

  // D3. An account with a password would have its password replaced by whoever opens the link.
  it('is absent for an activated account', () => {
    const markup = panel({
      accountStatus: 'activated',
      setupLinkPending: false,
      activatedAt: '2026-08-01T00:00:00.000Z',
      status: 'active',
    });
    expect(markup).not.toContain('Copy setup link');
  });

  it('is absent for a suspended or archived account', () => {
    for (const status of ['suspended', 'archived'] as const) {
      const markup = panel({ accountStatus: 'locked', status, setupLinkPending: false });
      expect(markup, status).not.toContain('Copy setup link');
    }
  });

  // D2 in the markup: holding reset is not holding this.
  it('is absent for a principal holding only user.resetPassword', () => {
    const markup = panel({}, { permissions: ['user.resetPassword'] });
    expect(markup).not.toContain('Copy setup link');
    // …while the actions that key DOES open are still there, so the absence is about this key.
    expect(markup).toContain('Reset password');
  });

  it('is absent for a principal holding neither', () => {
    const markup = panel({}, { permissions: ['user.view'] });
    expect(markup).not.toContain('Copy setup link');
  });

  it('says what the button will do before it is pressed', () => {
    const markup = panel();
    expect(markup).toContain('shows it to you once');
    expect(markup).toContain('Nothing is sent by the system');
  });

  it('renders in Arabic too', () => {
    const markup = panel({}, { locale: 'ar' });
    expect(markup).toContain('نسخ رابط الإعداد');
    expect(markup).not.toContain('systemAdmin.users');
  });
});

describe('the dialog tells the administrator what they are holding', () => {
  const markup = render(<SetupLinkPanel link={LINK} userName="Sara Ahmed" />, {
    permissions: ['user.setupLink'],
  });

  it('shows the link itself', () => {
    expect(markup).toContain(LINK.url);
  });

  it('names the person it is for, so it cannot be sent to the wrong one', () => {
    expect(markup).toContain('Sara Ahmed');
  });

  // The four properties an administrator must know before closing this dialog.
  it.each([
    ['shown once', 'Shown once.'],
    ['cannot be shown again', 'cannot be shown again'],
    ['single use', 'Works once'],
    ['supersedes', 'stop working'],
    ['nothing was sent', 'Nothing was sent by the system'],
  ])('states that it is %s', (_name, phrase) => {
    expect(markup).toContain(phrase);
  });

  it('shows when it expires', () => {
    expect(markup).toContain('Expires');
  });

  it('renders the link left-to-right and selectable rather than disabled', () => {
    const input = /<input\b[^>]*id="setup-link-url"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(input, 'the link field was not found').not.toBe('');
    expect(input).toContain('dir="ltr"');
    expect(input).toContain('readonly');
    // A disabled control cannot be selected in every browser, which would strand anyone whose
    // browser also refuses clipboard access.
    expect(input).not.toContain('disabled=""');
  });

  it('labels the field, even though the label is visually hidden', () => {
    expect(markup).toContain('for="setup-link-url"');
  });

});

describe('both locales', () => {
  it.each(['en', 'ar'] as const)('resolves every key the dialog asks for — %s', (locale) => {
    const markup = render(<SetupLinkPanel link={LINK} userName="Sara Ahmed" />, {
      locale,
      permissions: ['user.setupLink'],
    });
    // `translate` falls back to the key, so an untranslated one appears verbatim.
    expect(markup, 'an untranslated key reached the dialog').not.toContain(
      'systemAdmin.users.setupLink.',
    );
  });
});
