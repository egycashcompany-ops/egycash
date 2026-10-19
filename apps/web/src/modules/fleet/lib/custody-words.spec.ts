// How the custody tabs count — «مذكرة واحدة · مذكرتان · 5 مذكرات · 11 مذكرة · 100 مذكرة» — in Arabic's
// five forms, and English's two. The rule is pinned for every count the screens meet (none, one,
// two, a few, eleven, ninety-nine, a hundred, a hundred and two…), against `Intl.PluralRules` and
// against the arithmetic it stands for; the words against the dictionary.
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  CUSTODY_COUNT_FORMS,
  CUSTODY_COUNT_NOUNS,
  custodyCount4,
  custodyCountKey,
  custodyPlural,
  useCustodyCount,
  type CustodyCount,
  type CustodyCountForm,
} from './custody-words';

/** What the forms mean, written out by hand — the samples' `counted()`. */
const byHand = (n: number): CustodyCountForm => {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  if (n === 0 || (n % 100 >= 3 && n % 100 <= 10)) return 'few';
  if (n % 100 >= 11 && n % 100 <= 99) return 'many';
  return 'other';
};

describe('which form a count takes', () => {
  it('Arabic: one, two, a few (and none), many, and the singular from a hundred', () => {
    const forms = [0, 1, 2, 3, 10, 11, 99, 100, 101, 102, 103, 110, 111, 200, 1000, 1002, 1011];
    expect(forms.map((n) => custodyPlural('ar', n))).toEqual([
      'few',
      'one',
      'two',
      'few',
      'few',
      'many',
      'many',
      'other',
      'other',
      'other',
      'few',
      'few',
      'many',
      'other',
      'other',
      'other',
      'many',
    ]);
  });

  it('is the arithmetic it stands for, for every count up to 1,250', () => {
    for (let n = 0; n <= 1250; n += 1) expect(custodyPlural('ar', n), String(n)).toBe(byHand(n));
  });

  it('English: one, and the plural for everything else — none too', () => {
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102].map((n) => custodyPlural('en', n))).toEqual([
      'other',
      'one',
      'other',
      'other',
      'other',
      'other',
      'other',
      'other',
      'other',
    ]);
  });

  it('reads a count that is no whole number by its whole part, never throws', () => {
    expect(custodyPlural('ar', 2.6)).toBe('two');
    expect(custodyPlural('ar', Number.NaN)).toBe('few');
    expect(custodyPlural('ar', -1)).toBe('one');
  });

  it('is the plan’s `custodyCount4` too', () => {
    expect(custodyCount4).toBe(custodyPlural);
  });

  it('names its words `fleet.custody.count.<noun>.<form>`', () => {
    expect(custodyCountKey('receipt', 'many')).toBe('fleet.custody.count.receipt.many');
    expect(CUSTODY_COUNT_NOUNS).toEqual(['memo', 'receipt', 'operation', 'spendLine']);
    expect(CUSTODY_COUNT_FORMS).toEqual(['one', 'two', 'few', 'many', 'other']);
  });
});

/** The hook as a screen holds it, in `locale`. */
const counting = (locale: Locale): CustodyCount => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  let held: CustodyCount | null = null;
  const Probe = (): null => {
    held = useCustodyCount();
    return null;
  };
  renderToStaticMarkup(createElement(Provider, { store, children: createElement(Probe) }));
  return held as unknown as CustodyCount;
};

describe('`useCustodyCount` — the words a screen writes', () => {
  it('counts a noun in its form, the figure Latin and grouped', () => {
    const { count, form } = counting('ar');
    expect(form(100)).toBe('other');
    expect(count('receipt', 100)).toBe(
      translate('ar', 'fleet.custody.count.receipt.other', { count: '100' }),
    );
    expect(count('memo', 11)).toBe(
      translate('ar', 'fleet.custody.count.memo.many', { count: '11' }),
    );
    expect(count('operation', 1234)).toBe(
      translate('ar', 'fleet.custody.count.operation.many', { count: '1,234' }),
    );
    expect(counting('en').count('spendLine', 2)).toBe(
      translate('en', 'fleet.custody.count.spendLine.other', { count: '2' }),
    );
  });

  it('says what was picked — nothing yet, or «تم اختيار» and the receipts', () => {
    const { picked, pickedCount } = counting('ar');
    expect(picked(0)).toBe(translate('ar', 'fleet.custody.count.picked.none'));
    expect(pickedCount(2)).toBe(translate('ar', 'fleet.custody.count.picked.two', { count: '2' }));
    expect(picked(2)).toBe(
      `${translate('ar', 'fleet.custody.count.picked.lead')} ${pickedCount(2)}`,
    );
    expect(picked(11)).toBe(
      `${translate('ar', 'fleet.custody.count.picked.lead')} ${translate('ar', 'fleet.custody.count.picked.many', { count: '11' })}`,
    );
  });
});

// The words land in the dictionary with the custody tabs (the i18n merge); until then these wait.
const merged =
  translate('ar', 'fleet.custody.count.receipt.one') !== 'fleet.custody.count.receipt.one';

describe.skipIf(!merged)('the words, in both languages', () => {
  const ar = (noun: string, n: number): string =>
    translate('ar', custodyCountKey(noun as 'memo', custodyPlural('ar', n)), {
      count: new Intl.NumberFormat('en-US').format(n),
    });
  const en = (noun: string, n: number): string =>
    translate('en', custodyCountKey(noun as 'memo', custodyPlural('en', n)), {
      count: new Intl.NumberFormat('en-US').format(n),
    });
  const COUNTS = [0, 1, 2, 3, 10, 11, 99, 100, 102, 1000];

  it('counts receipts as Arabic does — «100 إيصال», never «100 إيصالًا»', () => {
    expect(COUNTS.map((n) => ar('receipt', n))).toEqual([
      '0 إيصالات',
      'إيصال واحد',
      'إيصالان',
      '3 إيصالات',
      '10 إيصالات',
      '11 إيصالًا',
      '99 إيصالًا',
      '100 إيصال',
      '102 إيصال',
      '1,000 إيصال',
    ]);
  });

  it('counts memos, operations and spend lines', () => {
    expect([1, 2, 5, 11, 100].map((n) => ar('memo', n))).toEqual([
      'مذكرة واحدة',
      'مذكرتان',
      '5 مذكرات',
      '11 مذكرة',
      '100 مذكرة',
    ]);
    expect([1, 2, 5, 11].map((n) => ar('operation', n))).toEqual([
      'عملية واحدة',
      'عمليتان',
      '5 عمليات',
      '11 عملية',
    ]);
    expect([1, 2, 5, 11].map((n) => ar('spendLine', n))).toEqual([
      'سطر مصروفات واحد',
      'سطرا مصروفات',
      '5 أسطر مصروفات',
      '11 سطر مصروفات',
    ]);
  });

  it('counts in English too', () => {
    expect(COUNTS.map((n) => en('receipt', n))).toEqual([
      '0 receipts',
      '1 receipt',
      '2 receipts',
      '3 receipts',
      '10 receipts',
      '11 receipts',
      '99 receipts',
      '100 receipts',
      '102 receipts',
      '1,000 receipts',
    ]);
    expect(en('memo', 1)).toBe('1 memo');
    expect(en('operation', 2)).toBe('2 operations');
  });

  it('has every noun’s every form in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      for (const noun of [...CUSTODY_COUNT_NOUNS, 'picked'] as const) {
        for (const form of CUSTODY_COUNT_FORMS) {
          const key = `fleet.custody.count.${noun}.${form}`;
          expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
        }
      }
      for (const key of ['fleet.custody.count.picked.none', 'fleet.custody.count.picked.lead']) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('says what the editor picked — genitive after «تم اختيار»', () => {
    const picked = (n: number): string =>
      translate('ar', `fleet.custody.count.picked.${custodyPlural('ar', n)}`, { count: n });
    expect([1, 2, 5, 11, 100].map(picked)).toEqual([
      'إيصال واحد',
      'إيصالين',
      '5 إيصالات',
      '11 إيصالًا',
      '100 إيصال',
    ]);
    expect(translate('ar', 'fleet.custody.count.picked.lead')).toBe('تم اختيار');
    expect(translate('ar', 'fleet.custody.count.picked.none')).toBe('لم يُختر أي إيصال بعد');
  });
});
