// «الضمان» on the asset register — the assets whose warranty ends within so many days from today
// (the list's `warrantyEndsWithinDays`). It exists because the `/it` dashboard's «ضمان ينتهي خلال
// ٣٠ يومًا» row opens the register narrowed to exactly those assets, and a row that opens a list
// the list cannot show would be a number nobody can check.
//
// The dashboard's window is the `it.warrantyWarnDays` setting (30 by default), so a link can
// carry a window the bar does not offer; it is then offered beside the two the bar always has,
// rather than shown as «الكل» while the register is in fact narrowed.
import { type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { custodyPlural } from '../../fleet/lib/custody-words';
import { type Translate } from './register-export';

/** The windows the bar always offers — «ينتهي خلال ٣٠ يومًا / خلال ٩٠ يومًا». */
export const WARRANTY_WINDOWS: readonly number[] = [30, 90];

/** The API's own bounds (`ListItAssetsQuerySchema.warrantyEndsWithinDays`). */
const MIN_DAYS = 1;
const MAX_DAYS = 365;

/**
 * The URL's window, or null for none. Anything the API would refuse — an edited link, «abc», 0,
 * 400 — is no filter at all rather than a register that fails to load.
 */
export const warrantyWindowOf = (raw: string | null): number | null => {
  if (raw === null || !/^\d{1,3}$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return days >= MIN_DAYS && days <= MAX_DAYS ? days : null;
};

/** The bar's options: the two it always has, and a linked window beside them, in order. */
export const warrantyWindowOptions = (current: number | null): number[] =>
  [...new Set([...WARRANTY_WINDOWS, ...(current === null ? [] : [current])])].sort((a, b) => a - b);

/**
 * «ينتهي خلال ٣٠ يومًا» — the window in the reader's words, the noun counted as Arabic counts it
 * («يوم واحد · يومين · ٥ أيام · ٣٠ يومًا · ١٠٠ يوم»), the figure in the app's digits.
 */
export const warrantyWithin = (t: Translate, locale: Locale, days: number): string =>
  t(`it.assets.warranty.endsWithin.${custodyPlural(locale, days)}`, {
    days: formatNumber(days, locale),
  });
