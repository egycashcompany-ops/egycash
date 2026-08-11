// P9-B — the account decides, and the browser follows.
//
// Two different kinds of claim, tested two different ways:
//
//   • **The sync rule is a pure decision, so it is exercised directly** — as `decidePreferenceSync`
//     plus a real store, replaying the sequences that matter. It is NOT tested by rendering
//     `PreferenceSync`: this suite has no DOM, so `useEffect` never fires in it, and a rendered
//     test would have passed whether the rule were right, wrong, or missing entirely. (It did. An
//     earlier draft of this file "proved" the mirroring against a component whose effect had never
//     run, and three of its cases were green against nothing.)
//   • **Everything else is a markup fact**, asserted with `renderToStaticMarkup`. Nothing is
//     clicked; what is proven is what the user is SHOWN: the options, the selected one, the labels
//     in both languages.
//
// The one thing not provable here is that the server stores what these controls send. That lives in
// `apps/api/tests/integration/user-preferences.spec.ts`, against real HTTP and a real database.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { THEME_MODES, type Locale, type MeDto, type ThemeMode } from '@ecms/contracts';
import { localeSlice, setLocale } from '../../store/localeSlice';
import { uiSlice, setTheme } from '../../store/uiSlice';
import { authSlice, signedIn, signedOut } from '../../store/authSlice';
import { translate } from '../localization/i18n';
import { decidePreferenceSync } from './preference-sync';
import PreferencesPage from '../account/PreferencesPage';

const me = (overrides: Partial<MeDto> = {}): MeDto => ({
  id: 'u-1',
  email: 'me@ecms.local',
  username: null,
  mustChangePassword: false,
  name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
  locale: 'ar',
  navLayout: 'launchpad',
  theme: 'system',
  branchId: null,
  employeeId: null,
  permissions: {},
  isPrivileged: false,
  flags: {},
  totpEnabled: false,
  ...overrides,
});

const makeStore = ({
  locale = 'ar',
  theme = 'system',
  session = null,
}: { locale?: Locale; theme?: ThemeMode; session?: MeDto | null } = {}) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, ui: uiSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      ui: { theme, sidebarOpen: false },
      auth: {
        me: session,
        status: session === null ? ('signedOut' as const) : ('signedIn' as const),
      },
    },
  });

type Store = ReturnType<typeof makeStore>;

/**
 * One pass of the sync against a live store — the same three lines `PreferenceSync`'s effect runs,
 * with the ref replaced by an explicit argument so a test can say when each pass happens.
 */
const syncOnce = (store: Store, syncedId: string | null): string | null => {
  const decision = decidePreferenceSync(store.getState().auth.me, syncedId);
  if (decision.locale !== undefined) store.dispatch(setLocale(decision.locale));
  if (decision.theme !== undefined) store.dispatch(setTheme(decision.theme));
  return decision.syncedId;
};

const renderPage = (store: Store): string =>
  renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/account/preferences']}>
          <PreferencesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );

/** The `<input type="radio">` tags, so a test can ask which one is checked. */
const radios = (markup: string): string[] =>
  [...markup.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('type="radio"'));

const checkedValue = (markup: string, name: string): string | undefined =>
  radios(markup)
    .filter((tag) => tag.includes(`name="${name}"`) && tag.includes('checked'))
    .map((tag) => /value="([^"]*)"/.exec(tag)?.[1])[0];

describe('the account wins, once per session', () => {
  // The core of D1: a browser holding one language meets an account holding another.
  it('overwrites the local language and theme with the account’s', () => {
    const store = makeStore({
      locale: 'en',
      theme: 'dark',
      session: me({ locale: 'ar', theme: 'light' }),
    });
    syncOnce(store, null);
    expect(store.getState().locale.locale).toBe('ar');
    expect(store.getState().ui.theme).toBe('light');
  });

  it('carries the direction with the language', () => {
    const store = makeStore({ locale: 'en', session: me({ locale: 'ar' }) });
    syncOnce(store, null);
    expect(store.getState().locale.dir).toBe('rtl');
  });

  it('leaves a signed-out browser alone — the login screen is rendered in these values', () => {
    const store = makeStore({ locale: 'en', theme: 'dark', session: null });
    expect(syncOnce(store, null)).toBeNull();
    expect(store.getState().locale.locale).toBe('en');
    expect(store.getState().ui.theme).toBe('dark');
  });

  /**
   * The case that makes this key off identity rather than compare values.
   *
   * `signedIn` is dispatched after EVERY preference save. A save applies the new value locally
   * first — so for the moment before the server answers, the client is deliberately ahead of the
   * account. A sync that mirrored on every `me` would drag it back and the toggle would appear to
   * do nothing. Here: sync, move the client on its own, then deliver an unchanged `me`.
   */
  it('does not re-mirror when the same session is re-delivered', () => {
    const store = makeStore({ session: me({ locale: 'ar', theme: 'system' }) });
    let synced = syncOnce(store, null);
    store.dispatch(setLocale('en'));
    store.dispatch(setTheme('dark'));

    store.dispatch(signedIn(me({ locale: 'ar', theme: 'system' })));
    synced = syncOnce(store, synced);

    expect(synced).toBe('u-1');
    expect(store.getState().locale.locale).toBe('en');
    expect(store.getState().ui.theme).toBe('dark');
  });

  // A shared machine: one person signs out, the next signs in and gets THEIR settings.
  it('mirrors again for a different account on the same browser', () => {
    const store = makeStore({ session: me({ id: 'u-1', locale: 'ar' }) });
    let synced = syncOnce(store, null);
    expect(store.getState().locale.locale).toBe('ar');

    store.dispatch(signedIn(me({ id: 'u-2', locale: 'en', theme: 'dark' })));
    synced = syncOnce(store, synced);
    expect(synced).toBe('u-2');
    expect(store.getState().locale.locale).toBe('en');
    expect(store.getState().ui.theme).toBe('dark');
  });

  // …and the same person signing back in is mirrored again, because sign-out clears the mark.
  it('mirrors again after a sign-out and a fresh sign-in', () => {
    const store = makeStore({ session: me({ locale: 'ar' }) });
    let synced = syncOnce(store, null);

    store.dispatch(signedOut());
    synced = syncOnce(store, synced);
    expect(synced).toBeNull();
    store.dispatch(setLocale('en'));

    store.dispatch(signedIn(me({ locale: 'ar' })));
    syncOnce(store, synced);
    expect(store.getState().locale.locale).toBe('ar');
  });
});

describe('the sync rule itself', () => {
  const session = me({ id: 'u-9', locale: 'en', theme: 'dark' });

  it('names both values and the session it mirrored', () => {
    expect(decidePreferenceSync(session, null)).toEqual({
      locale: 'en',
      theme: 'dark',
      syncedId: 'u-9',
    });
  });

  it('names neither value once that session is mirrored', () => {
    expect(decidePreferenceSync(session, 'u-9')).toEqual({ syncedId: 'u-9' });
  });

  it('clears the mark on sign-out without naming a value', () => {
    expect(decidePreferenceSync(null, 'u-9')).toEqual({ syncedId: null });
  });
});

describe('the preferences page shows what is stored', () => {
  const page = (overrides: Partial<MeDto> = {}, locale: Locale = 'en', theme?: ThemeMode) =>
    renderPage(
      makeStore({
        locale,
        ...(theme === undefined ? {} : { theme }),
        session: me({ locale, ...overrides }),
      }),
    );

  it('offers every theme the contract declares', () => {
    const markup = page();
    for (const mode of THEME_MODES) {
      expect(markup, mode).toContain(`value="${mode}"`);
    }
  });

  it('offers both languages and both navigation shells', () => {
    const markup = page();
    expect(markup).toContain('العربية');
    expect(markup).toContain('English');
    expect(markup).toContain(translate('en', 'account.preferences.layout.rail'));
    expect(markup).toContain(translate('en', 'account.preferences.layout.launchpad'));
  });

  it.each(THEME_MODES)('marks the stored theme %s as the selected one', (mode) => {
    expect(checkedValue(page({}, 'en', mode), 'preference-theme')).toBe(mode);
  });

  it.each(['ar', 'en'] as const)('marks the current language %s as selected', (locale) => {
    expect(checkedValue(page({}, locale), 'preference-locale')).toBe(locale);
  });

  it.each(['launchpad', 'rail'] as const)('marks the stored shell %s as selected', (navLayout) => {
    expect(checkedValue(page({ navLayout }), 'preference-nav-layout')).toBe(navLayout);
  });

  // The reason `locale` is on the account rather than in this browser, said where the user is
  // choosing it: it decides the language of what the server sends them.
  it('says that the language also governs notifications', () => {
    expect(page()).toContain(translate('en', 'account.preferences.languageHint'));
  });

  it('explains that `system` follows the device', () => {
    expect(page()).toContain(translate('en', 'account.preferences.theme.systemHint'));
  });

  it.each(['en', 'ar'] as const)('resolves every key it asks for — %s', (locale) => {
    const markup = page({}, locale);
    expect(markup, 'an untranslated key reached the page').not.toContain('account.preferences.');
  });

  it('renders Arabic copy in Arabic', () => {
    expect(page({}, 'ar')).toContain('اللغة والمظهر والتنقّل الخاصة بحسابك');
  });
});
