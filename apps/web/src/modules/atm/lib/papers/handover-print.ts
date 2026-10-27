// «سيلزات» — the handover of the day's bags to the ATM vault — and the route sheets built on it
// (docs/12-planning/atm-settlements-phase1.md §8.4, S-8, DS-17, SEC-27).
//
// THE PAPER'S COLUMNS, left to right as it prints: ID · LOC · the run (new, S-5) · Total · the bag
// QR under the PRINT day (the paper's D1, `=TODAY()`, GS-28) · TYPE under the bank's short name
// (the paper's E1, «البركة») · HUB. The header is white Tahoma bold on black and repeats on every
// page (`thead`); the rows are Calibri bold, the footer Arial bold, each at the paper's size scaled
// as the header is (13 → 10 pt). Only real lines print — no zero rows.
//
// THE QR BOX. Settlements prints it blank, for handwriting, as today. Control & Supplies prints the
// QRs of PREPARED lines only (the server sends none for the others, SEC-27): a line that is not
// prepared prints a blank box, and a line of two bags lists «1: …» and «2: …» in the one cell.
//
// A ROUTE SHEET (S-8 b) is this paper, one route per page, under a title line; routes mix banks
// (DS-17), so it adds a narrow bank column (taken from LOC's width) and prints the neutral `TYPE`
// over F.
import {
  fromMinorUnits,
  type AtmBankCode,
  type AtmHandoverPrintDto,
  type AtmHandoverPrintRowDto,
  type AtmRoutesPrintDto,
} from '@ecms/contracts';
import { cairoDay, formatPaperDate, runCompact } from '../settlement-dates';
import { SEALS_WORDS } from './settlement-paper-wording';
import {
  esc,
  int,
  ltr,
  paperDocument,
  settlementPaperWords,
  type SettlementPaperWords,
} from './settlement-print';

/**
 * ID · LOC · run · Total · bag QR · TYPE · HUB, as shares of the table. The run column is 10 %
 * (taken from LOC): «3 · 10:45 م» at 10 pt bold needs about 16 mm, more than the 8 % (15 mm, less the
 * padding) first drawn, and the cell never wraps (the AM/PM marker must stay beside its time).
 */
export const HANDOVER_COLUMN_SHARES = [9.8, 18.2, 10, 9.3, 28.6, 12.6, 11.5] as const;
/** The route sheet's bank column, taken from LOC's width. */
const ROUTE_BANK_SHARE = 6;

const shortBankName = (bank: AtmBankCode): string =>
  (SEALS_WORDS.shortBankName as Partial<Record<AtmBankCode, string>>)[bank] ?? bank;

/** The QR cell: blank unless the row carries QRs; two bags as «1: …» and «2: …». */
const qrCell = (row: AtmHandoverPrintRowDto): string => {
  const qrs = row.qrs;
  if (qrs.length === 0) return '';
  if (qrs.length === 1) return ltr(qrs[0]);
  return qrs
    .map((qr, i) => `<div class="qr">${ltr(`${String(i + 1)}: ${qr ?? ''}`)}</div>`)
    .join('');
};

/** The machine's code; a spare set's code, or «—» when it has none. */
const codeOf = (row: AtmHandoverPrintRowDto): string => {
  const code = row.machineCode ?? row.spareCode;
  return code === null ? '—' : ltr(code);
};

/**
 * The machine type, with a line-break chance after each «)»: a label such as `BRK(DN)recycle` is one
 * word wider than its column, and `overflow-wrap: break-word` would split it mid-word («recycl» /
 * «e»). It breaks as `BRK(DN)` / `recycle` instead.
 */
const typeCell = (label: string | null): string => esc(label).replaceAll(')', ')<wbr>');

const rowHtml = (row: AtmHandoverPrintRowDto, withBank: boolean): string =>
  `<tr><td>${codeOf(row)}</td>${withBank ? `<td>${ltr(row.bankCode)}</td>` : ''}<td dir="rtl">${esc(row.machineName)}</td><td class="run" dir="rtl">${esc(runCompact(row.run, row.scheduleTime))}</td><td>${ltr(int(fromMinorUnits(row.egpTotalMinor)))}</td><td class="qrs">${qrCell(row)}</td><td dir="rtl">${typeCell(row.typeLabel)}</td><td dir="rtl">${esc(row.hubLabel)}</td></tr>`;

const table = ({
  rows,
  printDay,
  typeHeader,
  words,
  withBank,
}: {
  rows: readonly AtmHandoverPrintRowDto[];
  printDay: string;
  typeHeader: string;
  words: SettlementPaperWords;
  withBank: boolean;
}): string => {
  const shares = withBank
    ? [
        HANDOVER_COLUMN_SHARES[0],
        ROUTE_BANK_SHARE,
        HANDOVER_COLUMN_SHARES[1] - ROUTE_BANK_SHARE,
        ...HANDOVER_COLUMN_SHARES.slice(2),
      ]
    : [...HANDOVER_COLUMN_SHARES];
  const head = [
    'ID',
    ...(withBank ? [esc(words.bank)] : []),
    'LOC',
    esc(words.runShort),
    'Total',
    ltr(printDay),
    esc(typeHeader),
    'HUB',
  ];
  return `<table class="seals"><colgroup>${shares.map((s) => `<col style="width: ${String(s)}%;" />`).join('')}</colgroup><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => rowHtml(row, withBank)).join('')}</tbody></table>`;
};

const footer = (): string =>
  `<div class="foot" dir="rtl"><p>${esc(SEALS_WORDS.footer)}</p><p>${esc(SEALS_WORDS.supervisor)}</p></div>`;

export const HANDOVER_STYLE = `  .sheet { width: 190mm; }
  .seals { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #000; }
  .seals thead { display: table-header-group; }
  .seals th { background: #000; color: #fff; font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size: 10pt; font-weight: 700; height: 9mm; border: 1px solid #000; text-align: center; vertical-align: middle; }
  .seals td { font-size: 10pt; font-weight: 700; height: 9mm; padding: 0 1mm; border-top: 1px solid #000; text-align: center; vertical-align: middle; overflow-wrap: break-word; }
  .seals td.run { white-space: nowrap; }
  .seals tr { break-inside: avoid; }
  .seals .qr { line-height: 1.2; }
  .foot { font-family: Arial, "Segoe UI", sans-serif; font-size: 12pt; font-weight: 700; text-align: center; margin-top: 6mm; }
  .foot p { margin: 0 0 3mm; }
  .route-title { font-size: 12pt; font-weight: 700; margin: 0 0 3mm; text-align: center; }
`;

/** «سيلزات» — `(dto, words) → string`, pure; Arabic whatever the screen's language. */
export const buildHandoverHtml = (
  dto: AtmHandoverPrintDto,
  words: SettlementPaperWords = settlementPaperWords(),
): string =>
  paperDocument({
    title: `${shortBankName(dto.bankCode)} ${formatPaperDate(dto.replenishDate)}`,
    orientation: 'portrait',
    style: HANDOVER_STYLE,
    pages: `<section class="page flow"><div class="sheet">${table({
      rows: dto.rows,
      printDay: formatPaperDate(cairoDay(dto.printedAt)),
      typeHeader: shortBankName(dto.bankCode),
      words,
      withBank: false,
    })}${footer()}</div></section>`,
    words,
    fixedPages: false,
  });

/** The route sheets: one page per route, under «كشف خط {name} · {leader} · {date}». */
export const buildRoutesHtml = (
  dto: AtmRoutesPrintDto,
  words: SettlementPaperWords = settlementPaperWords(),
): string => {
  const printDay = formatPaperDate(cairoDay(dto.printedAt));
  const day = formatPaperDate(dto.replenishDate);
  const pages = dto.routes.map((route) => {
    const title = [`${words.routeSheet} ${route.name}`, route.leaderName, day]
      .filter((part): part is string => part !== null && part !== '')
      .map((part) => esc(part))
      .join(' · ');
    return `<section class="page flow"><div class="sheet"><p class="route-title" dir="rtl">${title}</p>${table(
      { rows: route.rows, printDay, typeHeader: 'TYPE', words, withBank: true },
    )}${footer()}</div></section>`;
  });
  return paperDocument({
    title: `${words.routeSheet} ${day}`,
    orientation: 'portrait',
    style: HANDOVER_STYLE,
    pages: pages.join('\n'),
    words,
    fixedPages: false,
  });
};
