// «مطابقة أرصدة الكروت» — how the screen counts, and what it says when the server refuses.
//
// Counting follows the custody boards' rule (`custodyPlural`: Arabic's five forms, English's two):
// «كارت واحد · كارتان · 5 كروت · 11 كارتًا · 100 كارت», and «0 كروت». After «تم اختيار», «تعديل» and
// «في» the card takes the genitive — «كارتين». The words are i18n keys,
// `fleet.fuelCards.reconcile.count.<noun>.<form>`, with `{{count}}` for the figure (Latin, grouped).
//
// Refusals: a sheet the server cannot read, and a decision it refuses (a card that moved after the
// read, one already decided), are worded here — the screen raises them itself, so the global toast
// (which would show the server's English sentence for these codes) is left only what is unnamed.
import { ErrorCodes, FLEET_FUEL_SHEET_MAX_MB, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { custodyPlural, type CustodyCountForm } from './custody-words';
import { decidedCardIds, movedCardIds } from './fuel-reconcile';

export type ReconcileCountNoun = 'card' | 'cardOf' | 'cardUnit' | 'row' | 'repeatedRow' | 'times';
export const RECONCILE_COUNT_NOUNS: readonly ReconcileCountNoun[] = [
  'card',
  'cardOf',
  'cardUnit',
  'row',
  'repeatedRow',
  'times',
];

/** The count's key: `fleet.fuelCards.reconcile.count.<noun>.<form>`. */
export const reconcileCountKey = (noun: ReconcileCountNoun, form: CustodyCountForm): string =>
  `fleet.fuelCards.reconcile.count.${noun}.${form}`;

const LATIN = new Intl.NumberFormat('en-US');

export interface ReconcileCount {
  /** «كارت واحد» · «كارتان» · «5 كروت» · «16 كارتًا» · «200 كارت». */
  cards: (n: number) => string;
  /** The genitive: «تم اختيار كارتين», «تعديل 5 كروت», «في 19 كارتًا». */
  cardsOf: (n: number) => string;
  /** The noun alone, for a box that writes the figure apart: «16» «كارتًا». */
  cardsNoun: (n: number) => string;
  /** «223 صفًّا» · «200 صف». */
  rows: (n: number) => string;
  /** «5 صفوف مكررة» · «11 صفًّا مكررًا». */
  repeatedRows: (n: number) => string;
  /** «مرتين» · «3 مرات». */
  times: (n: number) => string;
}

export const useReconcileCount = (): ReconcileCount => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const say =
    (noun: ReconcileCountNoun) =>
    (n: number): string =>
      t(reconcileCountKey(noun, custodyPlural(locale, n)), { count: LATIN.format(n) });
  return {
    cards: say('card'),
    cardsOf: say('cardOf'),
    cardsNoun: say('cardUnit'),
    rows: say('row'),
    repeatedRows: say('repeatedRow'),
    times: say('times'),
  };
};

/** A refusal's words: the key and what fills it. */
export interface ReconcileWords {
  key: string;
  values?: Record<string, string | number>;
}

const fileDetails = (error: ApiError): { code: string; message: string }[] =>
  (error.details ?? []).filter((detail) => detail.field === 'file');

/**
 * What the screen says when the sheet is refused — the columns it lacks, a file it cannot read,
 * a sheet too large — or `null` for a failure it leaves to the global toast.
 */
export const sheetRefusalOf = (error: unknown): ReconcileWords | null => {
  if (!(error instanceof ApiError)) return null;
  const details = fileDetails(error);
  if (error.code === ErrorCodes.FILE_TOO_LARGE) {
    return { key: 'fleet.fuelCards.reconcile.error.tooLarge', values: { mb: FLEET_FUEL_SHEET_MAX_MB } };
  }
  if (error.code === ErrorCodes.FLEET_FUEL_SHEET_LAYOUT) {
    const missing = details.filter((detail) => detail.code === 'MISSING_HEADER');
    if (missing.length > 0) {
      return {
        key: 'fleet.fuelCards.reconcile.error.layout',
        values: { columns: missing.map((detail) => detail.message).join(' · ') },
      };
    }
    if (details.some((detail) => detail.code === 'TOO_LARGE')) {
      return {
        key: 'fleet.fuelCards.reconcile.error.tooLarge',
        values: { mb: FLEET_FUEL_SHEET_MAX_MB },
      };
    }
    return { key: 'fleet.fuelCards.reconcile.error.unreadable' };
  }
  if (error.code === ErrorCodes.VALIDATION_FAILED && details.length > 0) {
    return details.some((detail) => detail.code === 'REQUIRED')
      ? { key: 'fleet.fuelCards.reconcile.compareNeedsFile' }
      : { key: 'fleet.fuelCards.reconcile.error.unreadable' };
  }
  return null;
};
/** The upload's failures the screen words itself (`toastUnlessSaid`). */
export const isSheetRefusal = (error: unknown): boolean => sheetRefusalOf(error) !== null;

/** A refused decision: the cards that moved after the read, or that were already decided. */
export interface DecideRefusal {
  kind: 'moved' | 'decided';
  cardIds: string[];
}
export const decideRefusalOf = (error: unknown): DecideRefusal | null => {
  const moved = movedCardIds(error);
  if (moved.length > 0) return { kind: 'moved', cardIds: moved };
  const decided = decidedCardIds(error);
  if (decided.length > 0) return { kind: 'decided', cardIds: decided };
  return null;
};
/** The decision's failures the screen words itself (`toastUnlessSaid`). */
export const isDecideRefusal = (error: unknown): boolean => decideRefusalOf(error) !== null;
