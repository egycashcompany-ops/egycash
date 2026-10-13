// The register's vocabulary in the reader's language — shared by the register page (WP-C), the
// Data Report (WP-D) and the import page (WP-B), so the three cannot name a bank, a branch or a
// status differently. Bank and branch names come from the contracts (the workbook's own Arabic,
// D7); everything else is a translation key.
import {
  ATM_BANK_NAMES,
  ATM_REGISTER_BRANCH_NAMES,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterField,
  type AtmRegisterStatus,
  type Locale,
} from '@ecms/contracts';

const PLACEHOLDER = '—';
const CAIRO_TZ = 'Africa/Cairo';

export const bankName = (code: AtmBankCode, locale: Locale): string => ATM_BANK_NAMES[code][locale];

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
 * calendar day of the server's `generatedAt` (computation time = data time).
 */
export const formatAsOf = (generatedAt: string, locale: Locale): string => {
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return PLACEHOLDER;
  const parts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: CAIRO_TZ,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} / ${part('month')} / ${part('year')}`;
};
