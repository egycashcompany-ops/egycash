// «استعاضة معلّقة لحين التحويل» as rules the node suite reads directly — no React, no words of its
// own (the screen hands in its `t` through `LedgerWordsKit`).
//
//   held       a replenishment recorded and its letter printed, its memos reserved, the money not
//              come yet: it adds nothing to «إجمالي العهدة» until «تأكيد التحويل».
//   done       a charge, a settlement, a transferred replenishment — and every operation stored
//              before there were statuses.
//   cancelled  a held replenishment withdrawn: its letter stays in «سجل العهدة», counting nothing;
//              its memos went back to «لم تُستعَض بعد».
//
// «تأكيد التحويل» needs its day only, never before the letter's day (the API refuses that too).
import {
  type CancelFleetCustodyReplenishment,
  type ConfirmFleetCustodyTransfer,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationStatus,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { dayDate } from './custody-fund-forms';
import { type LedgerWordsKit } from './custody-ledger-words';

const HOLD = 'fleet.custody.hold';
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** An operation's status — `done` for one stored before there were statuses. */
export const operationStatusOf = (row: {
  status?: FleetCustodyOperationStatus | null | undefined;
}): FleetCustodyOperationStatus => row.status ?? 'done';

export const isHeld = (row: { status?: FleetCustodyOperationStatus | null | undefined }): boolean =>
  operationStatusOf(row) === 'held';

export const isCancelled = (row: {
  status?: FleetCustodyOperationStatus | null | undefined;
}): boolean => operationStatusOf(row) === 'cancelled';

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The Cairo calendar day, `YYYY-MM-DD`, of an instant the API stamps (`toISOString()`, UTC) — so
 * «ألغاها … في …» names the day he cancelled on, not the UTC one (a day early from Cairo's midnight
 * to 02:00, 03:00 in summer). A value that is not an instant keeps its first ten characters.
 */
export const cairoDayOf = (iso: string): string => {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso.slice(0, 10) : CAIRO_DAY.format(instant);
};

// ── «تأكيد التحويل» ─────────────────────────────────────────────────────────────────────────────

export type TransferDateProblem = 'missing' | 'beforeLetter';

/**
 * What is wrong with the transfer's day, if anything: none typed, or a day before the letter's
 * (`letterDate`, YYYY-MM-DD or a longer ISO string). Any later day is accepted — there is no upper
 * bound, as a letter has none.
 */
export const transferDateProblem = (
  date: string,
  letterDate: string,
): TransferDateProblem | null => {
  if (!DAY.test(date)) return 'missing';
  return date < letterDate.slice(0, 10) ? 'beforeLetter' : null;
};

/** The body of «تأكيد التحويل» — the day as UTC midnight, as every Fleet form sends one. */
export const confirmTransferBody = (input: {
  date: string;
  reference: string;
  note: string;
}): ConfirmFleetCustodyTransfer => ({
  date: dayDate(input.date),
  reference: input.reference.trim(),
  note: input.note.trim(),
});

/** The body of «إلغاء الاستعاضة المعلّقة» — the reason, optional. */
export const cancelHeldBody = (reason: string): CancelFleetCustodyReplenishment => ({
  reason: reason.trim(),
});

/**
 * Why the server refused «تأكيد التحويل» or the cancel, when the dialog can say it in words:
 *   taken         409 / 404 — confirmed or cancelled elsewhere since the dialog read it (or gone);
 *   beforeLetter  422 — the transfer's day is before the letter's.
 * `null` for anything else, which keeps its usual message.
 */
export type HoldRefusal = 'taken' | 'beforeLetter';
export const holdRefusalOf = (error: unknown): HoldRefusal | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 409 || error.status === 404) return 'taken';
  if (error.status === 422) return 'beforeLetter';
  return null;
};

// ── «سجل العهدة» ────────────────────────────────────────────────────────────────────────────────

/**
 * What the Excel / PDF of «سجل العهدة» adds to a line's note: held «معلّقة — لا تُحسب حتى
 * التحويل»; cancelled «ملغاة — لا تُحسب»; transferred «خطاب X — حُوِّل المبلغ في Y — مرجع R».
 * `''` for every other line.
 */
export const ledgerStatusNote = (
  row: Pick<FleetCustodyLedgerRowDto, 'status' | 'letterDate' | 'transfer'>,
  kit: Pick<LedgerWordsKit, 't' | 'day'>,
): string => {
  const status = operationStatusOf(row);
  if (status === 'held') return kit.t(`${HOLD}.exportHeld`);
  if (status === 'cancelled') return kit.t(`${HOLD}.exportCancelled`);
  if (row.transfer === null) return '';
  return [
    row.letterDate === null ? null : kit.t(`${HOLD}.letterOf`, { date: kit.day(row.letterDate) }),
    kit.t(`${HOLD}.transferredOn`, { date: kit.day(row.transfer.date) }),
    row.transfer.reference === ''
      ? null
      : kit.t(`${HOLD}.reference`, { ref: row.transfer.reference }),
  ]
    .filter((part): part is string => part !== null)
    .join(' — ');
};

/** A line's note with its status note after it — the export's «الملاحظة». */
export const ledgerNoteWithStatus = (note: string, status: string): string =>
  [note, status].filter((part) => part !== '').join(' — ');

/**
 * «إجمالي العهدة بعد كل عملية» — the steps oldest first. A held or cancelled line moves nothing, so
 * it has no step; the last line kept carries «الآن», its «بعدها» being the fund.
 */
export const custodyStepRows = <T extends Pick<FleetCustodyLedgerRowDto, 'status' | 'latest'>>(
  newestFirst: readonly T[],
): T[] => {
  const kept = [...newestFirst].reverse().filter((row) => operationStatusOf(row) === 'done');
  return kept.map((row, i) => (i === kept.length - 1 ? { ...row, latest: true } : row));
};
