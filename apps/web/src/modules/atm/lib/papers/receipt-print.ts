// «بيان التغذية» — the cash request to the open-cash vault, one A4 landscape page
// (docs/12-planning/atm-settlements-phase1.md §8.3, DS-18, DS-28).
//
// The sheet's own grid: ten columns at its width shares, its row heights in points, a thin frame
// round B2:I24, its Calibri at its own sizes. The title is composed from the owner's words around
// the bank's Arabic name (BRK → «بنك البركة», as the paper types it); B3 is the PRINT day, as the
// paper's `=TODAY()` (GS-28).
//
// WHAT THE OWNER ACCEPTED (§2.1): the 20/10/5 rows are SUMMED (the Al Baraka sheet's rows point at
// empty cells and are always 0), and the machine count is distinct machines plus spare sets, not
// lines. The total is converted from EGP minor units ONCE (DS-28). The sheet's white helper row 26
// is not carried; what changed since a previous print is said by the print dialog, not the paper.
import { fromMinorUnits, type AtmReceiptPrintDto } from '@ecms/contracts';
import { cairoDay, formatPaperDate } from '../settlement-dates';
import { RECEIPT_WORDS } from './settlement-paper-wording';
import {
  esc,
  int,
  ltr,
  paperDocument,
  settlementPaperWords,
  type SettlementPaperWords,
} from './settlement-print';

/** Columns A … J, as shares of the block (`بيان التغذية`'s `<cols>`). */
export const RECEIPT_COLUMN_SHARES = [
  11.8, 10.3, 8.8, 10.3, 8.8, 10.3, 8.8, 10.3, 8.8, 11.8,
] as const;
/** Rows 1 … 24 in points, the sheet's heights (15 where it sets none). */
const RECEIPT_ROWS_PT = [
  15.75, 15.75, 21, 21, 15, 15.75, 21.75, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 15, 21, 21, 15,
  15.75, 15, 15, 15, 15, 15.75,
] as const;
/** About the sheet's width at 100 % (132 characters of Calibri 11). */
const RECEIPT_BLOCK_WIDTH_MM = 245;

const COLUMN = (letter: string): number => 'ABCDEFGHIJ'.indexOf(letter) + 1;

const cell = (
  range: [string, number, string, number],
  inner: string,
  cls: string,
  rtl = false,
): string => {
  const [c1, r1, c2, r2] = range;
  return `<div class="c ${cls}" style="grid-area: ${String(r1)} / ${String(COLUMN(c1))} / ${String(r2 + 1)} / ${String(COLUMN(c2) + 1)};"${rtl ? ' dir="rtl"' : ''}>${inner}</div>`;
};

export const RECEIPT_STYLE = `  .receipt { display: grid; width: ${String(RECEIPT_BLOCK_WIDTH_MM)}mm; grid-template-columns: ${RECEIPT_COLUMN_SHARES.map((s) => `${String(s)}fr`).join(' ')}; grid-template-rows: ${RECEIPT_ROWS_PT.map((h) => `${String(h)}pt`).join(' ')}; direction: ltr; }
  .receipt .c { display: flex; align-items: center; justify-content: center; text-align: center; white-space: nowrap; }
  .receipt .frame { border: 1px solid #000; }
  .receipt .box { outline: 1px solid #000; outline-offset: -0.5px; }
  .receipt .b16 { font-size: 16pt; font-weight: 700; }
  .receipt .r16 { font-size: 16pt; font-weight: 400; }
  .receipt .b12 { font-size: 12pt; font-weight: 700; }
  .receipt .right { justify-content: flex-start; text-align: right; padding-right: 2mm; }
  .receipt .sentence .n { font-size: 16pt; }
`;

/** The page's cells, in reading order. */
const receiptCells = (dto: AtmReceiptPrintDto): string[] => {
  const title = `${RECEIPT_WORDS.titlePrefix} ${dto.bankNameAr} ${RECEIPT_WORDS.titleSuffix}`;
  const cells = [
    cell(['B', 2, 'I', 24], '', 'frame'),
    cell(['B', 3, 'C', 3], ltr(formatPaperDate(cairoDay(dto.printedAt))), 'b16'),
    cell(['D', 3, 'I', 3], esc(title), 'b16 right', true),
    cell(['C', 7, 'E', 7], esc(RECEIPT_WORDS.count), 'r16 box', true),
    cell(['F', 7, 'H', 7], esc(RECEIPT_WORDS.denomination), 'r16 box', true),
  ];
  dto.rows.forEach((row, i) => {
    const r = 8 + i;
    cells.push(
      cell(['C', r, 'E', r], ltr(int(row.notes)), 'r16 box'),
      cell(['F', r, 'H', r], ltr(String(row.denomination)), 'r16 box'),
    );
  });
  cells.push(
    cell(['C', 14, 'E', 14], ltr(int(fromMinorUnits(dto.egpTotalMinor))), 'r16 box'),
    cell(['F', 14, 'H', 14], esc(RECEIPT_WORDS.total), 'r16 box', true),
    cell(
      ['C', 16, 'H', 16],
      `<span>${esc(RECEIPT_WORDS.sentenceStart)} <b class="n">${ltr(String(dto.machineCount))}</b> ${esc(RECEIPT_WORDS.sentenceEnd)}</span>`,
      'b12 sentence',
      true,
    ),
    cell(['G', 19, 'H', 19], esc(RECEIPT_WORDS.supervisor), 'b12', true),
  );
  return cells;
};

/** «بيان التغذية» — `(dto, words) → string`, pure; Arabic whatever the screen's language. */
export const buildReceiptHtml = (
  dto: AtmReceiptPrintDto,
  words: SettlementPaperWords = settlementPaperWords(),
): string =>
  paperDocument({
    title: `${RECEIPT_WORDS.titlePrefix} ${dto.bankNameAr}`,
    orientation: 'landscape',
    style: RECEIPT_STYLE,
    pages: `<section class="page"><div class="receipt">${receiptCells(dto).join('')}</div></section>`,
    words,
  });
