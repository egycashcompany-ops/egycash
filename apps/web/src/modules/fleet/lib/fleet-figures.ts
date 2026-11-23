// Fleet's figures in Latin digits, in Arabic as in English — owner, 2026-11-23:
// «اى ارقام خليها بالانجلش حتى لو عربى» / «انا عاوزك تعدل حاجات الحركة فقط». Twins of the shared
// formatNumber / formatDate / formatDateTime (same options, same «—», English byte-identical);
// only the Arabic numbering system is Latin. The shared helpers keep every other module's digits.
import { type Locale } from '@ecms/contracts';

const PLACEHOLDER = '—';
const NUMBER = new Intl.NumberFormat('en-US'); // = shared formatNumber's English
const DATE: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }),
};
const DATE_TIME: Record<Locale, Intl.DateTimeFormat> = {
  ar: new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }),
  en: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
};
const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};
export const latinNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? PLACEHOLDER : NUMBER.format(value);
export const latinDate = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null ? PLACEHOLDER : DATE[locale].format(d);
};
export const latinDateTime = (value: string | Date | null | undefined, locale: Locale): string => {
  const d = toDate(value);
  return d === null ? PLACEHOLDER : DATE_TIME[locale].format(d);
};
