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
  VAULT_HOLD_LABEL,
  VAULT_PICKUP_LABEL,
  VaultHoldStatus,
  VaultPickupStatus,
} from './ShipmentBadges';
import { VAULT_HOLD_COLUMN, VAULT_PICKUP_COLUMN } from '../lib/day-board';

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

// Round 13 — «انا عايز الجدول بتاع استلام الخزينه يكون مكان الحاله عمودين. العمود الاولاني يبقى خاص
// يبين ان اللي حصل استلام من القائد او من العمليات، والعمود التاني بتاع الحاله برضو يبين استلام من
// الخزينه»: the vault queue's two columns, in the stage badge's own family.
describe('VaultPickupStatus — «حالة الاستلام»', () => {
  const AT = '2026-11-11T07:30:00.000Z';
  const pickup = (by: 'captain' | 'operations' | null) => (
    <VaultPickupStatus row={{ pickedUpBy: by, pickedUpAt: by === null ? null : AT }} />
  );

  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const by of VAULT_PICKUP_COLUMN) {
      it(`says ${by} in ${locale}, with its sentence on hover and for a screen reader`, () => {
        const labelKey = VAULT_PICKUP_LABEL[by];
        const hintKey = `operations.vault.queue.pickupHint.${by}`;
        expect(translate(locale, labelKey)).not.toBe(labelKey);
        expect(translate(locale, hintKey)).not.toBe(hintKey);
        const html = withLocale(locale, pickup(by === 'none' ? null : by));
        expect(html).toContain(`data-vault-pickup="${by}"`);
        expect(html).toContain(translate(locale, labelKey));
        expect(html).toContain(`title="${translate(locale, hintKey)}"`);
        expect(html).toContain('sr-only');
      });
    }
  }

  it('speaks the owner’s words: who collected it — or «لم يتم الاستلام»', () => {
    expect(withLocale('ar', pickup('captain'))).toContain('تم الاستلام من القائد');
    expect(withLocale('ar', pickup('operations'))).toContain('تم الاستلام من العمليات');
    expect(withLocale('ar', pickup(null))).toContain('لم يتم الاستلام');
  });

  // The boards' yellow for a pickup, with the van or the office; nobody is an absence, muted.
  it('wears the boards’ yellow for a pickup and a muted face for nobody', () => {
    expect(withLocale('ar', pickup('captain'))).toContain('bg-amber-100');
    expect(withLocale('ar', pickup('operations'))).toContain('bg-amber-100');
    const none = withLocale('ar', pickup(null));
    expect(none).toContain('!bg-transparent');
    expect(none).not.toContain('bg-amber-100');
    // The van and the office tell the two yellows apart without colour, as on the stage badge.
    const glyph = (html: string): string =>
      html.replace(/data-vault-pickup="[^"]*"/, '').replace(/title="[^"]*"/, '').replace(/>[^<]*</g, '><');
    expect(glyph(withLocale('ar', pickup('captain')))).not.toBe(
      glyph(withLocale('ar', pickup('operations'))),
    );
  });

  it('says when, under the badge — and no time for nobody', () => {
    expect(withLocale('ar', pickup('captain'))).toContain(`<time dateTime="${AT}"`);
    expect(withLocale('ar', pickup(null))).not.toContain('<time');
  });
});

describe('VaultHoldStatus — «حالة الخزينة»', () => {
  const AT = '2026-11-11T09:15:00.000Z';
  const hold = (status: OperationsShipmentStatus) => (
    <VaultHoldStatus row={{ status, vaultReceivedAt: status === 'draft' ? null : AT }} />
  );
  const STATUS_OF = {
    waiting: 'draft',
    inVault: 'inVault',
    dispatched: 'dispatched',
    completed: 'completed',
  } as const;

  for (const locale of ['en', 'ar'] as Locale[]) {
    for (const column of VAULT_HOLD_COLUMN) {
      it(`says ${column} in ${locale}`, () => {
        const labelKey = VAULT_HOLD_LABEL[column];
        expect(translate(locale, labelKey)).not.toBe(labelKey);
        const html = withLocale(locale, hold(STATUS_OF[column]));
        expect(html).toContain(`data-vault-hold="${column}"`);
        expect(html).toContain(translate(locale, labelKey));
        expect(html).not.toMatch(/operations\.(vault|board)\./);
      });
    }
  }

  it('speaks the owner’s words — «لم تُستلم بعد», «بالخزينة», «خرجت للتسليم», «تم التسليم»', () => {
    expect(withLocale('ar', hold('draft'))).toContain('لم تُستلم بعد');
    expect(withLocale('ar', hold('inVault'))).toContain('بالخزينة');
    expect(withLocale('ar', hold('dispatched'))).toContain('خرجت للتسليم');
    expect(withLocale('ar', hold('completed'))).toContain('تم التسليم');
  });

  it('wears the boards’ tones — green in the vault, blue on the road, green delivered', () => {
    expect(withLocale('ar', hold('inVault'))).toContain('bg-emerald-100');
    expect(withLocale('ar', hold('dispatched'))).toContain('bg-sky-100');
    expect(withLocale('ar', hold('completed'))).toContain('bg-emerald-100');
    expect(withLocale('ar', hold('draft'))).toContain('bg-slate-100');
  });

  // Every received row carries the vault's own time — on one gone out too, worded so it is not
  // read as the time it left.
  it('says when the vault received it, in words, on every received row — none on a draft', () => {
    for (const status of ['inVault', 'dispatched', 'completed'] as const) {
      const html = withLocale('ar', hold(status));
      expect(html).toContain(`<time dateTime="${AT}"`);
      expect(html).toContain(translate('ar', 'operations.vault.queue.receivedAt', { at: '' }).trim());
    }
    expect(withLocale('ar', hold('draft'))).not.toContain('<time');
  });
});
