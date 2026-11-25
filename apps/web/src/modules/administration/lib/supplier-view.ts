// How the supplier screens show a supplier (design §6.8, §11.5, §13.6 B): pure, so a spec proves
// each rule without a browser.
//
//   • A PHONE IS MASKED IN THE REGISTER (§6.8: phones are PII, masked in lists and never in a URL),
//     in the shape the security architecture writes for a list view — the first three digits and
//     the last four, every other digit a star (`298*******4567`). The record's own page shows it
//     whole: that is the page a reader opens to call the supplier.
//   • A PAPER'S SCAN STATE decides what it offers (§11.5): a clean or unscanned file opens; one
//     still being scanned waits, and the page reads again with backoff, because no signal is sent
//     when the scanner answers; a blocked file never opens; a file gone or archived (no state) says
//     «الملف غير متاح». Any of them can be removed by a writer.
import {
  ADMINISTRATION_MAX_LIST_ATTACHMENTS,
  type AdministrationSupplierAttachmentDto,
  type AdministrationSupplierDto,
  type Locale,
  type ScanStatus,
} from '@ecms/contracts';
import { formatNumber, localized } from '../../../shared/lib/format';

// ── Phones in the register ──────────────────────────────────────────────────

/** Digits shown at each end of a masked phone: `298*******4567`. */
const SHOWN_START = 3;
const SHOWN_END = 4;

/**
 * A phone as the register shows it: its digits masked but the first three and the last four, its
 * spaces, dashes and `+` kept so it still reads as the number it is. A short number — seven digits
 * or fewer, where three and four would show it whole — keeps only its last half, so no phone is
 * ever shown in full in a list.
 */
export const maskPhone = (phone: string): string => {
  const value = phone.trim();
  const digits = [...value].filter((char) => /\d/u.test(char)).length;
  const long = digits > SHOWN_START + SHOWN_END;
  const start = long ? SHOWN_START : 0;
  const end = long ? SHOWN_END : Math.floor(digits / 2);
  let seen = 0;
  return [...value]
    .map((char) => {
      if (!/\d/u.test(char)) return char;
      seen += 1;
      return seen <= start || seen > digits - end ? char : '*';
    })
    .join('');
};

// ── Categories ──────────────────────────────────────────────────────────────

/** The names of the categories a supplier supplies, in its own order; a vanished one is skipped. */
export const supplierCategoryNames = (
  supplier: Pick<AdministrationSupplierDto, 'categories'>,
  locale: Locale,
): string[] =>
  supplier.categories.flatMap((category) =>
    category.name === null ? [] : [localized(category.name, locale)],
  );

// ── Papers ──────────────────────────────────────────────────────────────────

/** What a paper's scan state says beside it: nothing, or one of these chips. */
export type PaperChip = 'pending' | 'blocked' | 'unavailable';

/** Whether a paper opens, and the chip beside it (§11.5's table). */
export const paperState = (
  scanStatus: ScanStatus | null,
): { opens: boolean; chip: PaperChip | null } => {
  if (scanStatus === null) return { opens: false, chip: 'unavailable' };
  if (scanStatus === 'pending') return { opens: false, chip: 'pending' };
  if (scanStatus === 'blocked') return { opens: false, chip: 'blocked' };
  return { opens: true, chip: null };
};

/** Every chip a paper can wear — what the module's i18n spec checks. */
export const PAPER_CHIPS: readonly PaperChip[] = ['pending', 'blocked', 'unavailable'];

/** Is the supplier's list full (§11.4: at most 20)? Then no paper is offered to be added. */
export const papersFull = (papers: readonly AdministrationSupplierAttachmentDto[]): boolean =>
  papers.length >= ADMINISTRATION_MAX_LIST_ATTACHMENTS;

/** The first wait, and the longest, while a paper is still being scanned. */
const SCAN_WAIT_FIRST_MS = 5_000;
const SCAN_WAIT_MAX_MS = 60_000;

/**
 * How long the record waits before reading again while a paper is still being scanned — doubling
 * from five seconds to a minute over the reads already made (`reads`), or `false` when nothing is
 * pending, so a page with no pending paper never polls.
 */
export const scanRecheckDelay = (
  papers: readonly Pick<AdministrationSupplierAttachmentDto, 'scanStatus'>[] | undefined,
  reads: number,
): number | false => {
  if (papers === undefined || !papers.some((paper) => paper.scanStatus === 'pending')) {
    return false;
  }
  const doublings = Math.max(0, Math.min(reads - 1, 4));
  return Math.min(SCAN_WAIT_FIRST_MS * 2 ** doublings, SCAN_WAIT_MAX_MS);
};

/** A paper's size in the reader's digits: kilobytes under a megabyte, else megabytes. */
export const paperSize = (bytes: number, locale: Locale): { unit: 'kb' | 'mb'; size: string } => {
  const kb = bytes / 1024;
  if (kb < 1024) return { unit: 'kb', size: formatNumber(Math.max(1, Math.round(kb)), locale) };
  return { unit: 'mb', size: formatNumber(Math.round((kb / 1024) * 10) / 10, locale) };
};
