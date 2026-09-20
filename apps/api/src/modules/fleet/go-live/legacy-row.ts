// WHAT TRAVELS WITH A ROW THE OLD BOOKS COULD NOT SAY CLEANLY — its own deletion, and the text
// of a field the new model cannot hold as it was written.
//
// «لو فى صفوف كانت ممسوحه عاوزها موجوده والdeleted 1 زى ما هى» and «المهم تضيف كل الداتا ومتسبش
// داتا فاضيه». Every row of the four books is brought across. A row the old system had flagged
// `deleted: 1` arrives ALREADY DELETED — `isDeleted: true`, carrying the day the old system
// deleted it — which is the same state the new screens give a row somebody deletes there: off
// every list, out of every total, and still in the database to go back to.
//
// That state is also where a row goes when the new model would otherwise refuse it. Each of the
// four collections states an invariant in the database — one open odometer period per car, one
// open workshop visit per car — and a second open row would be REFUSED by the index, not stored.
// «بس ميحصلش تعارض»: such a row is written deleted, which every one of those partial indexes
// excludes (`isDeleted: false` is in the filter), so it lands, it conflicts with nothing, and
// the run lists it.
//
// Nothing about a row is thrown away to make it fit. Where the new model has no field for what
// the book wrote — a date that is not a date, a reading that is not a number — the text is
// appended to the row's notes exactly as the book had it, so the row still says what it said.
import { type Types } from 'mongoose';

/** A legacy row's bookkeeping, as every one of the four exports writes it. */
export interface LegacyBookkeeping {
  deleted?: number;
  deleted_date?: { $date?: string } | string | null;
}

/** Whether the old system had deleted the row, and when. */
export interface LegacyDeletion {
  isDeleted: boolean;
  deletedAt: Date | null;
}

/** A date from an export, whatever shape it came in, or `null` when it is not one at all. */
export const legacyDateOf = (value: unknown): Date | null => {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && typeof (value as { $date?: unknown }).$date === 'string'
        ? ((value as { $date: string }).$date)
        : null;
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The row's own deletion. `deleted_by` / `deleted_user` is a legacy USERNAME — «pola» — and the
 * new `deletedBy` is a user id, so it stays null rather than naming the wrong person: the row
 * arrived deleted by somebody this system has no user for, and the date says when.
 */
export const deletionOf = (entry: LegacyBookkeeping): LegacyDeletion => ({
  isDeleted: entry.deleted === 1,
  deletedAt: entry.deleted === 1 ? legacyDateOf(entry.deleted_date) : null,
});

/**
 * The three base fields a row carries when it — or the model's own invariant — says it is gone.
 *
 * `at` is the day to stamp a row the BOOK did not delete: one the model cannot hold alive, which
 * this import is deleting now. A pure planner has no «now» and passes none, and such a row then
 * carries no date, which is the honest record of «nobody deleted this; it never fitted».
 */
export const deletedFields = (
  deletion: LegacyDeletion,
  at?: Date,
): { isDeleted: true; deletedAt: Date | null; deletedBy: Types.ObjectId | null } => ({
  isDeleted: true,
  deletedAt: deletion.deletedAt ?? at ?? null,
  deletedBy: null,
});

/** The base fields of a row that is NOT deleted — written out so every doc says which it is. */
export const liveFields = (): { isDeleted: false; deletedAt: null; deletedBy: null } => ({
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
});

/**
 * The book's own words for something the model cannot hold, kept on the row. Written in Arabic
 * because the notes column is read on an Arabic screen by the person who will correct the row.
 */
export const noteWith = (notes: string | null, ...extras: readonly string[]): string | null => {
  const kept = extras.filter((extra) => extra.trim() !== '');
  if (kept.length === 0) return notes;
  return [notes, ...kept].filter((part): part is string => part !== null && part.trim() !== '').join(' · ');
};

/** «الدفتر القديم كتب …» — how an unreadable field is quoted on the row it came from. */
export const asWritten = (label: string, value: unknown): string =>
  `${label} فى الدفتر القديم: «${value === null || value === undefined ? '—' : String(typeof value === 'object' ? JSON.stringify(value) : value)}»`;
