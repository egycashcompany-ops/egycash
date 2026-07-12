// Locale-aware formatting helpers. Arabic uses the ar-EG locale (Arabic-Indic digits,
// RTL-friendly); English uses en-GB dates / en-US numbers. All helpers are null-safe and
// render an em-dash placeholder for missing values so tables/detail views stay tidy.
import { type Locale, type LocalizedString } from '@ecms/contracts';

const PLACEHOLDER = '—';

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
