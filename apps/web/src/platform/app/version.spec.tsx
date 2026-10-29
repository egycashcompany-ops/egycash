// The version line on the sign-in screen and in the user menu.
//
// The build stamps the numbers (`vite.config.ts`); this proves what the screen does with them: the
// two parts joined, a missing part left out rather than shown as a gap, and nothing at all — not a
// bare «Version» label — when the build stamped nothing. Vitest does not load vite.config.ts, so the
// stamped values are stubbed here, and the module is imported afresh after stubbing because it reads
// them once, at load.
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../localization/i18n';
import { versionText } from './version';

const render = (node: JSX.Element, locale: 'ar' | 'en' = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

/** `AppVersion` as a build with these values would load it. */
const stampedAppVersion = async (version: string, build: string) => {
  vi.stubEnv('VITE_APP_VERSION', version);
  vi.stubEnv('VITE_APP_BUILD', build);
  vi.resetModules();
  return (await import('./AppVersion')).AppVersion;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the version text', () => {
  it('joins the version and the build', () => {
    expect(versionText('2.1.0', 'abc1234')).toBe('2.1.0 · abc1234');
  });

  it('leaves out a part the build did not stamp', () => {
    expect(versionText('2.1.0', '')).toBe('2.1.0');
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
    const AppVersion = await stampedAppVersion('2.1.0', 'abc1234');
    const html = render(<AppVersion />);
    expect(html).toContain('الإصدار');
    // Without the isolate, the RTL paragraph would reorder «2.1.0 · abc1234».
    expect(html).toContain('<bdi dir="ltr" class="font-mono tracking-tight">2.1.0 · abc1234</bdi>');
  });

  it('takes no part in a menu it sits inside', async () => {
    const AppVersion = await stampedAppVersion('2.1.0', '');
    expect(render(<AppVersion role="none" />, 'en')).toContain('role="none"');
  });

  it('renders nothing at all when the build stamped nothing', async () => {
    const AppVersion = await stampedAppVersion('', '');
    expect(render(<AppVersion />)).toBe('');
  });

  it('treats a stamped value of only whitespace as nothing', async () => {
    const AppVersion = await stampedAppVersion('  ', ' ');
    expect(render(<AppVersion />)).toBe('');
  });
});
