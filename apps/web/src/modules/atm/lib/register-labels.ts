// The register's vocabulary in the reader's language — shared by the register page (WP-C), the
// Data Report (WP-D) and the import page (WP-B), so the three cannot name a bank, a branch or a
// status differently. Branch names come from the contracts (the workbook's own Arabic, D7); bank
// names from the bank catalog (DEC-35) when the caller holds it; everything else is a translation
// key.
import {
  ATM_REGISTER_BRANCH_NAMES,
  atmBankName,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterField,
  type AtmRegisterStatus,
  type Locale,
  type LocalizedString,
} from '@ecms/contracts';

const PLACEHOLDER = '—';
const CAIRO_TZ = 'Africa/Cairo';

/**
 * A bank's name: the catalog's, when the caller passes it (the register meta's banks, the Data
 * Report's, a lookup's `ordered`), else the seed's, else the code. A bank added at runtime is a
 * full register bank (the owner's call), so this can no longer be a fixed table of six: without the
 * catalog a seventh bank reads as its code — never as a blank, never as a crash.
 */
export const bankName = (
  code: AtmBankCode,
  locale: Locale,
  banks?: readonly { code: AtmBankCode; name: LocalizedString }[],
): string => atmBankName(code, locale, banks);

/** The sheet's branch name for an `EGYCASH-n` code (ATMs DE1..DK1). */
export const branchLabel = (code: AtmRegisterBranchCode, locale: Locale): string =>
  ATM_REGISTER_BRANCH_NAMES[code][locale];

export const statusLabelKey = (status: AtmRegisterStatus): string =>
  `atm.register.status.${status}`;

/** `atm.register.col.<field>` — the grid header, the form label and the i18n spec's census. */
export const columnHeaderKey = (field: AtmRegisterField): string => `atm.register.col.${field}`;

/**
 * A register date (`YYYY-MM-DD`, a calendar day — never an instant) as day/month/year. Read as
 * text, not through `Date`, so no timezone can move it a day.
 */
export const formatRegisterDate = (iso: string | null): string => {
  if (iso === null) return PLACEHOLDER;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match === null ? iso : `${match[3] ?? ''}/${match[2] ?? ''}/${match[1] ?? ''}`;
};

/**
 * The Data Report's as-of stamp — the Excel's U2 format `dd / MMMM / yyyy` (D7), on the Cairo
 * calendar day of the server's `generatedAt` (computation time = data time). Latin digits in both
 * languages, like every count on the page (`reportCount`) and like the sheet's own U2, whose
 * format carries no numeral system: an Arabic-Indic date above Latin counts read as two systems
 * (review finding WEB-5). The month stays in the reader's language.
 */
export const formatAsOf = (generatedAt: string, locale: Locale): string => {
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return PLACEHOLDER;
  const parts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    timeZone: CAIRO_TZ,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} / ${part('month')} / ${part('year')}`;
};
