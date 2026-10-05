// إقرار استلام — the IT department's custody acknowledgment, printed from the system (FR-18).
//
// «ومعلش هنغير التصميم بتاع الطباعة فى الـ IT فقط لدا»: the owner replaced the item-table receipt
// with the department's own form, and this is that form, ONE PAGE PER DEVICE. The letterhead (the
// logo, and «قطاع تكنولوجيا المعلومات» on its banner) over a rule; «إقرار استلام»; the statement —
// «أقر أنا / … بوظيفة … بشركة إيجي كاش لتكنولوجيا الحلول النقدية، بطاقة رقم قومي … بأنني قد استلمت
// جهاز … برقم مسلسل … ومواصفاته كالتالي:»; the specifications table (Component / Details, grouped
// System · Storage · Graphics · Network); «ومشتملاته كالتالي:» and its numbered list; the
// undertaking; «وهذا إقرار مني بذلك»; «المقر بما فيه» with the name, signature and date on the
// left; and the footer «EGYCASH | IT Dept. |» with the paper's own number and the red block. It is
// signed by hand and filed, so its wording is the form's, not ours.
//
// The form's red marks what is filled in for each paper, and it stays red here — filled with what
// the system knows: the employee's name and job, the device's kind and its serial. What the system
// does not hold (the national ID, and where and when it was issued) stays a dotted line for the
// pen. A row of the table nothing was typed against is left off, and so is the whole table, or the
// accessories, when there is nothing to list.
//
// One receipt is one number: a hand-over of three devices prints three pages under it, each with
// the page count in the footer's red block.
//
// Standalone HTML on purpose — the `fleet-report-print.ts` / `gold-print.ts` idiom: what prints is
// what this file says and nothing the app's stylesheet contributes. No web font either: the page
// must print the moment it opens, in an office whose machines already have the form's faces.
//
// NO SCRIPT INSIDE THE PAGE. The tab is opened from the app, so it inherits the app's
// Content-Security-Policy (`script-src 'self'`, `script-src-attr 'none'`): an inline `<script>` or
// an `onclick` written into it never runs. Everything the page does — print on open, the toolbar's
// `data-print` and `data-close` buttons — is attached by the app's own script, which the policy
// allows (`shared/lib/print-window.ts`, every printed document's one door).
import {
  IT_ASSET_SPEC_TABLE,
  IT_CUSTODY_RECEIPT_FORM,
  formatCustodyReceiptNumber,
  type ItCustodyReceiptDocumentDto,
  type ItCustodyReceiptLineDto,
} from '@ecms/contracts';
import { EGYCASH_LOGO } from '../../gold/lib/egycash-logo';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';

/** The words the tab around the paper shows, in the reader's language — the paper is Arabic. */
export interface ReceiptWindowLabels {
  /** Shown while the receipt is fetched. */
  waiting: string;
  /** The toolbar's print button. */
  print: string;
  /** The toolbar's close button. */
  close: string;
}

/** The form's colours, as its template draws them. */
const COLORS = {
  /** What is filled in for each paper. */
  fill: '#f00',
  /** The table's header row and first column. */
  shade: '#d9d9d9',
  /** The footer's block. */
  block: '#943634',
  /** The banner: two stripes, then the bar the department's name is written on. */
  stripe1: '#353687',
  stripe2: '#3f4099',
  bar: '#5e60ab',
} as const;

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Arabic-Indic digits, never grouped — «٢٠٢٣», not «٢٬٠٢٣». */
const arabicDigits = new Intl.NumberFormat('ar-EG', { useGrouping: false });

/**
 * «التاريخ: ٣٠ / ٨ / ٢٠٢٣» — day, month, year, as the form writes it, in the reader's own clock:
 * a hand-over at 01:00 Cairo time is that day's paper, not the previous UTC day's.
 */
export const receiptDate = (iso: string): string => {
  const at = new Date(iso);
  return [at.getDate(), at.getMonth() + 1, at.getFullYear()]
    .map((part) => arabicDigits.format(part))
    .join(' / ');
};

/** The footer's number: the paper's own, or the form's bare prefix for a receipt never numbered. */
export const receiptNumberLabel = (formNumber: number | null): string =>
  formNumber === null ? IT_CUSTODY_RECEIPT_FORM.prefix : formatCustodyReceiptNumber(formNumber);

/** The undertaking, as the form words it. The employee signs THIS, so it is never paraphrased. */
export const RECEIPT_UNDERTAKING =
  'وذلك لاستخدامه في إنهاء أعمال الشركة وأتعهد بالحفاظ عليه حفاظ الشخص الحريص على ماله الخاص وأتعهد برده إلى الشركة متى طلب مني ذلك.';

/** A filled-in part of the form: in its red, or a dotted line where the system has nothing. */
const fill = (value: string | null | undefined, blank = 24): string => {
  const text = value?.trim() ?? '';
  return `<span class="fill">${text === '' ? '.'.repeat(blank) : `<bdi>${esc(text)}</bdi>`}</span>`;
};

/** «جهاز لاب توب» — the device's kind; the asset's own name for a receipt from before kinds. */
const device = (line: ItCustodyReceiptLineDto): string => {
  const kind = line.deviceType?.trim() || line.name;
  return kind.startsWith('جهاز') ? fill(kind) : `جهاز ${fill(kind)}`;
};

/** One row of the specifications table. */
export interface SpecRow {
  label: string;
  value: string;
}

/**
 * The table the form prints for a device: its groups in the form's order, each with only the rows
 * that have something to say. «Manufacturer / Model» is the asset's make and model; a device with
 * two network adapters prints two rows. Empty when there is nothing to print at all.
 */
export const specGroups = (
  line: ItCustodyReceiptLineDto,
): { group: string | null; rows: SpecRow[] }[] =>
  IT_ASSET_SPEC_TABLE.map(({ group, rows }) => ({
    group,
    rows: rows.flatMap(({ key, label }): SpecRow[] => {
      if (key === 'manufacturerModel') {
        const value = [line.manufacturer, line.model]
          .map((part) => part?.trim() ?? '')
          .filter((part) => part !== '')
          .join(' / ');
        return value === '' ? [] : [{ label, value }];
      }
      if (key === 'networkAdapters') {
        return (line.specs?.networkAdapters ?? []).map((value) => ({ label, value }));
      }
      const value = line.specs?.[key] ?? null;
      return value === null ? [] : [{ label, value }];
    }),
  })).filter((group) => group.rows.length > 0);

const specTable = (groups: ReturnType<typeof specGroups>): string => {
  const body = groups
    .map(
      ({ group, rows }) =>
        (group === null
          ? ''
          : `<tr class="group"><td class="g">${esc(group)}</td><td></td><td></td></tr>`) +
        rows
          .map(
            (row) =>
              `<tr><td class="g"></td><td>${esc(row.label)}</td><td>${esc(row.value)}</td></tr>`,
          )
          .join(''),
    )
    .join('');
  return `<table class="specs" dir="ltr">
    <colgroup><col class="g" /><col class="c" /><col /></colgroup>
    <thead><tr><th class="g"></th><th>Component</th><th>Details</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
};

/** «١. شاحن لاب توب.» — numbered in the form's digits, each item closed with a full stop. */
const accessoryList = (items: readonly string[]): string =>
  items
    .map((item, index) => {
      const text = item.trim();
      const closed = /[.،؛:!؟]$/u.test(text) ? text : `${text}.`;
      return `<div>${arabicDigits.format(index + 1)}. ${esc(closed)}</div>`;
    })
    .join('');

/** The banner on the right of the letterhead, drawn as the template draws it. */
const BANNER = `<svg viewBox="0 0 800 67" preserveAspectRatio="none" aria-hidden="true">
  <polygon points="0,0 80,0 195,67 115,67" fill="${COLORS.stripe1}" />
  <polygon points="115,0 195,0 309,67 229,67" fill="${COLORS.stripe2}" />
  <polygon points="231,0 800,0 800,67 346,67" fill="${COLORS.bar}" />
</svg>`;

/** One device's page. */
const page = (
  paper: ItCustodyReceiptDocumentDto,
  line: ItCustodyReceiptLineDto,
  index: number,
  count: number,
): string => {
  const groups = specGroups(line);
  const number = receiptNumberLabel(paper.formNumber);
  const accessories = line.accessories.filter((item) => item.trim() !== '');
  return `<section class="page">
  <header class="letterhead">
    <img src="${EGYCASH_LOGO}" alt="EGYCASH" />
    <div class="banner">${BANNER}<span>قطاع تكنولوجيا المعلومات</span></div>
  </header>
  <hr class="rule" />
  <h1>إقرار استلام</h1>
  <p class="statement">أقر أنا / ${fill(paper.employeeName, 36)} بوظيفة ${fill(paper.jobTitle?.ar, 32)} بشركة إيجي كاش لتكنولوجيا الحلول النقدية، بطاقة رقم قومي ${fill(null, 26)} – صادرة من قسم ${fill(null, 8)} – ${fill(null, 10)} بتاريخ <span class="fill">..../..../....</span> بأنني قد استلمت ${device(line)} برقم مسلسل ${fill(line.serialNumber, 18)}${groups.length > 0 ? ' ومواصفاته كالتالي:' : '.'}</p>
  ${groups.length > 0 ? specTable(groups) : ''}
  ${accessories.length > 0 ? `<p class="lead">ومشتملاته كالتالي:</p><div class="items">${accessoryList(accessories)}</div>` : ''}
  <p class="undertaking">${RECEIPT_UNDERTAKING}</p>
  <p class="oath">وهذا إقرار مني بذلك ،،،</p>
  <div class="signs">
    <div class="by">المقر بما فيه</div>
    <div>الاسم: ${esc(paper.employeeName ?? '')}</div>
    <div>التوقيع:</div>
    <div>التاريخ: ${receiptDate(paper.issuedAt)}</div>
  </div>
  <footer class="foot">
    <span class="mark"><b>EGYCASH</b> | IT Dept. | ${esc(number)}</span>
    <span class="block">${count > 1 ? `${String(index + 1)}/${String(count)}` : ''}</span>
  </footer>
</section>`;
};

/** The printable acknowledgment. Exported for its own test — composing it is where the rules live. */
export const buildCustodyReceiptHtml = (
  paper: ItCustodyReceiptDocumentDto,
  labels: Pick<ReceiptWindowLabels, 'print' | 'close'>,
): string => {
  const number = receiptNumberLabel(paper.formNumber);
  const pages = paper.lines
    .map((line, index) => page(paper, line, index, paper.lines.length))
    .join('\n');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>إقرار استلام ${esc(number)} — ${esc(paper.employeeName ?? '')}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 10mm 12mm; }
  /* The table's shading and the footer's block are part of the form: printed, not dropped. */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; }
  body { font-family: Arial, 'Simplified Arabic', Tahoma, sans-serif; color: #000; font-size: 16pt; line-height: 1.15; }
  .page { min-height: 274mm; display: flex; flex-direction: column; break-after: page; }
  .page:last-of-type { break-after: auto; }
  .letterhead { display: flex; align-items: center; justify-content: space-between; direction: ltr; }
  .letterhead img { height: 14.5mm; }
  .banner { position: relative; width: 49.5%; aspect-ratio: 800 / 67; }
  .banner svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .banner span { position: absolute; top: 0; bottom: 0; right: 2mm; display: flex; align-items: center; direction: rtl; color: #fff; font-family: Alexandria, 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12pt; white-space: nowrap; }
  .rule { border: 0; border-top: 1.5pt solid #000; margin: 5mm 3.7mm 0; }
  h1 { text-align: center; font-size: 16pt; font-weight: 700; text-decoration: underline; text-underline-offset: 2pt; margin: 3mm 0 4.5mm; }
  .statement, .lead, .items, .undertaking, .signs { margin-left: 12mm; margin-right: 12mm; }
  .statement { margin-top: 0; margin-bottom: 3mm; text-align: justify; }
  /* A filled-in value is read whole: never split across two lines. */
  .fill { color: ${COLORS.fill}; white-space: nowrap; }
  .specs { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.15; }
  .specs col.g { width: 13.9%; }
  .specs col.c { width: 38.2%; }
  .specs th, .specs td { border: 0.5pt solid #000; padding: 0.4mm 1.8mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .specs th { background: ${COLORS.shade}; font-size: 14pt; text-align: center; }
  .specs td.g { background: ${COLORS.shade}; }
  .specs tr.group td.g { font-size: 14pt; font-weight: 700; text-align: center; }
  .lead { margin-top: 1mm; margin-bottom: 0; }
  .items { padding-right: 5mm; line-height: 1.5; }
  .undertaking { margin-top: 3mm; margin-bottom: 0; text-align: justify; line-height: 1.33; }
  .oath { text-align: center; margin: 5mm 0 0; }
  /* On the LEFT half of the page: in a right-to-left page the free margin goes on the start side. */
  .signs { margin-top: 5mm; padding-right: 50%; line-height: 1.6; }
  .signs .by { padding-right: 23mm; margin-bottom: 6mm; }
  .foot { margin-top: auto; display: flex; align-items: flex-start; direction: ltr; padding: 6mm 10.4mm 0; }
  .foot .mark { flex: 1; border-top: 0.5pt solid #000; padding-top: 1.2mm; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; }
  .foot .mark b { font-family: 'Times New Roman', Times, serif; }
  .foot .block { width: 17mm; height: 7.3mm; background: ${COLORS.block}; border-top: 0.5pt solid #c0504d; color: #fff; font-family: Arial, sans-serif; font-size: 10pt; display: flex; align-items: center; justify-content: center; }
  .bar { display: none; }
  /* The tab: each page an A4 sheet on a grey desk, a toolbar above them. Never printed. */
  @media screen {
    html { background: #d9dbe3; }
    body { padding: 68px 16px 32px; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 10mm 12mm; background: #fff; box-shadow: 0 4px 22px rgba(20, 24, 60, 0.22); }
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; background: #2e2e74; color: #fff; font-family: Tahoma, Arial, sans-serif; font-size: 14px; z-index: 1; }
    .bar .number { direction: ltr; font-family: Arial, sans-serif; font-weight: 700; letter-spacing: 0.3px; }
    .bar .actions { display: flex; gap: 8px; }
    .bar button { font: inherit; padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.55); background: transparent; color: #fff; cursor: pointer; }
    .bar button.primary { background: #fff; color: #2e2e74; border-color: #fff; font-weight: 700; }
  }
  @media screen and (max-width: 860px) {
    .page { width: 100%; min-height: 0; padding: 16px; }
    .statement, .lead, .items, .undertaking, .signs { margin-left: 0; margin-right: 0; }
  }
</style></head>
<body>
<div class="bar">
  <span class="number">${esc(number)}</span>
  <span class="actions">
    <button type="button" class="primary" data-print>${esc(labels.print)}</button>
    <button type="button" data-close>${esc(labels.close)}</button>
  </span>
</div>
${pages}
</body></html>`;
};

/** Write the composed acknowledgment into a tab `openPrintWindow` opened; it prints itself. */
export const writeCustodyReceipt = (
  win: Window,
  paper: ItCustodyReceiptDocumentDto,
  labels: ReceiptWindowLabels,
): void => {
  writePrintWindow(win, buildCustodyReceiptHtml(paper, labels));
};

/**
 * The whole print, start to finish: open, fetch, write. Answers the paper that was printed — the
 * caller needs its number — or null when the browser refused the tab; a fetch that fails closes
 * the tab and rethrows, so a refused receipt never leaves an empty tab behind.
 */
export const printCustodyReceipt = async (
  load: () => Promise<ItCustodyReceiptDocumentDto>,
  labels: ReceiptWindowLabels,
): Promise<ItCustodyReceiptDocumentDto | null> => {
  // The tab first, while the click still counts as the user's; the receipt is fetched after.
  const win = openPrintWindow(labels.waiting);
  if (win === null) return null;
  try {
    const paper = await load();
    writeCustodyReceipt(win, paper, labels);
    return paper;
  } catch (error) {
    win.close();
    throw error;
  }
};
