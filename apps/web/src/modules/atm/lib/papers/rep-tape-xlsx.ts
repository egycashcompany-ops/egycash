// The plan as today's `.xlsx`: sheets `REP. TAPE` and `ATM_2`, in the master workbook's own shape
// (docs/12-planning/atm-settlements-phase1.md §8.5, S-10, DS-20, MON-1, MON-17, MON-18).
//
// WHY THE SHAPE IS KEPT EXACTLY. Inventory and the Daily Report stay in Excel for now (S-10) and
// are filled by copying from this sheet, so every column stays where the paper has it: REP. TAPE
// starts in column B at row 7, left to right, and its per-denomination columns R:T (200 / 100 / 50)
// — which the Inventory's `INVENTORY (A)` and the DR's `On The Way` read — hold each line's notes
// per denomination. U:W (20 / 10 / 5) follow only when a line carries such notes; cassettes 5–8 go
// after the last per-denomination column, so nothing the readers copy from moves.
//
// THE BLANK RULE (`repTapeSlots`, MON-18): a trailing run of slots that are not planned is blank,
// as today a 3-cassette machine is blank in cassette 4; a slot that is not planned BEFORE a planned
// one is 0 / 0, as today the reversed machine's empty slot 1.
//
// DATES ARE NUMBERS: the Excel serial of the Cairo day. O (Request Date) uses Excel's built-in
// short date (14), which follows the reader's regional setting exactly as `REP. TAPE!O8` does; D4
// keeps the paper's own `[$-409]d/mmm/yy;@` (GS-24). Money is converted ONCE (DS-28).
//
// NOT EXPORTED: the paper's hidden sum rows 109–111, its `D1:G2` standard-load table and its logo —
// formulas and configuration, not plan data.
import {
  ATM_REP_TAPE_BANK_LABELS,
  fromMinorUnits,
  type AtmRepTapeExportDto,
} from '@ecms/contracts';
import {
  buildXlsxBook,
  columnLetter,
  excelDaySerial,
  type XlsxGridCell,
  type XlsxGridSheet,
  type XlsxGridStyle,
} from '../../../../shared/lib/xlsx-writer';

type RepTapeRow = AtmRepTapeExportDto['rows'][number];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The English weekday of a calendar day — `REP. TAPE!F4`'s `CHOOSE(WEEKDAY(D4), …)`. */
export const weekdayOf = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? '';
};

/** `REP TAPE BRK dd-mm-yyyy.xlsx` — the owner's own naming (`26-10-2026 brk.xlsx`). */
export const repTapeFilename = (
  dto: Pick<AtmRepTapeExportDto, 'bankCode' | 'replenishDate'>,
): string => {
  const [y = '', m = '', d = ''] = dto.replenishDate.split('-');
  return `REP TAPE ${dto.bankCode} ${d}-${m}-${y}.xlsx`;
};

/** REP. TAPE row 7, B … P, exactly as the paper spells it (`No-of bills1`, then `No- of bills2`). */
export const REP_TAPE_HEADERS = [
  'Reference',
  'location',
  'No-of bills1',
  'Denom1',
  'No- of bills2',
  'Denom2',
  'No- of bills3',
  'Denom3',
  'No- of bills4',
  'Denom4',
  'Total cash fill for the ATM',
  'Comments',
  'Dep',
  'Request Date',
  'Bank',
] as const;

const BASE_DENOMINATIONS = [200, 100, 50] as const;
const SMALL_DENOMINATIONS = [20, 10, 5] as const;

/** The paper's column widths (characters), B … T. */
const REP_TAPE_WIDTHS: Readonly<Record<number, number>> = {
  1: 2,
  2: 15.86,
  3: 57.86,
  4: 12,
  5: 9.86,
  6: 12.71,
  7: 9.86,
  8: 12.71,
  9: 9.86,
  10: 12.71,
  11: 9.86,
  12: 18.14,
  13: 14.86,
  14: 7.43,
  15: 13,
  16: 7.29,
  17: 9.14,
  18: 9.14,
  19: 9.14,
  20: 9.14,
};
const ATM_2_WIDTHS = [
  13.71, 32.29, 16.57, 11.57, 13.57, 11.57, 13.57, 11.57, 13.57, 11.57, 15.71, 21.57, 19.57,
];

const COL = {
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  L: 12,
  M: 13,
  N: 14,
  O: 15,
  P: 16,
  R: 18,
} as const;

/** The most physical slots any exported line has — 4 at least, the paper's own pairs. */
const pairCount = (rows: readonly RepTapeRow[]): number =>
  Math.max(4, ...rows.map((row) => row.slots.length));

/** Whether any line carries notes in 20, 10 or 5 — then U:W follow R:T. */
const hasSmallNotes = (rows: readonly RepTapeRow[]): boolean =>
  rows.some((row) =>
    row.byDenomination.some(
      (d) => (SMALL_DENOMINATIONS as readonly number[]).includes(d.denomination) && d.notes > 0,
    ),
  );

const notesOf = (row: RepTapeRow, denomination: number): number =>
  row.byDenomination.find((d) => d.denomination === denomination)?.notes ?? 0;

/** A text in a merged group: the value at the first cell, the style across it, and the merge. */
const merged = (
  cells: XlsxGridCell[],
  merges: string[],
  row: number,
  from: number,
  to: number,
  value: string | number,
  style: XlsxGridStyle,
): void => {
  cells.push({ row, col: from, value, style });
  for (let col = from + 1; col <= to; col += 1) cells.push({ row, col, value: '', style });
  merges.push(`${columnLetter(from)}${String(row)}:${columnLetter(to)}${String(row)}`);
};

/** The physical cassette pairs of one line, from `firstCol` (notes, then denomination). */
const pairCells = (
  row: RepTapeRow,
  excelRow: number,
  columnOf: (pair: number) => number,
  pairs: readonly number[],
): XlsxGridCell[] =>
  pairs.flatMap((pair): XlsxGridCell[] => {
    const slot = row.slots[pair];
    if (slot === null || slot === undefined) return [];
    return [
      { row: excelRow, col: columnOf(pair), value: slot.notes, style: 'int' },
      { row: excelRow, col: columnOf(pair) + 1, value: slot.denomination, style: 'int' },
    ];
  });

export const repTapeSheet = (dto: AtmRepTapeExportDto): XlsxGridSheet => {
  const cells: XlsxGridCell[] = [];
  const merges: string[] = [];
  const day = excelDaySerial(dto.replenishDate);
  const pairs = pairCount(dto.rows);
  const small = hasSmallNotes(dto.rows);
  const denominations: readonly number[] = small
    ? [...BASE_DENOMINATIONS, ...SMALL_DENOMINATIONS]
    : BASE_DENOMINATIONS;
  const lastDenominationCol = COL.R + denominations.length - 1;
  /** Pairs 1–4 at D:K; 5–8 after the last per-denomination column. */
  const pairCol = (pair: number): number =>
    pair < 4 ? COL.D + 2 * pair : lastDenominationCol + 1 + 2 * (pair - 4);

  // Row 4: the date of the cash fill and its weekday.
  cells.push({ row: 4, col: COL.B, value: 'Date of cash fill:', style: 'bold' });
  merged(cells, merges, 4, COL.D, COL.E, day, 'dateLong');
  merged(cells, merges, 4, COL.F, COL.G, weekdayOf(dto.replenishDate), 'weekday');

  // Row 6: the column groups.
  merged(cells, merges, 6, COL.B, COL.C, ' ATMs', 'group');
  for (let pair = 0; pair < pairs; pair += 1) {
    merged(
      cells,
      merges,
      6,
      pairCol(pair),
      pairCol(pair) + 1,
      `Cassette ${String(pair + 1)}`,
      'group',
    );
  }
  merged(cells, merges, 6, COL.M, COL.P, 'EGY Cash', 'group');

  // Row 7: the headers, exactly; R:T (and U:W) the denominations as numbers.
  REP_TAPE_HEADERS.forEach((header, i) => {
    const col = COL.B + i;
    const style: XlsxGridStyle = header.startsWith('Denom')
      ? 'headRed'
      : col >= COL.M
        ? 'headBlue'
        : 'head';
    cells.push({ row: 7, col, value: header, style });
  });
  denominations.forEach((d, i) =>
    cells.push({ row: 7, col: COL.R + i, value: d, style: 'smallHead' }),
  );
  for (let pair = 4; pair < pairs; pair += 1) {
    cells.push(
      { row: 7, col: pairCol(pair), value: `No- of bills${String(pair + 1)}`, style: 'head' },
      { row: 7, col: pairCol(pair) + 1, value: `Denom${String(pair + 1)}`, style: 'headRed' },
    );
  }

  // From row 8: one row per issued or prepared line, in serial order.
  const bank = ATM_REP_TAPE_BANK_LABELS[dto.bankCode] ?? dto.bankCode;
  const allPairs = Array.from({ length: pairs }, (_, i) => i);
  dto.rows.forEach((row, i) => {
    const r = 8 + i;
    cells.push(
      { row: r, col: COL.B, value: row.reference ?? '' },
      { row: r, col: COL.C, value: row.location ?? '' },
      ...pairCells(row, r, pairCol, allPairs),
      { row: r, col: COL.L, value: fromMinorUnits(row.egpTotalMinor), style: 'totalInt' },
      { row: r, col: COL.M, value: row.comment },
      { row: r, col: COL.N, value: row.dep ?? '' },
      { row: r, col: COL.O, value: day, style: 'dateShort' },
      { row: r, col: COL.P, value: bank },
      ...denominations.map((d, j): XlsxGridCell => ({
        row: r,
        col: COL.R + j,
        value: notesOf(row, d),
        style: 'int',
      })),
    );
  });

  const lastCol = pairCol(pairs - 1) + 1;
  return {
    kind: 'grid',
    name: 'REP. TAPE',
    rightToLeft: false,
    font: 'tahoma10',
    columns: Array.from({ length: Math.max(lastCol, lastDenominationCol) }, (_, i) => ({
      index: i + 1,
      width: REP_TAPE_WIDTHS[i + 1] ?? 12,
    })),
    merges,
    cells,
  };
};

/** ATM_2's headers: ID · LOC · Note 1 · Denom1 … Note 4 · Denom4 · Total · TYPE · HUB, then 5–8. */
export const atm2Headers = (pairs: number): string[] => [
  'ID',
  'LOC',
  ...[1, 2, 3, 4].flatMap((n) => [`Note ${String(n)}`, `Denom${String(n)}`]),
  'Total',
  'TYPE',
  'HUB',
  ...Array.from({ length: Math.max(0, pairs - 4) }, (_, i) => [
    `Note ${String(i + 5)}`,
    `Denom${String(i + 5)}`,
  ]).flat(),
];

export const atm2Sheet = (dto: AtmRepTapeExportDto): XlsxGridSheet => {
  const pairs = pairCount(dto.rows);
  const headers = atm2Headers(pairs);
  /** Pairs 1–4 at C:J; 5–8 after HUB (column M). */
  const pairCol = (pair: number): number => (pair < 4 ? 3 + 2 * pair : 14 + 2 * (pair - 4));
  const cells: XlsxGridCell[] = headers.map((value, i) => ({
    row: 1,
    col: i + 1,
    value,
    style: 'headDark',
  }));
  const allPairs = Array.from({ length: pairs }, (_, i) => i);
  dto.rows.forEach((row, i) => {
    const r = 2 + i;
    cells.push(
      { row: r, col: 1, value: row.reference ?? '' },
      { row: r, col: 2, value: row.location ?? '' },
      ...pairCells(row, r, pairCol, allPairs),
      { row: r, col: 11, value: fromMinorUnits(row.egpTotalMinor), style: 'int' },
      { row: r, col: 12, value: row.typeLabel ?? '' },
      // HUB is the Full list `Dep` (`hubLabel`), the ECMS area only when it is missing (GS-11).
      { row: r, col: 13, value: row.hubLabel ?? row.dep ?? '' },
    );
  });
  return {
    kind: 'grid',
    name: 'ATM_2',
    rightToLeft: false,
    font: 'calibri13b',
    columns: headers.map((_, i) => ({ index: i + 1, width: ATM_2_WIDTHS[i] ?? 13.57 })),
    merges: [],
    cells,
  };
};

/** The workbook and the name it is saved under. */
export const buildRepTapeXlsx = (dto: AtmRepTapeExportDto): { blob: Blob; filename: string } => ({
  blob: buildXlsxBook([repTapeSheet(dto), atm2Sheet(dto)]),
  filename: repTapeFilename(dto),
});
