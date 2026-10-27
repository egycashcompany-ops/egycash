// The ATM settlement papers' one door (docs/12-planning/atm-settlements-phase1.md §8, DS-21): the
// print flow every paper follows, the document around a paper's pages, and the words a paper says
// that are not the owner's own.
//
// THE FLOW, IN THE CLICK (§8, UI-11):
//   1. the tab opens FIRST, while the click still counts as the user's (`openPrintWindow`). When the
//      browser blocks it, nothing is requested — so nothing is counted or audited — and the caller
//      shows `atm.paper.popupBlocked`;
//   2. the print is POSTed (it is a write of record: it counts Notes, records what «بيان التغذية»
//      covered, and audits). A failure closes the tab and rethrows, so the caller maps the error;
//   3. the composed document is written into the tab, which prints itself.
//
// THE DOCUMENT carries no script and no inline handler: its two buttons are `data-print` and
// `data-close`, wired by the app (`shared/lib/print-window.ts`). Every value is escaped. Codes,
// numbers, dates and QR values are isolated left-to-right (`<bdi dir="ltr">`). The EGYCASH logo
// (about 55 KB of base64) is written ONCE, as a CSS rule, however many Notes the document holds
// (UI-13). Chrome drops background fills unless told, and the papers' label fills are part of the
// form, so the colours are kept (`print-color-adjust: exact`).
//
// THE WORDS. A paper speaks Arabic whatever the screen's language (UI-12): the owner's words come
// from `settlement-paper-wording.ts`, the new ones from `translate('ar', 'atm.paper.*')` here.
import { EGYCASH_LOGO } from '../../../gold/lib/egycash-logo';
import { translate } from '../../../../platform/localization/i18n';
import { PAPER_FONT_CSS, STACK } from '../../../../shared/lib/paper-fonts';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';

/** The words a paper prints that are not the owner's: formal i18n keys, always in Arabic. */
export interface SettlementPaperWords {
  run: Readonly<Record<1 | 2 | 3, string>>;
  at: string;
  bag: string;
  bank: string;
  spareSet: string;
  runShort: string;
  routeSheet: string;
  /** The tab's toolbar. */
  print: string;
  close: string;
}

const ar = (key: string): string => translate('ar', key);

/** Built with `translate('ar', …)`: a user working in English still prints Arabic papers. */
export const settlementPaperWords = (): SettlementPaperWords => ({
  run: { 1: ar('atm.paper.run.1'), 2: ar('atm.paper.run.2'), 3: ar('atm.paper.run.3') },
  at: ar('atm.paper.at'),
  bag: ar('atm.paper.bag'),
  bank: ar('atm.paper.bank'),
  spareSet: ar('atm.paper.spareSet'),
  runShort: ar('atm.paper.runShort'),
  routeSheet: ar('atm.paper.routeSheet'),
  print: ar('common.print'),
  close: ar('common.close'),
});

// ── Text ────────────────────────────────────────────────────────────────────

export const esc = (value: string | number | null | undefined): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** A code, a number, a date or a QR value, kept left-to-right inside Arabic text. */
export const ltr = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? '' : `<bdi dir="ltr">${esc(value)}</bdi>`;

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Excel's `#,##0`: Western digits, comma thousands, no decimals. */
export const int = (value: number): string => GROUPED.format(value);

// ── The document ────────────────────────────────────────────────────────────

export type PaperOrientation = 'portrait' | 'landscape';

/**
 * A flowing paper (the seals sheet, the route sheets) runs over as many sheets as it needs, so each
 * sheet keeps a printable band at its top and bottom: an office laser cannot print the outer ~4 mm,
 * and the header row and the last row would be cut. The sides need none — the table is 190 mm wide,
 * centred on 210. A one-block paper (the Note, «بيان التغذية») is centred on its sheet: margin 0.
 */
export const FLOW_PAGE_MARGIN = '10mm 0';

const shellStyle = (orientation: PaperOrientation, fixedPages: boolean): string => {
  const [width, height] = orientation === 'portrait' ? ['210mm', '297mm'] : ['297mm', '210mm'];
  return `${PAPER_FONT_CSS}
  * { box-sizing: border-box; }
  @page { size: A4 ${orientation}; margin: ${fixedPages ? '0' : FLOW_PAGE_MARGIN}; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; }
  body { font-family: ${STACK.cal}; color: #000; }
  bdi { unicode-bidi: isolate; }
  .page { width: ${width};${fixedPages ? ` height: ${height}; display: flex; align-items: center;` : ' display: flex; flex-direction: column; align-items: center;'} justify-content: center; overflow: hidden; break-after: page; break-inside: avoid; }
  .page:last-of-type { break-after: auto; }
  .bar { display: none; }
  @media screen {
    html { background: #d9dbe3; }
    body { padding: 68px 16px 32px; }
    .page { margin: 0 auto 24px; background: #fff; box-shadow: 0 4px 22px rgba(20, 24, 60, 0.22); }
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 20px; background: #2e2e74; font-family: Tahoma, Arial, sans-serif; font-size: 14px; z-index: 1; }
    .bar button { font: inherit; padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.55); background: transparent; color: #fff; cursor: pointer; }
    .bar button.primary { background: #fff; color: #2e2e74; border-color: #fff; font-weight: 700; }
  }
`;
};

/**
 * The whole document around a paper's pages: the A4 page rule, the fonts, the logo (once, when the
 * paper shows it), the paper's own rules, and the tab's toolbar — `data-print` / `data-close`.
 */
export const paperDocument = ({
  title,
  orientation,
  style,
  pages,
  words,
  logo = false,
  fixedPages = true,
}: {
  title: string;
  orientation: PaperOrientation;
  /** The paper's own rules, after the shell's. */
  style: string;
  /** Each page already wrapped in `<section class="page">`. */
  pages: string;
  words: Pick<SettlementPaperWords, 'print' | 'close'>;
  /** Writes `.egc-logo` once, for every page to use. */
  logo?: boolean;
  /** A paper of one block per page (the Note, «بيان التغذية»); a flowing table passes false. */
  fixedPages?: boolean;
}): string => `<!doctype html>
<html lang="ar"><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>
${shellStyle(orientation, fixedPages)}${logo ? `  .egc-logo { background: url("${EGYCASH_LOGO}") no-repeat center / contain; }\n` : ''}${style}</style></head>
<body>
<div class="bar">
  <button type="button" class="primary" data-print>${esc(words.print)}</button>
  <button type="button" data-close>${esc(words.close)}</button>
</div>
${pages}
</body></html>`;

// ── The door ────────────────────────────────────────────────────────────────

/**
 * The print, start to finish, in the click: the tab first, then the request, then the paper.
 * Answers what was printed, or null when the browser refused the tab — in which case nothing was
 * requested and the caller shows `atm.paper.popupBlocked`. A failed request closes the tab and
 * rethrows, so a refused print never leaves an empty tab behind.
 */
export const printSettlementPaper = async <T>({
  loading,
  load,
  compose,
}: {
  /** What the tab shows while the request runs (`common.loading`). */
  loading: string;
  load: () => Promise<T>;
  compose: (dto: T) => string;
}): Promise<T | null> => {
  const win = openPrintWindow(loading);
  if (win === null) return null;
  try {
    const dto = await load();
    writePrintWindow(win, compose(dto));
    return dto;
  } catch (error) {
    win.close();
    throw error;
  }
};
