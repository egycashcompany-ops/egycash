// Renders the REAL badges against the REAL locale catalogs, for every status and type and both
// locales — the TicketStatusBadge precedent, for the same reason.
//
// `operations-i18n.spec.ts` proves the catalogs hold the keys. This proves the other half: that
// the component asks for the key the catalogs actually hold. Those are different failures — a
// badge with a mistyped prefix renders the raw key to users while the catalog test stays green.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  type Locale,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { ShipmentStatusBadge, ShipmentTypeBadge } from './ShipmentBadges';

const withLocale = (locale: Locale, node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

describe('ShipmentStatusBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const status of OPERATIONS_SHIPMENT_STATUSES) {
      it(`shows the ${locale} label for ${status}`, () => {
        const key = `operations.shipment.status.${status}`;
        const label = translate(locale, key);
        // Guard the guard: a key falling back to itself would make the assertion vacuous.
        expect(label).not.toBe(key);
        expect(withLocale(locale, <ShipmentStatusBadge status={status} />)).toContain(label);
      });
    }
  }

  it('gives the terminal status the success tone, not the first one', () => {
    // The legacy codes are non-ordinal and 1 is TERMINAL (discovery §6). If someone ever maps
    // tone by numeric order, `completed` loses its success colour and `draft` gains it.
    const completed = withLocale('en', <ShipmentStatusBadge status="completed" />);
    const draft = withLocale('en', <ShipmentStatusBadge status="draft" />);
    expect(completed).toContain('emerald');
    expect(draft).not.toContain('emerald');
  });

  it('gives every status a distinct tone, so two states never look alike', () => {
    const tones = OPERATIONS_SHIPMENT_STATUSES.map((status: OperationsShipmentStatus) => {
      const markup = withLocale('en', <ShipmentStatusBadge status={status} />);
      return /(slate|sky|amber|emerald|red|brand)/.exec(markup)?.[0] ?? '';
    });
    expect(new Set(tones).size).toBe(OPERATIONS_SHIPMENT_STATUSES.length);
  });
});

describe('ShipmentTypeBadge', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const shipmentType of OPERATIONS_SHIPMENT_TYPES) {
      it(`shows the ${locale} label for ${shipmentType}`, () => {
        const key = `operations.shipment.type.${shipmentType}`;
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(withLocale(locale, <ShipmentTypeBadge shipmentType={shipmentType} />)).toContain(
          label,
        );
      });
    }
  }

  it('keeps the two Arabic labels the legacy words operators know', () => {
    expect(translate('ar', 'operations.shipment.type.daily')).toBe('يومي');
    expect(translate('ar', 'operations.shipment.type.secured')).toBe('محصنة');
  });

  it('distinguishes secured from daily visually', () => {
    const types: OperationsShipmentType[] = ['daily', 'secured'];
    const [daily, secured] = types.map((t) => withLocale('en', <ShipmentTypeBadge shipmentType={t} />));
    expect(daily).not.toBe(secured);
  });
});
