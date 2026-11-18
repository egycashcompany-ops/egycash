// THE SHAPE OF THE ATTENDANCE REPORT — the seventeen columns HR reads, and nothing else.
//
// Pure. No database, no response, no permissions: given a resolved day it returns a row of
// strings. That is what makes the owner's acceptance tests ("column order", "headers in Arabic
// when the UI is Arabic", "h:mm", "a missing check-out is blank") provable without a server.
//
// EVERY RULE IN THIS FILE CAME FROM A COMPLAINT ABOUT A REAL FILE — his export of 18 November,
// forty-four rows, which he could not use. They are worth stating as rules rather than leaving as
// formatting, because each one is a decision about what a reader is owed:
//
//   A DURATION IS h:mm, NEVER MINUTES. «455» is a number HR has to divide; «7:35» is a working
//   day. The payroll feed still carries integers — it is being added up, not read.
//
//   A TIME IS A TWELVE-HOUR CAIRO CLOCK, with Arabic ص / م or English am / pm. Nobody in this
//   company says «17:40», and a file that does is a file that gets re-typed.
//
//   A DATE IS dd/mm/yyyy, his words. Not ISO: this is read, not parsed.
//
//   NOTHING UNMEASURED IS PRINTED. A blank cell says «nobody knows». «0:00» says «it was zero»,
//   and on his export five people with a missing check-out were told they had worked no time at
//   all. The blanking itself is decided upstream by `figuresOf`; this file only refuses to invent.
//
//   A ZERO IN AN EXCEPTION COLUMN IS ALSO BLANK — late, shortfall, early leave, overtime. Those
//   four columns answer «was anything wrong», and forty rows of «0:00» is forty rows of noise to
//   read past. The three measurement columns (worked, required, punches) print their real value.
//   A judgement, and a narrow one: on a 44-row file it is the difference between an exception
//   standing out and an exception hiding.
//
//   THE STATUS IS THE WORD ON THE SCREEN. Not `checkedIn`. The words live in
//   `ATTENDANCE_DISPLAY_LABELS` in the contract, shared with the web catalogue and pinned to it by
//   a spec, so the file and the page cannot drift apart.
//
//   NOTES ARE SENTENCES. The old file carried `manualPunch|crossBranchPunch` and a `frozenAt`
//   timestamp; a reader is owed «بصمة يدوية» and «الشهر مغلق من المرتبات».
import { guardCsvFormula } from '../../../atm/register/register-export';
import {
  ATTENDANCE_DISPLAY_LABELS,
  displayStatusOf,
  type AttendanceDayFigures,
  type AttendanceDayFlag,
  type AttendanceDayStatus,
  type LocalizedString,
} from '@ecms/contracts';

export type ReportLocale = 'ar' | 'en';

/**
 * The columns, in the owner's order, with both headers.
 *
 * Declared as data rather than written into a template string so the order is one list that a test
 * can read — his first acceptance test is literally «column order and headers (ar/en)».
 */
export const ATTENDANCE_REPORT_COLUMNS: readonly { key: string; ar: string; en: string }[] = [
  { key: 'code', ar: 'كود الموظف', en: 'Employee code' },
  { key: 'name', ar: 'الاسم', en: 'Name' },
  { key: 'branch', ar: 'الفرع', en: 'Branch' },
  { key: 'department', ar: 'القسم', en: 'Department' },
  { key: 'jobTitle', ar: 'الوظيفة', en: 'Job title' },
  { key: 'date', ar: 'التاريخ', en: 'Date' },
  { key: 'status', ar: 'الحالة', en: 'Status' },
  { key: 'checkIn', ar: 'الحضور', en: 'Check-in' },
  { key: 'checkOut', ar: 'الانصراف', en: 'Check-out' },
  { key: 'worked', ar: 'ساعات العمل', en: 'Worked' },
  { key: 'required', ar: 'المطلوب', en: 'Required' },
  { key: 'late', ar: 'التأخير', en: 'Late' },
  { key: 'shortfall', ar: 'النقص', en: 'Shortfall' },
  { key: 'earlyLeave', ar: 'الانصراف المبكر', en: 'Early leave' },
  { key: 'overtime', ar: 'الإضافي المحتسب', en: 'Overtime (calculated)' },
  { key: 'approvedOvertime', ar: 'الإضافي المعتمد', en: 'Overtime (approved)' },
  { key: 'punches', ar: 'عدد البصمات', en: 'Punches' },
  { key: 'notes', ar: 'ملاحظات', en: 'Notes' },
];

export const reportHeaders = (locale: ReportLocale): string[] =>
  ATTENDANCE_REPORT_COLUMNS.map((column) => (locale === 'ar' ? column.ar : column.en));

/**
 * A duration as h:mm, or blank.
 *
 * `null` is "not measured" and prints nothing. `blankZero` is what the exception columns pass: a
 * measured zero there is still printed as nothing, because an empty cell in a column headed
 * «التأخير» reads as "not late" to every person who has ever read a timesheet.
 */
export const asHoursMinutes = (minutes: number | null, blankZero = false): string => {
  if (minutes === null) return '';
  if (minutes === 0 && blankZero) return '';
  const whole = Math.max(0, Math.round(minutes));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const cairoParts = (locale: ReportLocale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

/**
 * A twelve-hour Cairo clock: «8:05 ص» / «5:40 م», or `8:05 am` / `5:40 pm`.
 *
 * Arabic-Indic digits are mapped back to Western ones on purpose. `ar-EG` formats «٨:٠٥ ص», which
 * is correct Arabic and wrong for this file: Excel reads the cell as text either way, and a column
 * of mixed digit shapes cannot be eyeballed or sorted by the person who opens it. The marker
 * («ص»/«م») is the part that has to be Arabic, and it stays.
 */
const WESTERN_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export const asClockTime = (at: string | null, locale: ReportLocale): string => {
  if (at === null) return '';
  const formatted = cairoParts(locale).format(new Date(at));
  return formatted
    .replace(/[٠-٩]/g, (digit) => WESTERN_DIGITS[digit] ?? digit)
    // Bidirectional marks and the narrow no-break space Intl inserts: invisible here, and visible
    // as mojibake in a spreadsheet that does not expect them.
    .replace(/[‎‏‪-‮⁦-⁩ ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** `2026-11-18` → `18/11/2026`. The ISO date is the wire format; this is the reading format. */
export const asReadableDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return year === undefined || month === undefined || day === undefined
    ? isoDate
    : `${day}/${month}/${year}`;
};

const localized = (value: LocalizedString | null, locale: ReportLocale): string =>
  value === null ? '' : ((locale === 'ar' ? value.ar : value.en) ?? '');

/** The status in the words the screen shows. */
export const statusLabel = (status: AttendanceDayStatus, locale: ReportLocale): string => {
  const label = ATTENDANCE_DISPLAY_LABELS[displayStatusOf(status)];
  return locale === 'ar' ? label.ar : label.en;
};

const FLAG_NOTES: Record<AttendanceDayFlag, LocalizedString> = {
  manualPunch: { ar: 'بصمة يدوية', en: 'Manual punch' },
  regularizedPunch: { ar: 'تسوية معتمدة', en: 'Approved correction' },
  crossBranchPunch: { ar: 'بصمة من فرع آخر', en: 'Punch at another branch' },
  overriddenByManager: { ar: 'قرار مدير', en: 'Manager decision' },
};

const MISSING_CHECK_OUT: LocalizedString = { ar: 'لا يوجد انصراف', en: 'Check-out missing' };
const FROZEN: LocalizedString = { ar: 'الشهر مغلق من المرتبات', en: 'Payroll month closed' };
const PROVISIONAL: LocalizedString = {
  ar: 'قراءة مبدئية من البصمات',
  en: 'Provisional, read from the punches',
};

/**
 * What is worth saying about the day in words — joined with « · » because a cell with two notes
 * must still read as a sentence rather than as a pipe-separated code list.
 *
 * The order is deliberate: the condition a reader must act on first comes first. A missing
 * check-out is why the figures beside it are blank, so it leads; a frozen month is why nothing can
 * be done about it; the flags are provenance.
 */
export const reportNotes = (
  day: {
    firstInAt: string | null;
    lastOutAt: string | null;
    flags: readonly AttendanceDayFlag[];
    frozen: boolean;
    provisional: boolean;
  },
  locale: ReportLocale,
): string => {
  const notes: LocalizedString[] = [];
  if (day.firstInAt !== null && day.lastOutAt === null) notes.push(MISSING_CHECK_OUT);
  if (day.frozen) notes.push(FROZEN);
  if (day.provisional && day.firstInAt !== null) notes.push(PROVISIONAL);
  for (const flag of day.flags) notes.push(FLAG_NOTES[flag]);
  return notes.map((note) => (locale === 'ar' ? note.ar : note.en)).join(' · ');
};

/** One resolved day, as the report sees it — assembled by the caller from either read shape. */
export interface ReportRow {
  employeeCode: string;
  employeeName: string;
  branch: LocalizedString | null;
  department: LocalizedString | null;
  jobTitle: LocalizedString | null;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  status: AttendanceDayStatus;
  firstInAt: string | null;
  lastOutAt: string | null;
  figures: AttendanceDayFigures;
  approvedOvertimeMinutes: number | null;
  punchCount: number;
  flags: readonly AttendanceDayFlag[];
  frozen: boolean;
  provisional: boolean;
}

/**
 * One row, as cells, in the declared column order.
 *
 * Returned as an array rather than a joined line so the CSV writer owns quoting and the formula
 * guard, and so a test can assert on cells by index without parsing anything.
 */
export const reportCells = (row: ReportRow, locale: ReportLocale): string[] => [
  row.employeeCode,
  row.employeeName,
  localized(row.branch, locale),
  localized(row.department, locale),
  localized(row.jobTitle, locale),
  asReadableDate(row.date),
  statusLabel(row.status, locale),
  asClockTime(row.firstInAt, locale),
  asClockTime(row.lastOutAt, locale),
  asHoursMinutes(row.figures.workedMinutes),
  asHoursMinutes(row.figures.requiredMinutes),
  asHoursMinutes(row.figures.lateMinutes, true),
  asHoursMinutes(row.figures.shortfallMinutes, true),
  asHoursMinutes(row.figures.earlyLeaveMinutes, true),
  asHoursMinutes(row.figures.overtimeMinutes, true),
  asHoursMinutes(row.approvedOvertimeMinutes, true),
  // The scan count is a measurement, so a real zero prints: «0» on a «غائب» line is the answer to
  // «did the reader see them at all», and that answer is worth having in the file.
  String(row.punchCount),
  reportNotes(row, locale),
];

/**
 * ONE CELL, AS CSV: quoted, always.
 *
 * It lives here rather than in the writer because the quoting IS part of this report's shape, and
 * two of its three reasons are about what a reader sees:
 *
 *  · EVERY value is quoted, by the owner's instruction, not only the ones that would otherwise
 *    break the file. Selective quoting looks accidental, and it would land on exactly the columns
 *    that matter — an Arabic name or a note is far likelier to contain a comma than a code is.
 *  · Quoting stops a spreadsheet re-typing «0100052» as 100052 and destroying the leading zero,
 *    which is the commonest way an employee code dies between an export and a lookup.
 *  · A cell beginning with `=` `+` `-` or `@` is prefixed so a spreadsheet shows it instead of
 *    running it (the register export's guard, DEC-17, reused rather than rewritten).
 */
export const csvCell = (value: string): string =>
  `"${guardCsvFormula(value).replace(/"/g, '""')}"`;

/** One line, CRLF-terminated — what Excel expects of a CSV, whatever platform wrote it. */
export const csvRow = (cells: readonly string[]): string =>
  `${cells.map(csvCell).join(',')}\r\n`;
