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
  OPERATIONS_SECURED_STAGES,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  type Locale,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  DeliveryStatusBadge,
  SecuredStageBadge,
  ShipmentStatusBadge,
  ShipmentTypeBadge,
} from './ShipmentBadges';

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

// «لو تم التسليم من القائد … الحالة هتكون تم التسليم … ولما ادوس انا على صح … تم التسليم برضو».
describe('DeliveryStatusBadge — the day board’s «الحالة»', () => {
  for (const locale of ['en', 'ar'] as Locale[]) {
    const delivered = translate(locale, 'operations.board.status.delivered');
    const notDelivered = translate(locale, 'operations.board.status.notDelivered');

    it(`says «not delivered» until someone delivers (${locale})`, () => {
      const html = withLocale(locale, <DeliveryStatusBadge delivery="none" />);
      expect(html).toContain('data-delivery="none"');
      expect(html).toContain(notDelivered);
      // In Arabic «لم يتم التسليم» CONTAINS «تم التسليم», so look for it outside the label.
      expect(html.replaceAll(notDelivered, '')).not.toContain(delivered);
    });

    it(`says «delivered» for the captain AND the desk — who it was is not left to colour (${locale})`, () => {
      const captain = withLocale(locale, <DeliveryStatusBadge delivery="captain" />);
      const desk = withLocale(locale, <DeliveryStatusBadge delivery="desk" />);
      for (const html of [captain, desk]) expect(html).toContain(delivered);
      expect(captain).toContain(translate(locale, 'operations.board.status.byCaptain'));
      expect(desk).toContain(translate(locale, 'operations.board.status.byDesk'));
      // Different glyphs, so the two read apart without their colours.
      expect(captain).not.toEqual(desk.replace('data-delivery="desk"', 'data-delivery="captain"'));
    });
  }
});

// «والحالة لم التسليم و تم الاستلام من القائد و بالخزينة» — a محصنة's «الحالة», on the secured
// screen, the day board and the history.
describe('SecuredStageBadge — where a محصنة stands', () => {
  const WORDS: Record<(typeof OPERATIONS_SECURED_STAGES)[number], string> = {
    awaitingPickup: 'لم يتم التسليم',
    withCaptain: 'تم الاستلام من القائد',
    withOperations: 'تم الاستلام من العمليات',
    inVault: 'بالخزينة',
    dispatched: 'خرجت للتسليم',
    completed: 'تم التسليم',
  };

  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const stage of OPERATIONS_SECURED_STAGES) {
      it(`says ${stage} in ${locale}, with its sentence on hover and for a screen reader`, () => {
        const labelKey = `operations.board.stage.${stage}`;
        const hintKey = `operations.board.stageHint.${stage}`;
        const label = translate(locale, labelKey);
        const hint = translate(locale, hintKey);
        expect(label).not.toBe(labelKey);
        expect(hint).not.toBe(hintKey);
        const html = withLocale(locale, <SecuredStageBadge stage={stage} />);
        expect(html).toContain(`data-secured-stage="${stage}"`);
        expect(html).toContain(label);
        expect(html).toContain(`title="${hint}"`);
        expect(html).toContain('sr-only');
      });
    }
  }

  it('speaks the owner’s own words in Arabic', () => {
    for (const stage of OPERATIONS_SECURED_STAGES) {
      expect(translate('ar', `operations.board.stage.${stage}`)).toBe(WORDS[stage]);
    }
  });

  // Yellow and green are the pair a red-green colour-blind reader confuses: each stage has a glyph.
  it('draws each stage with a glyph of its own, so none is told apart by colour alone', () => {
    const glyphs = OPERATIONS_SECURED_STAGES.map((stage) => {
      const html = withLocale('ar', <SecuredStageBadge stage={stage} />);
      // The badge's markup without its words and its data attribute: what is left is the glyph.
      return html
        .replace(/data-secured-stage="[^"]*"/, '')
        .replace(/title="[^"]*"/, '')
        .replace(/>[^<]*</g, '><');
    });
    expect(new Set(glyphs).size).toBe(OPERATIONS_SECURED_STAGES.length);
  });
});
