// Renders the REAL badge against the REAL locale catalogs, for every licence state and both
// locales — the TicketStatusBadge precedent, for the same reason: `it-i18n.spec.ts` proves the
// catalogs hold the keys, and this proves the component asks for the keys they hold.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { IT_LICENSE_STATES, type ItLicenseState, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { LicenseStateBadge } from './LicenseStateBadge';

const render = (state: ItLicenseState, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <LicenseStateBadge state={state} />
    </Provider>,
  );
};

describe('LicenseStateBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const state of IT_LICENSE_STATES) {
      it(`shows the ${locale} label for ${state}`, () => {
        const key = `it.licenses.state.${state}`;
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(render(state, locale)).toContain(label);
      });
    }
  }

  // Four states, four tones. `expiringSoon` must not look like `expired`: one is a reminder and
  // the other is a compliance problem, and an operator scanning a list is exactly who that
  // distinction is for.
  it('gives every state its own tone', () => {
    const toneOf = (state: ItLicenseState): string =>
      /class="([^"]*)"/.exec(render(state, 'en'))?.[1] ?? '';
    expect(new Set(IT_LICENSE_STATES.map(toneOf)).size).toBe(IT_LICENSE_STATES.length);
  });
});
