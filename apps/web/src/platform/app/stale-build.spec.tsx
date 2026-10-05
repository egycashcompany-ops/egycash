// A tab that outlives a deploy reloads itself into the new build — once.
//
// «لما بسيب الموقع مدة طويلة وأرجع بلاقى… Failed to fetch dynamically imported module». The
// browser cannot be driven here (no DOM), so each piece is proved where it lives: the rule that
// recognises the error and the rule that permits a reload as plain functions, the error boundary
// through its own state transitions and render, and the wiring by reading the source it is in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { localeSlice } from '../../store/localeSlice';
import { translate } from '../localization/i18n';
import { ErrorBoundary } from './ErrorBoundary';
import { isStaleBuildError, mayReloadForNewBuild, STALE_BUILD_RELOAD_COOLDOWN_MS } from './stale-build';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The exact error the owner saw, and its spelling in the other browsers. */
const CHROMIUM = new TypeError(
  'Failed to fetch dynamically imported module: https://ecms.egycash.com.eg/assets/routes-Mp_nHbTf.js',
);
const FIREFOX = new TypeError('error loading dynamically imported module: https://x/assets/a-1.js');
const SAFARI = new TypeError('Importing a module script failed.');

/** A sessionStorage stand-in. */
const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe('recognising an older build’s chunk', () => {
  it('knows the error in every browser’s wording', () => {
    for (const error of [CHROMIUM, FIREFOX, SAFARI]) expect(isStaleBuildError(error), error.message).toBe(true);
    expect(isStaleBuildError(new Error('Unable to preload CSS for /assets/index-1.css'))).toBe(true);
  });

  it('leaves every other error to the ordinary screen', () => {
    for (const error of [
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error('Request failed with status 500'),
      'a string',
      null,
      undefined,
    ]) {
      expect(isStaleBuildError(error)).toBe(false);
    }
  });
});

describe('reloading — once', () => {
  it('allows the first reload and records it', () => {
    const storage = memoryStorage();
    expect(mayReloadForNewBuild(storage, 1_000_000)).toBe(true);
    expect([...storage.data.values()]).toEqual(['1000000']);
  });

  it('refuses a second one inside the cooldown — a chunk missing from the CURRENT build cannot spin the page', () => {
    const storage = memoryStorage();
    expect(mayReloadForNewBuild(storage, 1_000_000)).toBe(true);
    expect(mayReloadForNewBuild(storage, 1_000_000 + 5_000)).toBe(false);
    expect(mayReloadForNewBuild(storage, 1_000_000 + STALE_BUILD_RELOAD_COOLDOWN_MS - 1)).toBe(false);
  });

  it('allows one again after the cooldown — the next deploy is a new stale tab', () => {
    const storage = memoryStorage();
    expect(mayReloadForNewBuild(storage, 1_000_000)).toBe(true);
    expect(mayReloadForNewBuild(storage, 1_000_000 + STALE_BUILD_RELOAD_COOLDOWN_MS)).toBe(true);
  });

  it('fails closed without storage: with no record of a reload, it never risks a loop', () => {
    expect(mayReloadForNewBuild(null, 1_000_000)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(mayReloadForNewBuild(throwing, 1_000_000)).toBe(false);
  });

  it('reads a garbled record as no record', () => {
    const storage = memoryStorage();
    storage.data.set('ecms.staleBuild.reloadedAt', 'not-a-number');
    expect(mayReloadForNewBuild(storage, 1_000_000)).toBe(true);
  });
});

describe('the error boundary', () => {
  const render = (node: unknown, locale: 'ar' | 'en' = 'ar'): string => {
    const store = configureStore({
      reducer: { locale: localeSlice.reducer },
      preloadedState: { locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) } },
    });
    return renderToStaticMarkup(<Provider store={store}>{node as JSX.Element}</Provider>);
  };

  /** The boundary as React drives it: state from the error, then its render. */
  const afterError = (error: Error): ErrorBoundary => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    return boundary;
  };

  it('says it is updating — not that something went wrong — for an older build’s chunk', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = render(afterError(CHROMIUM).render(), locale);
      expect(html).toContain(translate(locale, 'common.staleBuild.title'));
      expect(html).not.toContain(translate(locale, 'common.errorBoundary.title'));
      // And the raw browser message the owner was shown is not.
      expect(html).not.toContain('Failed to fetch dynamically imported module');
    }
  });

  it('keeps the ordinary error screen for every other crash', () => {
    const html = render(afterError(new TypeError("Cannot read properties of undefined (reading 'x')")).render());
    expect(html).toContain(translate('ar', 'common.errorBoundary.title'));
    expect(html).not.toContain(translate('ar', 'common.staleBuild.title'));
  });

  it('falls back to the ordinary screen when the reload is refused', () => {
    // `componentDidCatch` withdraws the updating notice when a reload already happened moments ago:
    // the CURRENT build is the broken one, and the person needs the button, not a spinner.
    const source = readFileSync(join(HERE, 'ErrorBoundary.tsx'), 'utf8');
    expect(source).toMatch(/isStaleBuildError\(error\) && !reloadIntoNewBuild\(\)\) this\.setState\(\{ staleBuild: false \}\)/);
  });
});

describe('the wiring', () => {
  it('reloads on Vite’s failed-import event, which covers every lazy screen and on-demand library', () => {
    const main = readFileSync(join(HERE, '..', '..', 'main.tsx'), 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(main).toMatch(/addEventListener\('vite:preloadError', \(\) => \{\s*reloadIntoNewBuild\(\);\s*\}\)/);
  });
});
