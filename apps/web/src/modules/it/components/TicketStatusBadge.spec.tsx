// Renders the REAL badge against the REAL locale catalogs, for every ticket status and both
// locales — the AssetStatusBadge precedent, for the same reason.
//
// `it-i18n.spec.ts` proves the catalogs hold the keys. This proves the other half: that the
// component asks for the key the catalogs actually hold. Those are different failures — a badge
// with a mistyped prefix renders the raw key to users while the catalog test stays green.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { IT_TICKET_STATUSES, type ItTicketStatus, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { TicketStatusBadge } from './TicketStatusBadge';

const render = (status: ItTicketStatus, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <TicketStatusBadge status={status} />
    </Provider>,
  );
};

describe('TicketStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of IT_TICKET_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `it.tickets.status.${status}`;
        const label = translate(locale, key);
        // Guard the guard: a key falling back to itself would make the assertion below vacuous.
        expect(label).not.toBe(key);
        expect(render(status, locale)).toContain(label);
      });
    }
  }

  // `closed` and `cancelled` share the neutral tone deliberately — both mean "not live work" —
  // so the count is statuses minus that one collision. Pinned so a future status added without a
  // tone (which would silently join the neutral pile) fails here.
  it('separates the live statuses by tone, and reads the two terminal ones as neutral', () => {
    const toneOf = (status: ItTicketStatus): string =>
      /class="([^"]*)"/.exec(render(status, 'en'))?.[1] ?? '';
    const live: ItTicketStatus[] = ['open', 'inProgress', 'onHold', 'resolved'];
    expect(new Set(live.map(toneOf)).size).toBe(live.length);
    expect(toneOf('closed')).toBe(toneOf('cancelled'));
    for (const status of live) expect(toneOf(status)).not.toBe(toneOf('closed'));
  });
});
