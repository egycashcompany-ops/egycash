// Fingerprint / face sign-in on the web side (ADR-035).
//
// No DOM in this suite, so the prompts themselves are proven in the browser (the Playwright check
// with a virtual authenticator) and against the real library on the server (`passkey.service.spec`).
// What is asserted here is what does not need a device: which message each failure gets — and that
// a withdrawn prompt gets none — the «not now» memory, every new string in both languages, and the
// markup the screens render before the browser has answered (no button yet, the autofill hint on the
// identifier field, no extra password field on the Security page until «add» is pressed).
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SESSION_METHODS,
  type Locale,
  type MeDto,
  type PasskeyDto,
  type SessionDto,
} from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { uiSlice } from '../../store/uiSlice';
import { translate } from '../localization/i18n';
import { ApiError } from '../../shared/lib/api-client';
import { LOGIN_FAILURE_KEYS } from './login-failure';
import { PASSKEY_FAILURE_KEYS, passkeyFailure } from './passkey-failure';
import { passkeyOfferSuppressed, rememberPasskeyOffer } from './passkeys';
import { LoginPage } from './LoginPage';
import { PortalLoginPage } from '../../modules/gold/portal/PortalLoginPage';
import SecurityPage from '../account/SecurityPage';
import { PASSKEYS_QUERY_KEY } from '../account/PasskeysCard';

const LOCALES: Locale[] = ['en', 'ar'];

/** A DOM error as the browser library re-throws it: a name, and sometimes its own code. */
const deviceError = (name: string, code?: string): Error =>
  Object.assign(new Error(name), { name, ...(code === undefined ? {} : { code }) });

describe('what each failure says', () => {
  it('says nothing when the page itself withdrew the prompt', () => {
    expect(passkeyFailure(deviceError('AbortError'), true)).toBeNull();
    expect(passkeyFailure(deviceError('Error', 'ERROR_CEREMONY_ABORTED'), true)).toBeNull();
  });

  it('names each server refusal', () => {
    const server = (code: string) => new ApiError(code, 'refused', 401);
    expect(passkeyFailure(server('AUTH_PASSKEY_INVALID'), true)?.key).toBe(
      'platform.auth.passkey.invalid',
    );
    expect(passkeyFailure(server('AUTH_PASSKEYS_DISABLED'), true)?.key).toBe(
      'platform.auth.passkey.disabled',
    );
    expect(passkeyFailure(server('AUTH_PASSKEY_NOT_ALLOWED'), true)?.key).toBe(
      'platform.auth.passkey.notAllowed',
    );
    expect(passkeyFailure(server('AUTH_PASSKEY_LIMIT'), true)?.key).toBe(
      'platform.auth.passkey.limit',
    );
  });

  it('keeps naming the account states the password sign-in already names', () => {
    const locked = new ApiError('AUTH_ACCOUNT_LOCKED', 'locked', 401);
    expect(passkeyFailure(locked, true)?.key).toBe('platform.auth.login.locked');
  });

  it('tells a closed or empty prompt apart from a device that failed', () => {
    expect(passkeyFailure(deviceError('NotAllowedError'), true)?.key).toBe(
      'platform.auth.passkey.cancelled',
    );
    expect(passkeyFailure(deviceError('SecurityError'), true)?.key).toBe(
      'platform.auth.passkey.deviceFailed',
    );
    expect(
      passkeyFailure(
        deviceError('InvalidStateError', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'),
        true,
      )?.key,
    ).toBe('platform.auth.passkey.alreadyAdded');
  });

  it('keeps the background autofill quiet except for a server refusal', () => {
    expect(passkeyFailure(deviceError('NotAllowedError'), true, true)).toBeNull();
    expect(passkeyFailure(new Error('No <input> with "webauthn"'), true, true)).toBeNull();
    expect(passkeyFailure(new ApiError('AUTH_PASSKEY_INVALID', 'x', 401), true, true)?.key).toBe(
      'platform.auth.passkey.invalid',
    );
  });
});

describe('«not now» is remembered on this browser', () => {
  const store = new Map<string, string>();
  const withStorage = (): void => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    };
  };
  afterEach(() => {
    store.clear();
    delete (globalThis as { window?: unknown }).window;
  });

  it('asks until answered, then holds «not now» for thirty days', () => {
    withStorage();
    expect(passkeyOfferSuppressed('u-1')).toBe(false);
    rememberPasskeyOffer('u-1', 'declined');
    expect(passkeyOfferSuppressed('u-1')).toBe(true);
    expect(passkeyOfferSuppressed('u-2'), 'per account').toBe(false);
    expect(passkeyOfferSuppressed('u-1', Date.now() + 31 * 86_400_000)).toBe(false);
  });

  it('never asks again once a passkey was added', () => {
    withStorage();
    rememberPasskeyOffer('u-1', 'added');
    expect(passkeyOfferSuppressed('u-1', Date.now() + 365 * 86_400_000)).toBe(true);
  });

  it('asks again rather than failing when storage is unavailable', () => {
    expect(passkeyOfferSuppressed('u-1')).toBe(false);
    expect(() => rememberPasskeyOffer('u-1', 'declined')).not.toThrow();
  });
});

describe('every new string exists in both languages', () => {
  const keys = [
    ...PASSKEY_FAILURE_KEYS,
    ...LOGIN_FAILURE_KEYS,
    'platform.auth.passkey.signIn',
    'platform.auth.passkey.or',
    'platform.auth.passkey.offer.title',
    'platform.auth.passkey.offer.body',
    'platform.auth.passkey.offer.enable',
    'platform.auth.passkey.offer.later',
    'platform.auth.passkey.offer.totpHint',
    'platform.auth.passkey.offer.done',
    // Built by interpolation on the session list.
    ...SESSION_METHODS.map((method) => `account.security.signedInWith.${method}`),
  ];
  it.each(LOCALES)('%s', (locale) => {
    const missing = keys.filter((key) => translate(locale, key) === key);
    expect(missing).toEqual([]);
  });
});

// ── Markup ───────────────────────────────────────────────────────────────

const me = (): MeDto => ({
  id: 'u-1',
  email: 'me@ecms.local',
  username: null,
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
  external: null,
});

const render = (node: JSX.Element, seed: (qc: QueryClient) => void = () => undefined): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'en' as const, dir: 'ltr' as const },
      auth: { me: me(), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the sign-in screens before the browser has answered', () => {
  it.each([
    ['staff', <LoginPage key="staff" />],
    ['gold portal', <PortalLoginPage key="portal" />],
  ])('%s: no button yet, and the identifier field invites a saved passkey', (_name, node) => {
    const markup = render(node);
    expect(markup).not.toContain(translate('en', 'platform.auth.passkey.signIn'));
    expect(markup).toContain('autoComplete="username webauthn"');
  });
});

describe('the Security page', () => {
  const passkeys: PasskeyDto[] = [
    {
      id: 'p-1',
      name: 'iPhone',
      createdAt: '2026-10-01T09:00:00.000Z',
      lastUsedAt: null,
      backedUp: true,
    },
  ];
  const sessions: SessionDto[] = [
    {
      id: 's-1',
      userAgent: 'Safari',
      ip: '10.0.0.1',
      createdAt: '2026-10-01T09:00:00.000Z',
      lastUsedAt: '2026-10-01T09:00:00.000Z',
      current: true,
      method: 'passkey',
    },
  ];
  const markup = render(<SecurityPage />, (qc) => {
    qc.setQueryData(PASSKEYS_QUERY_KEY, passkeys);
    qc.setQueryData(['platform', 'auth', 'sessions'], sessions);
  });

  it('lists the devices that sign in with a fingerprint or face', () => {
    expect(markup).toContain(translate('en', 'account.security.passkeys'));
    expect(markup).toContain('iPhone');
    expect(markup).toContain(translate('en', 'account.security.passkeySynced'));
    expect(markup).toContain(translate('en', 'account.security.passkeyNeverUsed'));
  });

  it('says how each session signed in', () => {
    expect(markup).toContain(translate('en', 'account.security.signedInWith.passkey'));
  });

  it('adds no password field until «add this device» is pressed', () => {
    const fields = [...markup.matchAll(/<input\b[^>]*>/g)].filter((m) =>
      m[0].includes('type="password"'),
    );
    expect(fields).toHaveLength(3);
  });
});
