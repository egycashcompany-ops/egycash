// What the four operation tables say — /atm/replenishments, /atm/maintenance and their two done
// pages — as words, once, for the screen, its sort and its files.
//
// «عايز إنه يقدر يخرج الجدول في شكل Excel و PDF مكتوب فوقه عنوان بيان "تغذية/صيانة" ماكينات الصراف
// الآلي "عن يوم/عن الفترة من إلي"» (2026-10-27): each table leaves as a workbook and as the
// company's printed report, its rows exactly as the table holds them — the day view, the bank and
// area filters and the reader's order all applied — under a title that names the day or the days.
//
// The columns are listed HERE, in the table's order, each with what its cell says as text; a page
// builds its table from this list and adds only what is not text — a badge beside the service, the
// live timer, the row's buttons. That is what keeps a file from drifting away from the screen it
// was taken from.
import { type AtmMaintenanceDto, type AtmReplenishmentDto, type Locale } from '@ecms/contracts';
import { formatBusinessDateTime, formatDate } from '../../../shared/lib/format';
import { type SortValue } from '../../../shared/lib/sort-rows';
import { type TableSort } from '../../../shared/lib/table-sort';
import {
  columnLetter,
  xlsxFilename,
  type XlsxGridCell,
  type XlsxGridSheet,
} from '../../../shared/lib/xlsx-writer';
import { formatDuration } from './operation-view';
import { listSeparator } from './register-import-view';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type AtmOperationKind = 'replenishment' | 'maintenance';
export type AtmOperationRow = AtmReplenishmentDto | AtmMaintenanceDto;

/** One column of a table, as words. */
export interface SheetColumn<T> {
  /** The table's column key — also the sort key. */
  key: string;
  header: string;
  /** The cell as text; `empty` is what a missing value prints as («—» on screen and paper, '' in a sheet). */
  text: (row: T, empty: string) => string;
  /**
   * A column the reader copies off the board — «عايز بس البنك والكود واسم الماكينة وتوقيت
   * التغذية». The open boards keep every other cell out of a selection.
   */
  copy?: boolean;
}

const orEmpty = (value: string | null, empty: string): string =>
  value === null || value.trim() === '' ? empty : value;

/**
 * An open or close time on the CAIRO clock, whatever the reader's machine is set to: the views,
 * the statement's title and the server's per-day rule all count by the Cairo day, and a row in
 * «اليوم» must not print yesterday's date beside it on a laptop set to another zone.
 */
const instant = (iso: string | null, locale: Locale, empty: string): string =>
  iso === null ? empty : formatBusinessDateTime(iso, locale);

/** The columns both kinds open with: bank, code, name — the machine. */
const machineColumns = <T extends AtmOperationRow>(
  t: Translate,
  open: boolean,
): SheetColumn<T>[] => [
  { key: 'bank', header: t('atm.common.bank'), text: (row) => row.bankName, copy: open },
  { key: 'code', header: t('atm.common.machineId'), text: (row) => row.machineCode, copy: open },
  { key: 'name', header: t('atm.common.machineName'), text: (row) => row.machineName, copy: open },
];

const closeColumns = <T extends AtmOperationRow>(
  t: Translate,
  locale: Locale,
): SheetColumn<T>[] => [
  {
    key: 'closed',
    header: t('atm.common.closeTime'),
    text: (row, empty) => instant(row.closedAt, locale, empty),
  },
  {
    key: 'duration',
    header: t('atm.common.takenTime'),
    text: (row, empty) =>
      row.closedAt === null ? empty : formatDuration(row.openedAt, row.closedAt),
  },
];

/**
 * The replenishment tables. Open board: bank, code, name, schedule, area, open time, leader, added
 * by — the four copy columns first. Done page: the same up to the open time, then close, duration,
 * leader, closed by.
 */
export const replenishmentColumns = (
  t: Translate,
  locale: Locale,
  page: 'open' | 'done',
): SheetColumn<AtmReplenishmentDto>[] => [
  ...machineColumns<AtmReplenishmentDto>(t, page === 'open'),
  {
    key: 'schedule',
    header: t('atm.replenishments.scheduleTime'),
    text: (row, empty) => orEmpty(row.scheduleTime, empty),
    copy: page === 'open',
  },
  { key: 'area', header: t('atm.common.area'), text: (row) => row.area },
  {
    key: 'opened',
    header: t('atm.common.openTime'),
    text: (row, empty) => instant(row.openedAt, locale, empty),
  },
  ...(page === 'done' ? closeColumns<AtmReplenishmentDto>(t, locale) : []),
  {
    key: 'leader',
    header: t('atm.common.leader'),
    text: (row, empty) => orEmpty(row.leaderName, empty),
  },
  page === 'open'
    ? {
        key: 'addedBy',
        header: t('atm.common.addedBy'),
        text: (row, empty) => orEmpty(row.openedByName, empty),
      }
    : {
        key: 'closedBy',
        header: t('atm.common.closedBy'),
        text: (row, empty) => orEmpty(row.closedByName, empty),
      },
];

/**
 * The maintenance tables. The copy columns are the machine and the OPEN TIME — maintenance has no
 * schedule text, and its open time is when it is due (the owner's answer: «وقت الفتح»). Open board:
 * bank, code, name, service, area, open time, notes, leader, reference, added by. Done page: the
 * same up to the open time, then close, duration, notes, reference, leader, closed by.
 */
export const maintenanceColumns = (
  t: Translate,
  locale: Locale,
  page: 'open' | 'done',
): SheetColumn<AtmMaintenanceDto>[] => {
  const notes: SheetColumn<AtmMaintenanceDto> = {
    key: 'notes',
    header: t('atm.maintenance.notes'),
    text: (row, empty) => orEmpty(row.notes, empty),
  };
  const reference: SheetColumn<AtmMaintenanceDto> = {
    key: 'reference',
    header: t('atm.maintenance.referenceNumber'),
    text: (row, empty) => orEmpty(row.referenceNumber, empty),
  };
  const leader: SheetColumn<AtmMaintenanceDto> = {
    key: 'leader',
    header: t('atm.common.leader'),
    text: (row, empty) => orEmpty(row.leaderName, empty),
  };
  return [
    ...machineColumns<AtmMaintenanceDto>(t, page === 'open'),
    {
      key: 'service',
      header: t('atm.maintenance.serviceType'),
      text: (row, empty) => orEmpty(row.serviceType, empty),
    },
    { key: 'area', header: t('atm.common.area'), text: (row) => row.area },
    {
      key: 'opened',
      header: t('atm.common.openTime'),
      text: (row, empty) => instant(row.openedAt, locale, empty),
      copy: page === 'open',
    },
    ...(page === 'open'
      ? [
          notes,
          leader,
          reference,
          {
            key: 'addedBy',
            header: t('atm.common.addedBy'),
            text: (row: AtmMaintenanceDto, empty: string) => orEmpty(row.openedByName, empty),
          },
        ]
      : [
          ...closeColumns<AtmMaintenanceDto>(t, locale),
          notes,
          reference,
          leader,
          {
            key: 'closedBy',
            header: t('atm.common.closedBy'),
            text: (row: AtmMaintenanceDto, empty: string) => orEmpty(row.closedByName, empty),
          },
        ]),
  ];
};

// ── The order ─────────────────────────────────────────────────────────────────────────────────

/**
 * ONE TYPE PER COLUMN, so the order is a total one: a code of digits is padded to a fixed width,
 * which orders it as a number — 987 before 1234 — while staying text beside a code such as
 * «1001A». Mixing numbers and strings would make the comparison circular (9 < 100 < «10A» < 9)
 * and the result depend on the order the rows arrived in.
 */
export const codeSortValue = (code: string): SortValue =>
  /^\d+$/.test(code) ? code.padStart(24, '0') : code;

const ARABIC_DIGITS = /[٠-٩]/g;

/**
 * A schedule is free text — «9:30», «10:00», «٨٫١٥» — so a time at its start is read as one and
 * written zero-padded («09:30»), which orders as the clock does; anything else stays as typed.
 */
export const scheduleSortValue = (value: string | null): SortValue => {
  if (value === null || value.trim() === '') return null;
  const latin = value.trim().replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
  const time = /^(\d{1,2})\s*[:.٫]\s*(\d{2})/.exec(latin);
  return time === null ? value : `${(time[1] as string).padStart(2, '0')}:${time[2] as string}`;
};
const textValue = (value: string | null | undefined): SortValue =>
  value === null || value === undefined || value.trim() === '' ? null : value;
const timeValue = (iso: string | null): SortValue =>
  iso === null ? null : new Date(iso).getTime();

/**
 * What one column of one row is worth to the sort. Times by the instant, durations by their
 * length, codes of digits as numbers, the rest as words; a key no table has answers `null`, which
 * is what makes a hand-edited `?sort=` harmless (`sortRows`).
 */
export const operationSortValue = (row: AtmOperationRow, key: string): SortValue => {
  switch (key) {
    case 'bank':
      return textValue(row.bankName);
    case 'code':
      return codeSortValue(row.machineCode);
    case 'name':
      return textValue(row.machineName);
    case 'area':
      return textValue(row.area);
    case 'opened':
      return timeValue(row.openedAt);
    case 'closed':
      return timeValue(row.closedAt);
    case 'duration':
      return row.closedAt === null
        ? null
        : new Date(row.closedAt).getTime() - new Date(row.openedAt).getTime();
    case 'leader':
      return textValue(row.leaderName);
    case 'addedBy':
      return textValue(row.openedByName);
    case 'closedBy':
      return textValue(row.closedByName);
    case 'schedule':
      return 'scheduleTime' in row ? scheduleSortValue(row.scheduleTime) : null;
    case 'service':
      return 'serviceType' in row ? textValue(row.serviceType) : null;
    case 'notes':
      return 'notes' in row ? textValue(row.notes) : null;
    case 'reference':
      return 'referenceNumber' in row ? textValue(row.referenceNumber) : null;
    default:
      return null;
  }
};

/** The reader's order, kept to the keys this table has — a link from the other board sorts nothing it lacks. */
export const knownSorts = (
  sorts: readonly TableSort[],
  columns: readonly { key: string }[],
): TableSort[] => {
  const keys = new Set(columns.map((column) => column.key));
  return sorts.filter((entry) => keys.has(entry.by));
};

// ── The statement's title ─────────────────────────────────────────────────────────────────────

/** A calendar day (`YYYY-MM-DD`) as the reader reads dates — noon UTC, so no timezone moves it. */
export const statementDay = (day: string, locale: Locale): string =>
  formatDate(`${day}T12:00:00.000Z`, locale);

/**
 * «بيان تغذية ماكينات الصراف الآلي عن يوم …» — or «… عن الفترة من … إلى …» when the rows span more
 * than one day. The same words on the four pages: the open boards name the day they are for, the
 * done pages the days they closed on.
 */
export const statementTitle = (
  t: Translate,
  kind: AtmOperationKind,
  range: { from: string; to: string },
  locale: Locale,
): string => {
  const what = kind === 'replenishment' ? 'rep' : 'maint';
  return range.from === range.to
    ? t(`atm.export.${what}TitleDay`, { day: statementDay(range.from, locale) })
    : t(`atm.export.${what}TitleRange`, {
        from: statementDay(range.from, locale),
        to: statementDay(range.to, locale),
      });
};

/**
 * The line under the printed title: the bank and area filters in force, by name. A filter in force
 * is never left off the page — a statement narrowed to one bank that printed without saying so
 * would read as the company's. Empty when nothing narrows it.
 */
export const statementFilterLine = (
  t: Translate,
  locale: Locale,
  filters: { banks: readonly string[]; areas: readonly string[] },
): string =>
  [
    filters.banks.length === 0
      ? null
      : t('atm.export.banksAre', { names: filters.banks.join(listSeparator(locale)) }),
    filters.areas.length === 0
      ? null
      : t('atm.export.areasAre', { names: filters.areas.join(listSeparator(locale)) }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

/** What the file is called in the reader's downloads — what it is, then the day or the days. */
export const statementFileName = (
  t: Translate,
  kind: AtmOperationKind,
  range: { from: string; to: string },
): string =>
  xlsxFilename(
    t(kind === 'replenishment' ? 'atm.export.repFile' : 'atm.export.maintFile'),
    range.from === range.to ? range.from : `${range.from}_${range.to}`,
  );

/** The table's rows as the file's lines, in its order — one string per column. */
export const statementLines = <T>(
  rows: readonly T[],
  columns: readonly SheetColumn<T>[],
  empty: string,
): string[][] => rows.map((row) => columns.map((column) => column.text(row, empty)));

/**
 * The statement as a workbook sheet: the title in row 1, merged across the table and centred in
 * bold, a blank row, then the «م» column and the table's header and rows — the printed page's
 * shape, in a sheet that reads right to left.
 *
 * A GRID sheet of the shared writer (`shared/lib/xlsx-writer.ts`), the kind it carries for a
 * sheet that does not start with «م» in A1 — so the table sheet every Fleet book is made of stays
 * byte for byte what it was. Empty cells are written blank: in a sheet a blank is something a
 * reader can filter on.
 */
export const statementSheet = ({
  name,
  title,
  serialHeader,
  header,
  lines,
}: {
  name: string;
  title: string;
  serialHeader: string;
  header: readonly string[];
  lines: readonly (readonly string[])[];
}): XlsxGridSheet => {
  const width = header.length + 1;
  const HEAD_ROW = 3;
  const cells: XlsxGridCell[] = [
    { row: 1, col: 1, value: title, style: 'group' },
    ...[serialHeader, ...header].map((value, i): XlsxGridCell => ({
      row: HEAD_ROW,
      col: i + 1,
      value,
      style: 'head',
    })),
    ...lines.flatMap((line, r) =>
      // The serial is generated — it numbers the sheet so a reader can point at a line.
      [r + 1, ...line].map((value, c): XlsxGridCell => ({
        row: HEAD_ROW + 1 + r,
        col: c + 1,
        value,
        style: 'plain',
      })),
    ),
  ];
  return {
    kind: 'grid',
    name,
    rightToLeft: true,
    font: 'tahoma10',
    columns: [{ index: 1, width: 5 }, ...header.map((_unused, i) => ({ index: i + 2, width: 18 }))],
    merges: [`A1:${columnLetter(width)}1`],
    cells,
  };
};
