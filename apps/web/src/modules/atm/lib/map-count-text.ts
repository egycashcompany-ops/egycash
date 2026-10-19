// Machine counts in words (docs/12-planning/atm-map-zones.md DM-21) — «لا ماكينات / ماكينة واحدة /
// ماكينتان / n ماكينات / n ماكينة», the approved mockup's five forms.
//
// THE RULE. 0, 1 and 2 have their own forms. «n ماكينات» when n ≥ 3 and n % 100 is 3–10 (3, 10, 103,
// 1003); «n ماكينة» for every other n (11, 100, 101, 102, 111). Up to 100 that is the mockup's own
// `countText`; above it the rule follows the Arabic plural categories. They are five plain keys, so
// no plural engine is needed — English simply says the same thing twice.
import { type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type MachineCountForm = 'zero' | 'one' | 'two' | 'few' | 'many';

export const machineCountForm = (n: number): MachineCountForm => {
  if (n === 0) return 'zero';
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const lastTwo = n % 100;
  return lastTwo >= 3 && lastTwo <= 10 ? 'few' : 'many';
};

export const machineCountText = (n: number, t: Translate, locale: Locale): string =>
  t(`atm.map.count.${machineCountForm(n)}`, { count: formatNumber(n, locale) });

/**
 * The bare count on a zone's map label «● name · count» (§8.9), in the UI's own digits — the
 * mockup's `D.ar(n)` (`Main.dc.html:340`), as the cluster bubbles beside it.
 */
export const zoneLabelCountText = (n: number, locale: Locale): string => formatNumber(n, locale);
