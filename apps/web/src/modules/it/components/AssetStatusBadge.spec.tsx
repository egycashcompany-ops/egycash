// Renders the REAL badge against the REAL locale catalogs, for every asset status and both
// locales.
//
// `it-i18n.spec.ts` proves the catalogs hold the keys. This proves the other half: that the
// component asks for the key the catalogs actually hold. Those are different failures — a badge
// with a mistyped prefix renders the raw key to users while the catalog test stays green.
//
// `renderToStaticMarkup` keeps this dependency-free (the InterviewStatusBadge precedent): no
// jsdom, no testing-library, just React and the store the component really reads its locale from.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { IT_ASSET_STATUSES, type ItAssetStatus, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { AssetStatusBadge } from './AssetStatusBadge';

const render = (status: ItAssetStatus, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <AssetStatusBadge status={status} />
    </Provider>,
  );
};

describe('AssetStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of IT_ASSET_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `it.assets.status.${status}`;
        const label = translate(locale, key);
        // Guard the guard: a key falling back to itself would make the assertion below vacuous.
        expect(label).not.toBe(key);
        expect(render(status, locale)).toContain(label);
      });
    }
  }

  it('gives every status its own tone rather than defaulting them all to neutral', () => {
    const tones = new Set(
      IT_ASSET_STATUSES.map((status) => {
        const html = render(status, 'en');
        // The tone is the colour class set the badge applies.
        return /class="([^"]*)"/.exec(html)?.[1] ?? '';
      }),
    );
    expect(tones.size).toBe(IT_ASSET_STATUSES.length);
  });
});
