// Reading one cell of the legacy workforce workbook without believing it.
//
// The file is twenty years of hand-maintained HR spreadsheet, and it lies in specific, repeatable
// ways. Every function here exists because the go-live data does the thing it guards against — the
// counts in the comments are from the real file, not hypotheticals. Nothing in this module does
// I/O; it takes cell values and returns either a clean value or `null`, so all of it is testable
// without an Excel file anywhere near it.

/**
 * The "looks filled, means empty" family.
 *
 * A spreadsheet has no null, so people type a dash. Across the two sheets: `ـ` (Arabic tatweel,
 * 16,448 cells), `_` (1,727), `-` (1,371), `ــ` (1,263), plus runs of 25–26 repeated characters
 * (640) where somebody held a key down. Treating any of these as a value writes a national ID of
 * "-" onto a real person.
 *
 * The rule is deliberately shape-based rather than a list: a cell whose entire content is
 * punctuation, underscores, tatweel or whitespace carries no information, whatever the length.
 */
const PLACEHOLDER = /^[\s_\-–—.·ــ‏‎/\\|+*#]*$/u;

/** A run of one repeated character — `ااااااااا`, `000000000` — is a held key, not a value. */
const isRepeatedRun = (s: string): boolean => s.length >= 4 && new Set(s).size === 1;

/**
 * Normalize a text cell, or `null` when it carries nothing.
 *
 * Also strips the bidi marks Excel sprinkles into Arabic cells, and collapses internal whitespace —
 * `التشغيل ( خارجى )` and `التشغيل (خارجى)` are the same section typed twice.
 */
export const text = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const s = String(raw)
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (s === '') return null;
  if (PLACEHOLDER.test(s)) return null;
  if (isRepeatedRun(s)) return null;
  return s;
};

/**
 * A number, or `null`. Accepts the numeric cells Excel stores as text.
 *
 * `0` is returned as `0` and never as null: sixteen employees carry a basic-wage bracket of zero,
 * and that is a filed figure rather than a missing one.
 */
export const num = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = text(raw);
  if (s === null) return null;
  // Arabic-Indic digits appear in a handful of cells; map them before parsing.
  const western = s.replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660));
  const cleaned = western.replace(/[,\s]/gu, '');
  if (!/^-?\d+(\.\d+)?$/u.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * Excel's day-zero for the 1900 date system, expressed as a UTC epoch.
 *
 * Serial 1 is 1900-01-01, so the origin is 1899-12-31. Excel then believes 1900 was a leap year —
 * it was not — so every serial above 59 is one day further along than the arithmetic suggests, and
 * the origin is shifted back a day to compensate. This is the standard correction, not a hack.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Serials outside this range are not dates — they are insurance numbers in a date column. */
const MIN_SERIAL = 3_653; // 1910-01-01
const MAX_SERIAL = 73_050; // 2100-01-01

/**
 * A date, or `null`. Three encodings appear in the same column and all three are real:
 *
 *   • a real Date          — what Excel stores for a properly typed cell
 *   • an integer serial    — 31 cells in the Resignation sheet (34921 → 1995-08-10)
 *   • `d/m/yyyy` text      — 1,066 cells in the Master sheet, all well formed
 *
 * DAY-FIRST, always. `3/4/1995` is 3 April in every one of these sheets; reading it as 3 March
 * would move a birthday by a month for a large share of the workforce and nothing downstream would
 * ever notice. `new Date(string)` is deliberately not used anywhere here — it is month-first.
 *
 * Dates are built at UTC midnight so a date never drifts across a timezone boundary.
 */
export const date = (raw: unknown): Date | null => {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number') return fromSerial(raw);

  const s = text(raw);
  if (s === null) return null;

  // A serial stored as text.
  const asNumber = num(s);
  if (asNumber !== null && /^\d+$/u.test(s.replace(/[,\s]/gu, ''))) return fromSerial(asNumber);

  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/u.exec(s);
  if (m === null) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02/1990 — Date rolls it into March, and a rolled date is a wrong date.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
};

const fromSerial = (serial: number): Date | null => {
  if (!Number.isFinite(serial) || serial < MIN_SERIAL || serial > MAX_SERIAL) return null;
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial) * MS_PER_DAY);
};

/**
 * A boolean recorded as a mark. HR writes `نعم`, `تم`, `1`, `x` — all meaning "yes"; the column
 * being non-empty is itself the signal. Anything the placeholder rules reject reads as `false`.
 */
export const flag = (raw: unknown): boolean => text(raw) !== null;

/**
 * A 14-digit Egyptian national ID, or `null`.
 *
 * Only the shape is checked here. Whether it is a VALID id — the checksum, the derivable birth date
 * — belongs to `parseNationalId` in contracts, which the employee service already runs on every
 * write. Duplicating that judgement here would let the two disagree.
 */
export const nationalId = (raw: unknown): string | null => {
  const s = text(raw);
  if (s === null) return null;
  const digits = s.replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/gu, '');
  return digits.length === 14 ? digits : null;
};

/**
 * An Egyptian mobile number normalized to `01XXXXXXXXX`, or `null`.
 *
 * Accepts the `+20`/`0020`/`20` prefixes the sheet mixes. A number that is not eleven digits
 * starting `01` after normalization is not a mobile number and is dropped rather than guessed at —
 * `contact.primaryPhone` is what the credential delivery would dial.
 */
export const phone = (raw: unknown): string | null => {
  const s = text(raw);
  if (s === null) return null;
  let digits = s
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/gu, '');
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  if (!digits.startsWith('0')) digits = `0${digits}`;
  return /^01\d{9}$/u.test(digits) ? digits : null;
};

/** A four-digit graduation year, or `null`. Rejects the stray dates that appear in that column. */
export const year = (raw: unknown): number | null => {
  if (raw instanceof Date) return raw.getUTCFullYear();
  const n = num(raw);
  if (n === null || !Number.isInteger(n)) return null;
  return n >= 1900 && n <= 2100 ? n : null;
};
