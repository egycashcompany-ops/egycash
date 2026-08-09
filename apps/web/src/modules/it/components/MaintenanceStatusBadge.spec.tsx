// Renders the REAL badge against the REAL locale catalogs, for every order status and both
// locales — the TicketStatusBadge precedent, for the same reason.
//
// `it-i18n.spec.ts` proves the catalogs hold the keys. This proves the other half: that the
// component asks for the key the catalogs actually hold.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  IT_MAINTENANCE_ORDER_STATUSES,
  type ItMaintenanceOrderStatus,
  type Locale,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { MaintenanceStatusBadge } from './MaintenanceStatusBadge';

const render = (status: ItMaintenanceOrderStatus, locale: Locale): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <MaintenanceStatusBadge status={status} />
    </Provider>,
  );
};

describe('MaintenanceStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of IT_MAINTENANCE_ORDER_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `it.maintenance.status.${status}`;
        const label = translate(locale, key);
        // Guard the guard: a key falling back to itself would make the assertion below vacuous.
        expect(label).not.toBe(key);
        expect(render(status, locale)).toContain(label);
      });
    }
  }

  // Four statuses, four tones. `cancelled` must not look like `completed`: one is a repair that
  // happened and one is a repair that did not, and an operator reading a list at a glance is
  // exactly who that distinction is for.
  it('gives every status its own tone', () => {
    const toneOf = (status: ItMaintenanceOrderStatus): string =>
      /class="([^"]*)"/.exec(render(status, 'en'))?.[1] ?? '';
    const tones = IT_MAINTENANCE_ORDER_STATUSES.map(toneOf);
    expect(new Set(tones).size).toBe(IT_MAINTENANCE_ORDER_STATUSES.length);
  });
});
