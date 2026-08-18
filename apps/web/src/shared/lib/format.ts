// Locale-aware formatting helpers. Arabic uses the ar-EG locale (Arabic-Indic digits,
// RTL-friendly); English uses en-GB dates / en-US numbers. All helpers are null-safe and
// render an em-dash placeholder for missing values so tables/detail views stay tidy.
import {
  NATIONALITY_LABELS,
  findGovernorate,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';

// Re-exported so a call site that formats also gets the digit fold from one place; the
// implementation lives in contracts, beside the rules that depend on it.
export { asciiDigits } from '@ecms/contracts';

const PLACEHOLDER = '—';

/** The HR business calendar (Leave design R10) — see `formatBusinessDateTime`. */
const CAIRO_TZ = 'Africa/Cairo';

const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG' : 'en-GB');
const numberLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG' : 'en-US');

/**
 * The locale MONEY is formatted in. Arabic keeps ar-EG for everything a locale decides — the
 * currency symbol, its side, the RTL marks — but pins the numbering system to Latin digits.
 *
 * `ar-EG` alone renders ١٬٠٠٠ : Arabic-Indic digits grouped with U+066C, a mark so light that in
 * most UI fonts the figure reads as ١٠٠٠ — an unseparated four-digit number. On a cash-transfer
 * desk, where the amount IS the record, that is the one figure that must never be misread. The
 * legacy screens grouped every amount with an ASCII comma
 * (`replace(/\B(?=(\d{3})+(?!\d))/g, ',')`, main_ops.ejs:874 and 41 more) and never rendered a
 * tabular amount in Arabic-Indic, so this is the legacy reading restored, not a new house style.
 *
 * Counts keep `numberLocale` and stay Arabic-Indic: they are small, they are not the record, and
 * legacy left them alone too.
 */
const moneyLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US');

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};

export const localized = (value: LocalizedString, locale: Locale): string => value[locale];

export const formatDate = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null ? PLACEHOLDER : new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' }).format(d);
};

export const formatDateTime = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null
    ? PLACEHOLDER
    : new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};

/**
 * The company's business calendar is Africa/Cairo (Leave design R10), so a moment that a rule or
 * an audit trail cares about — when a round was actually started — must read the same to every
 * user. `formatDateTime` follows the BROWSER's timezone; this one does not, which is why the
 * recruitment screens use it for workflow timestamps.
 */
export const formatBusinessDateTime = (
  value: string | Date | null | undefined,
  locale: Locale,
): string => {
  const d = toDate(value);
  return d === null
    ? PLACEHOLDER
    : new Intl.DateTimeFormat(intlLocale(locale), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: CAIRO_TZ,
      }).format(d);
};

export const formatNumber = (value: number | null | undefined, locale: Locale): string =>
  value === null || value === undefined ? PLACEHOLDER : new Intl.NumberFormat(numberLocale(locale)).format(value);

export const formatMoney = (
  amount: number | null | undefined,
  currency: string,
  locale: Locale,
): string =>
  amount === null || amount === undefined
    ? PLACEHOLDER
    : new Intl.NumberFormat(moneyLocale(locale), { style: 'currency', currency }).format(amount);

/**
 * A monetary figure with NO ISO currency code to hand — grouped, Latin digits, and nothing else.
 *
 * `formatMoney` needs a code like `EGP` to place a symbol. Two surfaces have none and cannot get
 * one: Operations carries the currency as a free-text NAME (the legacy singleton stored a string
 * array, quirk Q33) and renders it in its own cell beside the figure, and IT's purchase/repair
 * costs are bare numbers on the contract. They are money all the same and must group like money —
 * which is exactly what got lost when they reached for `formatNumber`, the counts formatter.
 *
 * Decimals are shown only when the value has them, which is what the legacy screens did: 1000
 * reads `1,000`, not `1,000.00`.
 */
export const formatAmount = (value: number | null | undefined, locale: Locale): string =>
  value === null || value === undefined
    ? PLACEHOLDER
    : new Intl.NumberFormat(moneyLocale(locale), { maximumFractionDigits: 2 }).format(value);

/** Pick the caller's locale rendering of a bilingual name pair. */
export const fullName = (
  name: { firstName: LocalizedString; lastName: LocalizedString },
  locale: Locale,
): string => `${name.firstName[locale]} ${name.lastName[locale]}`.trim();


/**
 * Nationality and governorate are STORED canonically (English) so the National-ID decode, the OCR
 * read and a hand-picked value are one string — but an Arabic reader should never be shown
 * "Egyptian" or "Cairo". These render the stored value in the reader's language, falling back to
 * the raw value for anything the catalog does not know.
 */
export const nationalityLabel = (value: string | null | undefined, locale: Locale): string => {
  if (value === null || value === undefined || value.trim() === '') return PLACEHOLDER;
  const label = NATIONALITY_LABELS[value.trim()];
  return label === undefined ? value : label[locale];
};

export const governorateLabel = (value: string | null | undefined, locale: Locale): string => {
  if (value === null || value === undefined || value.trim() === '') return PLACEHOLDER;
  const found = findGovernorate(value);
  return found === undefined ? value : found[locale];
};
