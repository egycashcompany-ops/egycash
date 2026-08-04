// Locale-aware formatting helpers. Arabic uses the ar-EG locale (Arabic-Indic digits,
// RTL-friendly); English uses en-GB dates / en-US numbers. All helpers are null-safe and
// render an em-dash placeholder for missing values so tables/detail views stay tidy.
import {
  NATIONALITY_LABELS,
  findGovernorate,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';

const PLACEHOLDER = '—';

/** The HR business calendar (Leave design R10) — see `formatBusinessDateTime`. */
const CAIRO_TZ = 'Africa/Cairo';

const intlLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG' : 'en-GB');
const numberLocale = (locale: Locale): string => (locale === 'ar' ? 'ar-EG' : 'en-US');

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
    : new Intl.NumberFormat(numberLocale(locale), { style: 'currency', currency }).format(amount);

/** Pick the caller's locale rendering of a bilingual name pair. */
export const fullName = (
  name: { firstName: LocalizedString; lastName: LocalizedString },
  locale: Locale,
): string => `${name.firstName[locale]} ${name.lastName[locale]}`.trim();

/**
 * Fold Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to ASCII — code inputs
 * accept only ASCII, and an Arabic keyboard produces ٠١٢ for what the user reads as 012.
 */
export const asciiDigits = (value: string): string =>
  value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    const base = cp >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(cp - base);
  });

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
