// The version line: in the user menu, and on the screens without one (the crash screen, the
// captain's phone screens).
//
// The build stamps the numbers (`vite.config.ts`); this proves what the screen does with them: the
// two parts joined, a missing part left out rather than shown as a gap, nothing at all — not a bare
// «Version» label — when the build stamped nothing, and nothing to anybody who is not signed in.
// Vitest does not load vite.config.ts, so the stamped values are stubbed here, and the modules are
// imported afresh after stubbing because `version.ts` reads them once, at load.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authSlice } from '../../store/authSlice';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../localization/i18n';
import { versionText } from './version';

type Session = 'signedIn' | 'signedOut' | 'unknown';

const render = (
  node: JSX.Element,
  { locale = 'ar', session = 'signedIn' }: { locale?: 'ar' | 'en'; session?: Session } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      // Only the status matters here; nothing these components render reads the profile.
      auth: { me: null, status: session },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

/** Load the modules as a build with these values would. */
const stamped = async (version: string, build: string) => {
  vi.stubEnv('VITE_APP_VERSION', version);
  vi.stubEnv('VITE_APP_BUILD', build);
  vi.resetModules();
  return {
    AppVersion: (await import('./AppVersion')).AppVersion,
    ErrorBoundary: (await import('./ErrorBoundary')).ErrorBoundary,
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the version text', () => {
  it('joins the version and the build', () => {
    expect(versionText('2.2.0', 'abc1234')).toBe('2.2.0 · abc1234');
  });

  it('leaves out a part the build did not stamp', () => {
    expect(versionText('2.2.0', '')).toBe('2.2.0');
    expect(versionText('', 'abc1234')).toBe('abc1234');
  });

  it('is empty when nothing was stamped', () => {
    expect(versionText('', '')).toBe('');
  });
});

describe('the version line', () => {
  it('is labelled in both languages', () => {
    expect(translate('en', 'platform.shell.version')).toBe('Version');
    expect(translate('ar', 'platform.shell.version')).toBe('الإصدار');
  });

  it('shows the label and the number, the number isolated left-to-right inside Arabic', async () => {
    const { AppVersion } = await stamped('2.2.0', 'abc1234');
    const html = render(<AppVersion />);
    expect(html).toContain('الإصدار');
    // Without the isolate, the RTL paragraph would reorder «2.2.0 · abc1234».
    expect(html).toContain('<bdi dir="ltr" class="font-mono tracking-tight">2.2.0 · abc1234</bdi>');
  });

  it('takes no part in a menu it sits inside', async () => {
    const { AppVersion } = await stamped('2.2.0', '');
    expect(render(<AppVersion role="none" />, { locale: 'en' })).toContain('role="none"');
  });

  it('renders nothing at all when the build stamped nothing', async () => {
    const { AppVersion } = await stamped('', '');
    expect(render(<AppVersion />)).toBe('');
  });

  it('treats a stamped value of only whitespace as nothing', async () => {
    const { AppVersion } = await stamped('  ', ' ');
    expect(render(<AppVersion />)).toBe('');
  });
});

// A version printed on a page anybody can open is a banner for whoever is probing the site. So it is
// displayed to a signed-in session only — decided in the one component that displays it, which is
// what makes the crash screen safe: that screen sits over every route, public sign-ins included.
describe('who sees it', () => {
  it.each(['signedOut', 'unknown'] as const)('nobody whose session is %s', async (session) => {
    const { AppVersion } = await stamped('2.2.0', 'abc1234');
    expect(render(<AppVersion />, { session })).toBe('');
  });

  it('the crash screen shows it to a signed-in person, and not to anybody else', async () => {
    const { ErrorBoundary } = await stamped('2.2.0', 'abc1234');
    const crashed = new ErrorBoundary({ children: null });
    crashed.state = ErrorBoundary.getDerivedStateFromError(new TypeError('boom'));
    expect(render(crashed.render() as JSX.Element)).toContain('2.2.0 · abc1234');
    expect(render(crashed.render() as JSX.Element, { session: 'signedOut' })).not.toContain(
      '2.2.0',
    );
  });

  it('the user menu shows it', () => {
    const topbar = readFileSync(join(SRC, 'platform/layout/Topbar.tsx'), 'utf8');
    expect(topbar).toContain('<AppVersion');
  });

  it('and nothing reads the stamp around that check', () => {
    // The stamp is read by `version.ts` alone, and displayed through `AppVersion` — plus the driver
    // profile's footer, a staff page behind sign-in. A new reader has to be added here on purpose.
    const ALLOWED = new Set([
      'platform/app/version.ts',
      'platform/app/AppVersion.tsx',
      'modules/fleet/pages/DriverProfilePage.tsx',
    ]);
    const offenders = sources()
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => {
        const text = readFileSync(join(SRC, file), 'utf8');
        return (
          /VITE_APP_(VERSION|BUILD)/.test(text) ||
          /from '(?:[^']*\/)?app\/version'|from '\.\/version'/.test(text)
        );
      });
    expect(offenders).toEqual([]);
  });
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every non-spec source file under src, as a path relative to it with forward slashes. */
const sources = (dir: string = SRC): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(name) || /\.spec\.tsx?$/.test(name)) return [];
    return [relative(SRC, path).split(sep).join('/')];
  });
