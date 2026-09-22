// A printed Fleet report — the company's own form, not a screenshot of a table.
//
// «اعمل نفس دول بالظبط», against the four documents the owner sent: EGYCASH letterhead, the
// department under the company name, the title centred in bold, a rule, the table with a «م»
// serial down its edge, the totals, and then the part that makes it a document rather than a
// print-out — the signature block it goes up for, and the line asking the executive to endorse
// the figures. It is filed in a binder and signed by hand, so every one of those is required.
//
// WHY THE SIGNATORIES ARE PASSED IN. They are people, and people move. They arrive from Fleet
// settings («في إعدادات الحركة») and this module never names one: a name frozen here would mean a
// release every time somebody was promoted.
//
// Standalone HTML on purpose, the idiom `gold/lib/gold-print.ts` and `violations-print.ts` already
// use: what prints is what this file says and nothing the app's stylesheet contributes.
import { EGYCASH_LOGO } from '../../gold/lib/egycash-logo';

/** The company's own indigo, from `gold-print.ts` — a printed record's letterhead is not a theme. */
const BRAND = {
  primary: '#2e2e74',
  text: '#1f2340',
  muted: '#6b6f86',
  line: '#9a9cb5',
  tintHead: '#ececf7',
} as const;

/** Who signs. Every line comes from settings; a blank one drops out rather than printing empty. */
export interface ReportSignatories {
  preparedByTitle: string;
  preparedByName: string;
  approvedByTitle: string;
  approvedByName: string;
  endorsementNote: string;
  endorsedByName: string;
}

/**
 * One figure under the table. The company sheet carries three side by side, the drivers' sheet one
 * — so this is a list, and the layout follows its length rather than the other way round.
 */
export interface ReportTotal {
  label: string;
  value: string;
}

export interface FleetReport {
  /** Centred, bold — «مخالفات تتحملهـا الشركــــة». */
  title: string;
  /** The department line under the company name. */
  department: string;
  /** What the page is a view OF — the filters in force. Omitted when there are none. */
  subtitle: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
  /**
   * Figures printed UNDER the table, side by side — the company sheet's three.
   *
   * A sheet uses this or `totalRow`, not both: they are two ways of saying the same thing, and
   * saying it twice on a document somebody signs is how two numbers come to disagree.
   */
  totals: readonly ReportTotal[];
  /**
   * The bottom LINE of the table — the drivers' sheet, where «إجمالى السائقين» runs across the
   * row and the money lands in the column it sums. Inside the border, because that is where the
   * signed copies put it.
   */
  totalRow?: ReportTotal;
  signatories: ReportSignatories;
  /** The serial column's heading — «م». Passed so the caller owns every word on the page. */
  serialHeader: string;
  /** Printed when the filters matched nothing, so an empty page is still evidence. */
  emptyLabel: string;
}

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * The tiny script the document carries so it prints once the LOGO has decoded.
 *
 * The closing tag is assembled from two pieces on purpose — writing the literal `</script>` in
 * this module would end the tag early if the bundle were ever inlined into an HTML page. Same
 * reasoning, and the same spelling, as `gold-print.ts`.
 */
const PRINT_ON_LOAD = `<script>window.onload = () => { window.setTimeout(() => window.print(), 250); };</${'script'}>`;

const FONTS =
  "@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Tajawal:wght@400;500;700&display=swap');";

/** One signature column: the office, the person, and the line they sign on. */
const signature = (title: string, name: string): string =>
  `<div class="sig"><div class="office">${esc(title)}</div><div class="who">${esc(name)}</div><div class="on">التوقيع / </div></div>`;

/** The printable document. Exported for its own test — composing it is where the rules live. */
export const buildFleetReportHtml = (doc: FleetReport): string => {
  const s = doc.signatories;
  const head = [doc.serialHeader, ...doc.header].map((h) => `<th>${esc(h)}</th>`).join('');
  // THE SERIAL IS GENERATED, NOT CARRIED. «م» numbers the printed page — 1, 2, 3 down the sheet —
  // so a reader signing it can point at a line. It is not a row id and never survives a re-sort.
  const body = doc.rows
    .map(
      (row, i) =>
        `<tr><td class="ser">${String(i + 1)}</td>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  // The bottom line, inside the table's border: the label spans everything up to the last column
  // and the figure lands in it — which is the money column on both of these sheets.
  const span = doc.header.length;
  const totalRow =
    doc.totalRow === undefined
      ? ''
      : `<tr class="trow"><th colspan="${String(span)}">${esc(doc.totalRow.label)}</th><td>${esc(doc.totalRow.value)}</td></tr>`;
  const totals = doc.totals
    .map(
      (total) =>
        `<div class="total"><div class="tl">${esc(total.label)}</div><div class="tv">${esc(total.value)}</div></div>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>${esc(doc.title)}</title>
<style>
  ${FONTS}
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 14mm; }
  body { font-family: Tajawal, sans-serif; color: ${BRAND.text}; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .head img { height: 46px; }
  .org { text-align: right; font-size: 12.5px; line-height: 1.9; font-weight: 700; }
  .rtitle { flex: 1; text-align: center; font-family: Cairo; font-weight: 800; font-size: 19px; color: ${BRAND.text}; }
  .rule { border: none; border-top: 1px solid ${BRAND.line}; margin: 12px 0 18px; }
  .sub { font-size: 12px; color: ${BRAND.muted}; margin: -8px 0 14px; text-align: center; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #333; padding: 6px 8px; text-align: center; }
  thead th { background: ${BRAND.tintHead}; font-weight: 700; }
  td.ser { width: 34px; }
  .totals { display: flex; justify-content: center; gap: 72px; margin: 30px 0 0; }
  .total { text-align: center; font-size: 13px; }
  .total .tl { font-weight: 700; }
  .total .tv { font-weight: 700; margin-top: 14px; }
  .signs { display: flex; justify-content: center; gap: 110px; margin-top: 54px; }
  .sig { text-align: center; font-size: 12.5px; line-height: 2; }
  .sig .office { font-weight: 700; }
  .sig .who { font-weight: 700; }
  .endorse { text-align: center; font-size: 12.5px; line-height: 2; margin-top: 46px; }
  .endorse .who { font-weight: 700; }
  tr.trow th, tr.trow td { font-weight: 800; font-size: 13px; padding: 9px 8px; }
  .empty { text-align: center; font-size: 12px; color: ${BRAND.muted}; padding: 18px 0; }
</style></head>
<body>
  <div class="head">
    <img src="${EGYCASH_LOGO}" alt="EGYCASH" />
    <div class="rtitle">${esc(doc.title)}</div>
    <div class="org"><div>ايجى كاش للحلول النقدية</div><div>${esc(doc.department)}</div></div>
  </div>
  <hr class="rule" />
  ${doc.subtitle === '' ? '' : `<p class="sub">${esc(doc.subtitle)}</p>`}
  ${
    doc.rows.length === 0
      ? `<p class="empty">${esc(doc.emptyLabel)}</p>`
      : `<table><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table>`
  }
  ${totals === '' ? '' : `<div class="totals">${totals}</div>`}
  <div class="signs">${signature(s.preparedByTitle, s.preparedByName)}${signature(s.approvedByTitle, s.approvedByName)}</div>
  ${
    s.endorsementNote === '' && s.endorsedByName === ''
      ? ''
      : `<div class="endorse"><div>${esc(s.endorsementNote)}</div><div class="who">${esc(s.endorsedByName)}</div><div>التوقيع / </div></div>`
  }
  ${PRINT_ON_LOAD}
</body></html>`;
};

/**
 * Open the composed document and print it.
 *
 * Throws on a blocked popup so the caller can say so — a silent no-op reads as a broken button.
 * The wait is longer than the plain table's was because this page carries the logo, and printing
 * before it decodes would put a company document on paper without its letterhead.
 */
export const printFleetReport = (doc: FleetReport): void => {
  const win = window.open('', '_blank');
  if (win === null) throw new Error('popup blocked');
  win.document.open();
  win.document.write(buildFleetReportHtml(doc));
  win.document.close();
  win.focus();
};
