// THE custody papers' one door — what every screen calls to show or print a memo or a letter.
//
// «المذكرات» (the memo view, the editor's preview, «حفظ وطباعة»), the fund's three dialogs, «سجل
// العهدة»'s drawer and «إعداد المذكرات» all draw the same seven papers through here, so the app has
// one paper of each kind, not copies of it:
//   memoSheets(memoPaperOf(memo))          → a saved memo, with the names it was saved with
//   letterSheets(letterPaperOf(operation)) → a recorded letter, with its frozen bracket figure
//   memoSheets({ kind, lines, signatures }) / letterSheets({ kind: 'charge', … }) → a draft
// Each returns one self-contained HTML string per A4 sheet; `PaperTray` shows them, and
// `printPaperAfter` prints them.
//
// The papers are HIS (`custody-paper-wording.ts`): they never call `t()` and never read the locale,
// so a user on the English interface prints the same Arabic paper. They print no memo number, no
// name and no date of the app's — «اسم المذكرة» is the print window's title (the PDF's file name)
// and nothing more.
//
// NO SCRIPT INSIDE THE PAGE. The print tab inherits the app's Content-Security-Policy, so the
// document carries no `<script>` and no inline handler; it is opened, written and wired through
// `shared/lib/print-window.ts`, every printed document's one door.
import type {
  FleetCustodyFundSummaryDto,
  FleetCustodyLetter,
  FleetCustodyMemoDto,
  FleetCustodyOperationDto,
  FleetCustodySource,
} from '@ecms/contracts';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import { dayOf, esc } from './custody-paper-format';
import { PAPER_FONT_CSS, paperFontsReady } from './custody-paper-fonts';
import { type LetterPaperInput, replenishRowsOf, settleRowsOf } from './custody-paper-letters';
import { type MemoPaperInput } from './custody-paper-memos';
import { LETTER_TITLE, MEMO_FILE_NAME } from './custody-paper-wording';

export type { MemoPaperInput, MemoPaperLine } from './custody-paper-memos';
export type {
  ChargeLetterInput,
  LetterPaperInput,
  ReplenishLetterInput,
  SettleLetterInput,
} from './custody-paper-letters';
export { memoSheets, memoTotal } from './custody-paper-memos';
export {
  chargeLetterSentence,
  letterSheets,
  replenishRowsOf,
  settleRowsOf,
} from './custody-paper-letters';
export { paperFontsReady } from './custody-paper-fonts';

/** A saved memo as its paper: its lines in its order, and the names it was saved with. */
export const memoPaperOf = (memo: FleetCustodyMemoDto): MemoPaperInput => ({
  kind: memo.kind,
  lines: memo.lines.map((line) => ({
    code: line.vehicleCode ?? '',
    date: dayOf(line.date),
    amount: line.amount,
    mission: line.mission,
    statement: line.statement,
    note: line.note,
  })),
  signatures: memo.signatures,
});

/** A recorded operation as its letter — the bracket figure and the names it was recorded with. */
export const letterPaperOf = (op: FleetCustodyOperationDto): LetterPaperInput => {
  const date = dayOf(op.date);
  const from = op.from === null ? null : dayOf(op.from);
  const to = op.to === null ? null : dayOf(op.to);
  switch (op.kind) {
    case 'charge':
      return {
        kind: 'charge',
        date,
        amount: op.amount,
        reason: op.reason,
        signatures: op.signatures,
      };
    case 'replenish':
      return {
        kind: 'replenish',
        date,
        from,
        to,
        amount: op.amount,
        custody: op.letterFigure ?? 0,
        rows: replenishRowsOf(op.memos.map((memo) => ({ kind: memo.kind, total: memo.amount }))),
        signatures: op.signatures,
      };
    case 'settle':
      return {
        kind: 'settle',
        date,
        from,
        to,
        amount: op.amount,
        custody: op.letterFigure ?? 0,
        rows: settleRowsOf(
          op.parts.map((part) => ({
            part: part.part,
            cars: part.cars,
            amount: part.amount,
            date: dayOf(part.date),
          })),
        ),
        signatures: op.signatures,
      };
  }
};

/**
 * The bracket figure a letter not yet recorded will print — the API's `letterFigureOf`: a
 * replenishment's «عهده اداره الحركه ( X )» is everything ever charged into the fund, a
 * settlement's «من العهده ( X )» is the fund as it stands.
 */
export const draftLetterFigure = (
  kind: 'replenish' | 'settle',
  fund: Pick<FleetCustodyFundSummaryDto, 'fundTotal' | 'charged'>,
): number => (kind === 'replenish' ? fund.charged.amount : fund.fundTotal);

/**
 * The name a memo's PDF is saved under (the print window's title): the name it was given, its
 * runs of spaces made one, else his paper's title for its kind.
 */
export const memoFileName = (memo: { kind: FleetCustodySource; name: string }): string => {
  const typed = memo.name.replace(/\s+/gu, ' ').trim();
  return typed === '' ? MEMO_FILE_NAME[memo.kind] : typed;
};

/** The name a letter's PDF is saved under: his title — «استعاضه عهدة», «تسويه عهدة», «صرف عهدة». */
export const letterFileName = (kind: FleetCustodyLetter): string => LETTER_TITLE[kind];

/**
 * The print document: the sheets one to an A4 page, the paper faces and `@page` declared once in
 * its head. Its `<title>` is what «Save as PDF» names the file.
 */
export const paperDocument = (sheets: readonly string[], title: string): string =>
  [
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><title>${esc(title)}</title><style>`,
    PAPER_FONT_CSS,
    '@page{size:A4;margin:0}',
    'html,body{margin:0;padding:0;background:#fff}',
    // One sheet to a page, and no blank page after the last.
    '.xm-sheet,.wl-sheet{break-after:page}',
    'body>:last-child{break-after:auto}',
    `</style></head><body>${sheets.join('')}</body></html>`,
  ].join('\n');

/**
 * THE print: the tab FIRST — synchronously, while the click still counts as the user's (a popup
 * blocker refuses a tab opened after an await) — then the faces (the maintenance «البيان»
 * shrink-to-fit measures with them), then `compose` (e.g. awaiting the save, so the paper is the
 * SAVED one), then the document is written and prints itself.
 * Answers false when the browser refused the tab; a failing `compose` closes the tab and rethrows,
 * so a refused save never leaves an empty tab behind.
 */
export const printPaperAfter = async (
  compose: () => Promise<{ sheets: readonly string[]; title: string }>,
  waiting: string,
): Promise<boolean> => {
  const win = openPrintWindow(waiting);
  if (win === null) return false;
  try {
    await paperFontsReady();
    const { sheets, title } = await compose();
    writePrintWindow(win, paperDocument(sheets, title));
    return true;
  } catch (error) {
    win.close();
    throw error;
  }
};
