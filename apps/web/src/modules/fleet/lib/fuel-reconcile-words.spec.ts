// «مطابقة أرصدة الكروت» — how the screen counts (the custody boards' five Arabic forms), and what it
// says, in its own words, when the server refuses a sheet or a decision.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ErrorCodes, type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import {
  RECONCILE_COUNT_NOUNS,
  addCardRefusalWords,
  cancelRefusalKey,
  decideRefusalOf,
  linkRefusalWords,
  isDecideRefusal,
  isSheetRefusal,
  reconcileCountKey,
  sheetRefusalOf,
  useReconcileCount,
  type ReconcileCount,
} from './fuel-reconcile-words';

/** The hook, read once under a store in `locale`. */
const countIn = (locale: Locale): ReconcileCount => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  let count: ReconcileCount | null = null;
  const Probe = (): null => {
    count = useReconcileCount();
    return null;
  };
  renderToStaticMarkup(createElement(Provider, { store, children: createElement(Probe) }));
  return count as unknown as ReconcileCount;
};

describe('counting cards and rows', () => {
  const ar = countIn('ar');

  it('says a number of cards as the custody boards say memos', () => {
    expect([1, 2, 5, 11, 100, 0].map(ar.cards)).toEqual([
      'كارت واحد',
      'كارتان',
      '5 كروت',
      '11 كارتًا',
      '100 كارت',
      '0 كروت',
    ]);
    expect(ar.cards(1200)).toBe('1,200 كارت');
    expect(ar.cards(1250)).toBe('1,250 كارتًا');
  });

  it('after «تم اختيار», «تعديل» and «في» the card takes the genitive — «كارتين»', () => {
    expect(ar.cardsOf(2)).toBe('كارتين');
    expect(ar.cardsOf(19)).toBe('19 كارتًا');
    expect(translate('ar', 'fleet.fuelCards.reconcile.selected', { count: ar.cardsOf(2) })).toBe(
      'تم اختيار كارتين',
    );
    expect(translate('ar', 'fleet.fuelCards.reconcile.selected', { count: ar.cardsOf(5) })).toBe(
      'تم اختيار 5 كروت',
    );
  });

  it('the noun alone for a box that writes the figure apart; rows, repeated rows, times', () => {
    expect([16, 200, 2].map(ar.cardsNoun)).toEqual(['كارتًا', 'كارت', 'كارتان']);
    expect([223, 200, 7].map(ar.rows)).toEqual(['223 صفًّا', '200 صف', '7 صفوف']);
    expect([5, 11].map(ar.repeatedRows)).toEqual(['5 صفوف مكررة', '11 صفًّا مكررًا']);
    expect([2, 3].map(ar.times)).toEqual(['مرتين', '3 مرات']);
  });

  it('English keeps its two forms', () => {
    const en = countIn('en');
    expect([1, 2, 16].map(en.cards)).toEqual(['1 card', '2 cards', '16 cards']);
    expect(en.rows(1)).toBe('1 row');
  });

  it('every form of every noun is written in both languages', () => {
    for (const noun of RECONCILE_COUNT_NOUNS) {
      for (const form of ['one', 'two', 'few', 'many', 'other'] as const) {
        const key = reconcileCountKey(noun, form);
        expect(translate('ar', key), key).not.toBe(key);
        expect(translate('en', key), key).not.toBe(key);
      }
    }
  });
});

describe('a refused sheet, in the screen’s words', () => {
  const said = (error: unknown): string | null => {
    const words = sheetRefusalOf(error);
    return words === null ? null : translate('ar', words.key, words.values);
  };

  it('names the columns the sheet lacks', () => {
    const error = new ApiError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 'x', 422, [
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Name' },
      { field: 'file', code: 'MISSING_HEADER', message: 'Card Balance' },
    ]);
    expect(said(error)).toBe('لا يحتوي الشيت على الأعمدة: Card Name · Card Balance');
  });

  it('an unreadable file, one too large, one too long to read, a missing file', () => {
    const unreadable = translate('ar', 'fleet.fuelCards.reconcile.error.unreadable');
    expect(
      said(
        new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 422, [
          { field: 'file', code: 'UNREADABLE', message: 'x' },
        ]),
      ),
    ).toBe(unreadable);
    expect(
      said(
        new ApiError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 'x', 422, [
          { field: 'file', code: 'MISSING_SHEET', message: 'x' },
        ]),
      ),
    ).toBe(unreadable);
    expect(
      said(
        new ApiError(ErrorCodes.FILE_TOO_LARGE, 'x', 422, [
          { field: 'file', code: 'TOO_LARGE', message: '10 MB' },
        ]),
      ),
    ).toBe('حجم الملف أكبر من 10 ميجابايت');
    expect(
      said(
        new ApiError(ErrorCodes.FLEET_FUEL_SHEET_LAYOUT, 'x', 422, [
          { field: 'file', code: 'TOO_LARGE', message: 'rows' },
        ]),
      ),
    ).toBe(translate('ar', 'fleet.fuelCards.reconcile.error.tooMuch'));
    expect(
      said(
        new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 400, [
          { field: 'file', code: 'REQUIRED', message: 'x' },
        ]),
      ),
    ).toBe('ارفع شيت الأرصدة أولًا');
  });

  it('leaves everything else to the usual toast', () => {
    const company = new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 400, [
      { field: 'body.company', code: 'invalid', message: 'x' },
    ]);
    expect(isSheetRefusal(company)).toBe(false);
    expect(isSheetRefusal(new ApiError('INTERNAL', 'x', 500))).toBe(false);
    expect(isSheetRefusal(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('a refused decision', () => {
  it('a card that moved after the read, or one already decided — with the cards named', () => {
    const moved = new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'x', 409, [
      { field: 'cardIds', code: 'CARD_CHANGED', message: 'A1' },
    ]);
    const decided = new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'x', 409, [
      { field: 'cardIds', code: 'DECIDED', message: 'b2' },
      { field: 'cardIds', code: 'DECIDED', message: 'c3' },
    ]);
    expect(decideRefusalOf(moved)).toEqual({ kind: 'moved', cardIds: ['a1'] });
    expect(decideRefusalOf(decided)).toEqual({ kind: 'decided', cardIds: ['b2', 'c3'] });
    expect(isDecideRefusal(new ApiError(ErrorCodes.VALIDATION_FAILED, 'x', 400))).toBe(false);
  });
});

// ── Batch 3 ─────────────────────────────────────────────────────────────────────────────────────

describe('6a: a refused cancel, in the screen’s words', () => {
  const cancel = (code: string): ApiError =>
    new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CANCEL_REFUSED, 'x', 422, [
      { field: 'cancelCharges', code, message: '650000000000000000000001' },
    ]);

  it('not a candidate, already cancelled, more than the sheet takes off — each said', () => {
    const said = (code: string): string => {
      const refusal = decideRefusalOf(cancel(code));
      expect(refusal?.kind).toBe('cancel');
      return translate('ar', cancelRefusalKey(refusal?.code));
    };
    expect(said('NOT_A_CANDIDATE')).toBe(
      translate('ar', 'fleet.fuelCards.reconcile.refusal.cancelNotCandidate'),
    );
    expect(said('CANCELLED')).toBe(
      translate('ar', 'fleet.fuelCards.reconcile.refusal.cancelCancelled'),
    );
    expect(said('EXCEEDS_DIFFERENCE')).toBe(
      translate('ar', 'fleet.fuelCards.reconcile.refusal.cancelExceeds'),
    );
    for (const code of ['NOT_A_CANDIDATE', 'CANCELLED', 'EXCEEDS_DIFFERENCE']) {
      expect(said(code)).not.toMatch(/^fleet\./u);
    }
    // The screen says it, so the global toast stays quiet.
    expect(isDecideRefusal(cancel('CANCELLED'))).toBe(true);
  });

  it('a request that changed after the read is the same 409 — read the sheet again', () => {
    const changed = new ApiError(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'x', 409, [
      { field: 'cardIds', code: 'REQUEST_CHANGED', message: 'A1' },
    ]);
    expect(decideRefusalOf(changed)).toEqual({ kind: 'moved', cardIds: ['a1'] });
  });
});

describe('6b: a refused link or «إضافة», in the screen’s words', () => {
  const refused = (code: string, detail: string, field = 'cardIds', status = 409): ApiError =>
    new ApiError(code, 'x', status, [{ field, code: detail, message: 'A1' }]);
  const said = (words: { key: string } | null): string | null =>
    words === null ? null : translate('ar', words.key);

  it('a changed card, one decided, a held slot, the repair, a missing pick', () => {
    const R = 'fleet.fuelCards.reconcile.refusal.';
    expect(
      said(linkRefusalWords(refused(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'LINK_CHANGED'))),
    ).toBe(translate('ar', `${R}linkChanged`));
    expect(
      said(linkRefusalWords(refused(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'DECIDED'))),
    ).toBe(translate('ar', `${R}linkDecided`));
    expect(said(linkRefusalWords(refused(ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD, 'SLOT_HELD')))).toBe(
      translate('ar', `${R}slotHeld`),
    );
    expect(said(linkRefusalWords(refused(ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR, 'IN_REPAIR')))).toBe(
      translate('ar', `${R}inRepair`),
    );
    expect(
      said(linkRefusalWords(refused(ErrorCodes.VALIDATION_FAILED, 'REQUIRED', 'body.pick', 400))),
    ).toBe(translate('ar', `${R}pickRequired`));
    expect(linkRefusalWords(new ApiError('INTERNAL', 'x', 500))).toBeNull();
  });

  it('«إضافة»: the number missing, not the sheet’s, or the row already added', () => {
    const R = 'fleet.fuelCards.reconcile.refusal.';
    const number = (code: string): ApiError =>
      new ApiError(ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER, 'x', 422, [
        { field: 'number', code, message: 'number' },
      ]);
    expect(said(addCardRefusalWords(number('REQUIRED')))).toBe(
      translate('ar', `${R}numberRequired`),
    );
    expect(said(addCardRefusalWords(number('MISMATCH')))).toBe(
      translate('ar', `${R}numberMismatch`),
    );
    expect(
      said(addCardRefusalWords(refused(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'DECIDED'))),
    ).toBe(translate('ar', `${R}cardAdded`));
    expect(addCardRefusalWords(new ApiError(ErrorCodes.DUPLICATE, 'x', 409))).toBeNull();
  });
});
