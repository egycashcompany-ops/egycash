// The two mail pages' filters, their row paint and the log's restore, as plain functions — what
// /atm/mail-tickets and /atm/mail-tickets/log narrow by, and what the restore button decides from
// a row, where a suite can reach them without a DOM.
//
// «هنا /atm/mail-tickets/log وهنا /atm/mail-tickets عايز فلتر» (2026-10-28). The open boards ask
// the server for their bank and area lists (`board-filters.ts`); a mail page holds every row it can
// show — the pending list whole, the log's range whole (`whole-board.ts`) — so it filters in the
// browser and draws its dropdowns from the rows it read. The address bar carries the same
// `banks`/`areas` lists the boards write, with the same escape for a name holding a comma.
import {
  ATM_MAIL_TICKET_STATUSES,
  type AtmMailTicketDto,
  type AtmMailTicketStatus,
} from '@ecms/contracts';
import { foldIncludes } from '../../../shared/lib/fold';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { boardFilterOptions, readBoardFilters, withBoardFilter } from './board-filters';

/** What both mail pages narrow by. */
export interface MailFilters {
  banks: string[];
  areas: string[];
  /** The search box exactly as typed — trimmed where it is matched, never where it is written. */
  q: string;
}

export const readMailFilters = (sp: URLSearchParams): MailFilters => ({
  ...readBoardFilters(sp),
  q: sp.get('q') ?? '',
});

/** The log's status select: every status, or one of them. */
export type MailStatusFilter = 'all' | AtmMailTicketStatus;

export const MAIL_STATUS_FILTERS: readonly MailStatusFilter[] = [
  'all',
  ...ATM_MAIL_TICKET_STATUSES,
];

/**
 * The log's status out of its address bar. Anything that is not a status reads as «all» — a link
 * with a misspelt status shows the range rather than an empty table nobody can explain.
 */
export const readMailStatus = (sp: URLSearchParams): MailStatusFilter =>
  MAIL_STATUS_FILTERS.find((status) => status === sp.get('status')) ?? 'all';

/**
 * The address bar with the search or the status changed — an empty search and «all» are removed,
 * every other parameter kept. The search is written EXACTLY as typed: `SearchInput` re-emits while
 * its text differs from the value handed back, so a trimmed write of «  » came back as '' and was
 * emitted again every 300 ms (the register's review finding WEB-2).
 */
export const withMailParam = (
  sp: URLSearchParams,
  key: 'q' | 'status',
  value: string,
): URLSearchParams => {
  const next = new URLSearchParams(sp);
  if (value === '' || (key === 'status' && value === 'all')) next.delete(key);
  else next.set(key, value);
  return next;
};

/** Every filter cleared at once — the red reset. The log's range is not a filter, and stays. */
export const withoutMailFilters = (sp: URLSearchParams): URLSearchParams => {
  const next = new URLSearchParams(sp);
  for (const key of ['banks', 'areas', 'q', 'status']) next.delete(key);
  return next;
};

/** Does anything narrow the page? The reset is offered only then, as on the boards. */
export const isMailFiltered = (filters: MailFilters, status: MailStatusFilter = 'all'): boolean =>
  filters.banks.length > 0 ||
  filters.areas.length > 0 ||
  filters.q.trim() !== '' ||
  status !== 'all';

/**
 * A bank or an area is the text the mail's machine carried, so one name can be stored with a
 * trailing space. The dropdown and the match both read it trimmed, as the API does for the open
 * boards (`atm/shared/board-filter.ts`) — otherwise «NBE» would be offered twice, and picking one
 * spelling would miss the other's rows.
 */
const nameOf = (stored: string): string => stored.trim();

/** Each name once, blank ones dropped, in the order the boards' dropdowns use. */
const distinctNames = (stored: readonly string[]): string[] =>
  [...new Set(stored.map(nameOf))].filter((name) => name !== '').sort();

type MailRow = Pick<
  AtmMailTicketDto,
  'bankName' | 'area' | 'machineCode' | 'machineName' | 'status'
>;

/**
 * The rows the filters keep: one of the chosen banks, one of the chosen areas, the code or the name
 * holding the typed text — folded the way every search box in the app folds it (Arabic spellings,
 * either keyboard's digits) — and, on the log, the status. Each filter left empty keeps every row.
 */
export const filterMailTickets = <T extends MailRow>(
  rows: readonly T[],
  filters: MailFilters,
  status: MailStatusFilter = 'all',
): T[] => {
  const banks = new Set(filters.banks.map(nameOf));
  const areas = new Set(filters.areas.map(nameOf));
  const q = filters.q.trim();
  return rows.filter(
    (row) =>
      (banks.size === 0 || banks.has(nameOf(row.bankName))) &&
      (areas.size === 0 || areas.has(nameOf(row.area))) &&
      (q === '' || foldIncludes(row.machineCode, q) || foldIncludes(row.machineName, q)) &&
      (status === 'all' || row.status === status),
  );
};

/** The areas the area list offers under these banks: no bank, every row's area. */
const areaNamesUnder = (
  rows: readonly Pick<MailRow, 'bankName' | 'area'>[],
  chosenBanks: readonly string[],
): string[] => {
  const banks = new Set(chosenBanks.map(nameOf));
  const areaRows = banks.size === 0 ? rows : rows.filter((row) => banks.has(nameOf(row.bankName)));
  return distinctNames(areaRows.map((row) => row.area));
};

/**
 * The two dropdowns, out of the rows read. The area list follows the banks chosen, as the boards'
 * does — no bank, every row's area — and anything chosen that the rows no longer hold stays listed
 * after them, ticked, so it can be seen and unticked (`boardFilterOptions`).
 */
export const mailFilterOptions = (
  rows: readonly MailRow[],
  chosen: Pick<MailFilters, 'banks' | 'areas'>,
): { bankOptions: MultiSelectOption[]; areaOptions: MultiSelectOption[] } => ({
  bankOptions: boardFilterOptions(distinctNames(rows.map((row) => row.bankName)), chosen.banks),
  areaOptions: boardFilterOptions(areaNamesUnder(rows, chosen.banks), chosen.areas),
});

/**
 * The address bar after the reader changes the banks. The area list follows the banks, so a bank
 * change drops the chosen areas the new banks' rows do not hold — the boards' cascade
 * (`board-filters.ts`): picking NBE and Sidi Gaber, then switching to CIB, must not leave the table
 * asking for CIB in Sidi Gaber and coming up empty. Only a bank CHANGE drops anything — an area a
 * link or a remembered visit brought stays chosen, as on the boards — and nothing is dropped while
 * the rows are still being read (`rows` undefined): an empty list knows nothing about which areas
 * exist.
 */
export const withMailBanks = (
  sp: URLSearchParams,
  banks: readonly string[],
  rows: readonly Pick<MailRow, 'bankName' | 'area'>[] | undefined,
): URLSearchParams => {
  const next = withBoardFilter(sp, 'banks', banks);
  const { areas } = readBoardFilters(sp);
  if (rows === undefined || areas.length === 0) return next;
  const offered = new Set(areaNamesUnder(rows, banks));
  const kept = areas.filter((area) => offered.has(nameOf(area)));
  return kept.length === areas.length ? next : withBoardFilter(next, 'areas', kept);
};

/**
 * A mail row's paint — the pending page's DUPLICATE yellow (mail_maintenance.ejs:771), the log's
 * green accepted and red rejected (mail_maintenance_log.ejs:818-824) — across the WHOLE row, the
 * pinned buttons' cell included. That cell is opaque so the columns scrolling under it stay hidden
 * (`PINNED_ACTIONS`); without a paint of its own it would be a white block at the end of every
 * painted row. In the dark the paint is a veil over the table, so the cell lays the same veil
 * (the 950 shade at 30%) over its own opaque ground. Written out whole: Tailwind finds a class
 * only as a literal.
 */
export const MAIL_ROW_PAINT = {
  duplicate:
    'bg-yellow-50 dark:bg-yellow-950/30 [&>td:last-child]:bg-yellow-50 dark:[&>td:last-child]:bg-slate-900 dark:[&>td:last-child]:bg-[image:linear-gradient(rgb(66_32_6/0.3),rgb(66_32_6/0.3))]',
  accepted:
    'bg-green-50 dark:bg-green-950/30 [&>td:last-child]:bg-green-50 dark:[&>td:last-child]:bg-slate-900 dark:[&>td:last-child]:bg-[image:linear-gradient(rgb(5_46_22/0.3),rgb(5_46_22/0.3))]',
  rejected:
    'bg-red-50 dark:bg-red-950/30 [&>td:last-child]:bg-red-50 dark:[&>td:last-child]:bg-slate-900 dark:[&>td:last-child]:bg-[image:linear-gradient(rgb(69_10_10/0.3),rgb(69_10_10/0.3))]',
} as const;

// ── The log's restore — «إسترجاع ويقدر يرجعه مفتوح لو قبل أو رفض غلط» (2026-10-28) ───────────────

/** Only a DECIDED mail goes back — a pending one is already where a restore would put it. */
export const isRestorable = (ticket: { status: AtmMailTicketStatus }): boolean =>
  ticket.status === 'accepted' || ticket.status === 'rejected';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The restore confirm's words, by what the mail was. An accepted mail opened a maintenance, and
 * putting the mail back removes that maintenance from the board while it is still open — a closed
 * one is finished work, and the server refuses the restore — so the dialog says both before the
 * click. A rejected mail opened nothing, and only goes back.
 */
export const restoreConfirmBody = (
  t: Translate,
  ticket: { status: AtmMailTicketStatus; machineCode: string },
): string =>
  t(
    ticket.status === 'accepted' ? 'atm.mail.restoreBodyAccepted' : 'atm.mail.restoreBodyRejected',
    { code: ticket.machineCode },
  );
