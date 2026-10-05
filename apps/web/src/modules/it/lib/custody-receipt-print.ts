// إيصال استلام — the company's custody receipt (form EGYCASH-IT-F-14), printed from the system.
//
// «وأنا بسلم الموظف جهاز او أصل يكون فى طباعة إيصال الأول (بعتلك صورته)». The owner sent the paper
// the IT department has always used, and this is that paper: the letterhead (the company, the
// department, the date) with the logo opposite, the title, «استلمت أنا» with the table of items —
// «م», «اسم الصنف», «SN», «الحالة», «ملاحظات» — the declaration of responsibility, the signature
// block («المستلم», «التوقيع», «الإسم», «الوظيفة») and the form's own footer. It is signed by hand
// and filed, so every one of those is required, and their wording is the form's, not ours.
//
// What the system adds is only what it knows: the employee's name and job title where the paper
// had blanks, and each item's asset code under its name, so the signed copy can be matched to the
// register by anyone holding it.
//
// Standalone HTML on purpose — the `fleet-report-print.ts` / `gold-print.ts` idiom: what prints is
// what this file says and nothing the app's stylesheet contributes. No web font either: the page
// must print the moment it opens, in an office whose machines already have the Arabic faces.
//
// THE OWNER'S CHANGES (5 October): the footer carries the paper's OWN number —
// «EGYCASH-IT-F-14-0001», one more on every print — and the day it is printed («خلى دا تاريخ
// اليوم»); the signature block sits on the LEFT («شمال مش فى النص»); and the tab shows the paper as
// an A4 sheet, not stretched across the whole window («تبقى A4 مش الصفحة كلها»).
//
// NO SCRIPT INSIDE THE PAGE. The tab is opened from the app, so it inherits the app's
// Content-Security-Policy (`script-src 'self'`, `script-src-attr 'none'`): an inline `<script>` or
// an `onclick` written into it never runs — which is why the print dialog the first version asked
// for never opened. Everything the page does — print on open, the toolbar's `data-print` and
// `data-close` buttons — is attached by the app's own script, which the policy allows
// (`shared/lib/print-window.ts`, every printed document's one door).
import {
  IT_CUSTODY_RECEIPT_FORM,
  formatCustodyReceiptNumber,
  type ItCustodyReceiptDocumentDto,
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

/** The paper's own colour — black on white, as the form is photocopied and filed. */
const INK = '#111';

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Arabic-Indic digits, never grouped — «٢٠٢٣», not «٢٬٠٢٣». */
const arabicDigits = new Intl.NumberFormat('ar-EG', { useGrouping: false });

/**
 * «التاريخ : ٣٠ / ٨ / ٢٠٢٣» — day, month, year, as the form writes it, in the reader's own clock:
 * a hand-over at 01:00 Cairo time is that day's paper, not the previous UTC day's.
 */
export const receiptDate = (iso: string): string => {
  const at = new Date(iso);
  return [at.getDate(), at.getMonth() + 1, at.getFullYear()]
    .map((part) => arabicDigits.format(part))
    .join(' / ');
};

/**
 * «Issue date: 5/10/2026» — the footer's date is the day the paper is PRINTED, written the way the
 * form's footer writes it (day/month/year, Latin digits, no padding).
 */
export const footerDate = (at: Date): string =>
  `${String(at.getDate())}/${String(at.getMonth() + 1)}/${String(at.getFullYear())}`;

/** The footer's number: the paper's own, or the form's bare prefix for a receipt never numbered. */
export const receiptNumberLabel = (formNumber: number | null): string =>
  formNumber === null ? IT_CUSTODY_RECEIPT_FORM.prefix : formatCustodyReceiptNumber(formNumber);

/** The declaration, as the form words it. The employee signs THIS, so it is never paraphrased. */
export const RECEIPT_DECLARATION =
  'استلمت الأصناف الموضحة بعاليه بحالة جديدة وسليمة تمامًا ومستعد لردها عند الطلب مني أو في حالة إخلاء طرفي من الشركة، كما أنني ملتزم بالحفاظ عليها بنفس الحالة وقت استلامي لها ومستعد لعرضها في أي وقت على مسئولي الشركة عند الطلب، وفي حالة تبديد هذه العهدة أو تعرضها للفقد أكون مسئولًا مسئولية مدنية وجنائية تجاه الشركة طبقًا لأحكام نصوص القانون المدني وقانون العقوبات.';

/** A blank the pen fills in, where the system could not name somebody. */
const BLANK = '..............................';

/** The printable receipt. Exported for its own test — composing it is where the rules live. */
export const buildCustodyReceiptHtml = (
  paper: ItCustodyReceiptDocumentDto,
  labels: Pick<ReceiptWindowLabels, 'print' | 'close'>,
  printedAt: Date = new Date(),
): string => {
  const name = paper.employeeName ?? BLANK;
  const jobTitle = paper.jobTitle?.ar ?? BLANK;
  const number = receiptNumberLabel(paper.formNumber);
  // THE SERIAL IS GENERATED: «م» numbers the printed lines 1, 2, 3 so a reader can point at one.
  const rows = paper.lines
    .map(
      (line, index) => `<tr>
        <td class="ser">${arabicDigits.format(index + 1)}</td>
        <td class="item"><div>${esc(line.name)}</div><div class="code">${esc(line.assetCode)}</div></td>
        <td class="ltr">${esc(line.serialNumber ?? '')}</td>
        <td>${esc(line.conditionOnIssue ?? '')}</td>
        <td>${esc(line.notes ?? '')}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>إيصال استلام ${esc(number)} — ${esc(name)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 16mm 18mm 14mm; }
  html, body { margin: 0; }
  body { font-family: 'Simplified Arabic', 'Traditional Arabic', Arial, Tahoma, sans-serif; color: ${INK}; font-size: 15px; }
  .sheet { min-height: 262mm; display: flex; flex-direction: column; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; }
  .org { line-height: 1.6; font-size: 15px; }
  .org .date { text-decoration: underline; }
  .head img { height: 58px; }
  h1 { text-align: center; font-size: 24px; font-weight: 800; text-decoration: underline; margin: 26px 0 22px; letter-spacing: 1px; }
  .intro { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .intro b { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid ${INK}; padding: 10px 8px; text-align: center; vertical-align: middle; }
  th { font-weight: 400; }
  td { height: 15mm; }
  td.ser { width: 28px; }
  td.item .code { font-family: Arial, sans-serif; font-size: 10px; color: #555; margin-top: 2px; direction: ltr; }
  td.ltr { direction: ltr; font-family: Arial, sans-serif; }
  .declaration { text-align: justify; line-height: 1.9; margin: 26px 0 8px; }
  .oath { text-align: center; margin: 6px 0 0; }
  /* On the LEFT of the page: in a right-to-left page the free margin goes on the start side. */
  .signs { width: max-content; margin-top: 64px; margin-inline-start: auto; margin-inline-end: 4mm; line-height: 2.1; }
  .signs .gap { display: inline-block; width: 52mm; }
  .foot { margin-top: auto; display: flex; justify-content: space-between; direction: ltr; font-family: Arial, sans-serif; font-size: 11px; padding-top: 10px; }
  .bar { display: none; }
  /* The tab: the paper as an A4 sheet on a grey desk, a toolbar above it. Never printed. */
  @media screen {
    html { background: #d9dbe3; }
    body { padding: 68px 16px 32px; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 18mm 14mm; background: #fff; box-shadow: 0 4px 22px rgba(20, 24, 60, 0.22); }
    .bar { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; background: #2e2e74; color: #fff; font-family: Tahoma, Arial, sans-serif; font-size: 14px; z-index: 1; }
    .bar .number { direction: ltr; font-family: Arial, sans-serif; font-weight: 700; letter-spacing: 0.3px; }
    .bar .actions { display: flex; gap: 8px; }
    .bar button { font: inherit; padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.55); background: transparent; color: #fff; cursor: pointer; }
    .bar button.primary { background: #fff; color: #2e2e74; border-color: #fff; font-weight: 700; }
  }
  @media screen and (max-width: 860px) {
    .sheet { width: 100%; min-height: 0; padding: 16px; }
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
<div class="sheet">
  <div class="head">
    <div class="org">
      <div>شركة إيجي كاش للحلول النقدية</div>
      <div>إدارة تكنولوجيا المعلومات</div>
      <div class="date">التاريخ : ${receiptDate(paper.issuedAt)}</div>
    </div>
    <img src="${EGYCASH_LOGO}" alt="EGYCASH" />
  </div>
  <h1>إيصال استلام</h1>
  <div class="intro">
    <span>استلمت أنا : <b>${esc(name)}</b></span>
    <span>الأصناف الموضحة بالجدول الآتي :</span>
  </div>
  <table>
    <thead><tr><th>م</th><th>اسم الصنف</th><th>SN</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="declaration">${RECEIPT_DECLARATION}</p>
  <p class="oath">وهذا إقرار مني بذلك ,,,</p>
  <div class="signs">
    <div>المستلم</div>
    <div>التوقيع (<span class="gap"></span>)</div>
    <div>الاسم : ${esc(name)}</div>
    <div>الوظيفة : ${esc(jobTitle)}</div>
  </div>
  <div class="foot">
    <span>${esc(number)}</span>
    <span>Issue / Rev. no.: ${esc(IT_CUSTODY_RECEIPT_FORM.revision)}</span>
    <span>Issue date: ${footerDate(printedAt)}</span>
  </div>
</div>
</body></html>`;
};

/** Write the composed receipt into a tab `openPrintWindow` opened; it prints itself. */
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
