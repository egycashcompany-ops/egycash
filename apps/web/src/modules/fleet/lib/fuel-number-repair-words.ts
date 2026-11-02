// «تصحيح أرقام الكروت» (6d) — how the screen counts and lists. Cards are counted with the
// reconcile screen's own words (`useReconcileCount`: «كارتان · 4 كروت · 17 كارتًا»); the numbers
// («رقم واحد · رقمان · 5 أرقام · 15 رقمًا») follow the same five Arabic forms (`custodyPlural`), as
// i18n keys `fleet.fuelCards.numberRepair.count.<noun>.<form>` with `{{count}}` for the figure. A
// list of cars is joined the way the language joins one («284 و269 و230» · «284, 269, 230»).
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { custodyPlural, type CustodyCountForm } from './custody-words';

export const N = 'fleet.fuelCards.numberRepair.';

export type RepairCountNoun = 'number' | 'numberUnit';
export const REPAIR_COUNT_NOUNS: readonly RepairCountNoun[] = ['number', 'numberUnit'];

/** The count's key: `fleet.fuelCards.numberRepair.count.<noun>.<form>`. */
export const repairCountKey = (noun: RepairCountNoun, form: CustodyCountForm): string =>
  `${N}count.${noun}.${form}`;

const LATIN = new Intl.NumberFormat('en-US');

export interface RepairWords {
  /** «رقم واحد» · «رقمان» · «5 أرقام» · «15 رقمًا». */
  numbers: (n: number) => string;
  /** The noun alone, for a box that writes the figure apart: «5» «أرقام». */
  numbersNoun: (n: number) => string;
  /** «284 و269 و230». */
  list: (items: readonly string[]) => string;
}

export const useRepairWords = (): RepairWords => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const say =
    (noun: RepairCountNoun) =>
    (n: number): string =>
      t(repairCountKey(noun, custodyPlural(locale, n)), { count: LATIN.format(n) });
  return {
    numbers: say('number'),
    numbersNoun: say('numberUnit'),
    list: (items) => items.join(t(`${N}and`)),
  };
};
