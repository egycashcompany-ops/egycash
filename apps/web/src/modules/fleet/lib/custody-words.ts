// How the custody tabs count — «مذكرة واحدة · مذكرتان · 5 مذكرات · 11 مذكرة · 100 مذكرة» — as Arabic
// counts, in five forms (the samples' `counted()`, by `Intl.PluralRules('ar')`):
//   one    1                          «إيصال واحد»
//   two    2                          «إيصالان»
//   few    0, or n % 100 in 3..10     «5 إيصالات» (and «0 إيصالات»)
//   many   n % 100 in 11..99          «11 إيصالًا»
//   other  n % 100 in 0..2, n ≥ 100   «100 إيصال» — the singular, never «100 إيصالًا»
// English has «one» and «other» only. The words are i18n keys, `fleet.custody.count.<noun>.<form>`,
// with `{{count}}` for the figure (Latin digits, grouped).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';

export type CustodyCountForm = 'one' | 'two' | 'few' | 'many' | 'other';
export const CUSTODY_COUNT_FORMS: readonly CustodyCountForm[] = [
  'one',
  'two',
  'few',
  'many',
  'other',
];
export type CustodyCountNoun = 'memo' | 'receipt' | 'operation' | 'spendLine';
export const CUSTODY_COUNT_NOUNS: readonly CustodyCountNoun[] = [
  'memo',
  'receipt',
  'operation',
  'spendLine',
];

/** The figure in a count: Latin digits, grouped — as every figure on the boards. */
const LATIN = new Intl.NumberFormat('en-US');

/** The same five forms by arithmetic — where a runtime's `Intl` has no Arabic rules. */
const arabicByHand = (n: number): CustodyCountForm => {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const tail = n % 100;
  if (n === 0 || (tail >= 3 && tail <= 10)) return 'few';
  if (tail >= 11 && tail <= 99) return 'many';
  return 'other';
};

const arabicRules = ((): Intl.PluralRules | null => {
  try {
    const rules = new Intl.PluralRules('ar');
    return rules.resolvedOptions().locale.startsWith('ar') ? rules : null;
  } catch {
    return null;
  }
})();

/**
 * Which form a count takes. `Intl.PluralRules('ar')` names Arabic's own categories; its «zero»
 * reads as «few» («0 إيصالات»), as the boards already count nothing. A count that is not a whole
 * number of things (it never should be) is read by its whole part.
 */
export const custodyPlural = (locale: Locale, n: number): CustodyCountForm => {
  const whole = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;
  if (locale !== 'ar') return whole === 1 ? 'one' : 'other';
  if (arabicRules === null) return arabicByHand(whole);
  const category = arabicRules.select(whole);
  return category === 'zero' ? 'few' : (category as CustodyCountForm);
};
/** The plan's name for the same rule. */
export const custodyCount4 = custodyPlural;

/** The count's key: `fleet.custody.count.<noun>.<form>`. */
export const custodyCountKey = (noun: CustodyCountNoun, form: CustodyCountForm): string =>
  `fleet.custody.count.${noun}.${form}`;

export interface CustodyCount {
  /** «مذكرة واحدة», «مذكرتان», «5 مذكرات», «11 مذكرة», «100 مذكرة». */
  count: (noun: CustodyCountNoun, n: number) => string;
  /**
   * The editor's foot: «لم يُختر أي إيصال بعد» for none, else «تم اختيار إيصالين» — the receipts
   * after «تم اختيار» (genitive: «إيصالين», «11 إيصالًا»).
   */
  picked: (n: number) => string;
  /** Only the receipts of `picked` — «إيصالين» — for a screen that colours them apart. */
  pickedCount: (n: number) => string;
  /** The form `n` takes in the reader's language. */
  form: (n: number) => CustodyCountForm;
}

export const useCustodyCount = (): CustodyCount => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const form = (n: number): CustodyCountForm => custodyPlural(locale, n);
  const pickedCount = (n: number): string =>
    t(`fleet.custody.count.picked.${form(n)}`, { count: LATIN.format(n) });
  return {
    form,
    count: (noun, n) => t(custodyCountKey(noun, form(n)), { count: LATIN.format(n) }),
    pickedCount,
    picked: (n) =>
      n <= 0
        ? t('fleet.custody.count.picked.none')
        : `${t('fleet.custody.count.picked.lead')} ${pickedCount(n)}`,
  };
};
