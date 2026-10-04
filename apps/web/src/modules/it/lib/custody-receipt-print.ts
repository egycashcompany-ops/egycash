// إيصال استلام — the company's custody receipt, form EGYCASH-IT-F-14-02, printed from the system.
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
import { IT_CUSTODY_RECEIPT_FORM, type ItCustodyReceiptDocumentDto } from '@ecms/contracts';
import { EGYCASH_LOGO } from '../../gold/lib/egycash-logo';

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

/** The declaration, as the form words it. The employee signs THIS, so it is never paraphrased. */
export const RECEIPT_DECLARATION =
  'استلمت الأصناف الموضحة بعاليه بحالة جديدة وسليمة تمامًا ومستعد لردها عند الطلب مني أو في حالة إخلاء طرفي من الشركة، كما أنني ملتزم بالحفاظ عليها بنفس الحالة وقت استلامي لها ومستعد لعرضها في أي وقت على مسئولي الشركة عند الطلب، وفي حالة تبديد هذه العهدة أو تعرضها للفقد أكون مسئولًا مسئولية مدنية وجنائية تجاه الشركة طبقًا لأحكام نصوص القانون المدني وقانون العقوبات.';

/** A blank the pen fills in, where the system could not name somebody. */
const BLANK = '..............................';

/**
 * Opens the print dialog once the logo has decoded — the `fleet-report-print.ts` script, for its
 * reasons: written into an open window, `load` cannot be relied on, and a company document on
 * paper without its letterhead is not the document. The timer catches every other case.
 */
const PRINT_ON_LOAD = `<script>
(function () {
  var printed = false;
  var go = function () {
    if (printed) return;
    printed = true;
    window.focus();
    window.print();
  };
  var logo = document.images[0];
  if (logo && !logo.complete) {
    logo.addEventListener('load', go);
    logo.addEventListener('error', go);
  } else {
    window.setTimeout(go, 80);
  }
  window.setTimeout(go, 1500);
})();
</${'script'}>`;

/** The printable receipt. Exported for its own test — composing it is where the rules live. */
export const buildCustodyReceiptHtml = (paper: ItCustodyReceiptDocumentDto): string => {
  const name = paper.employeeName ?? BLANK;
  const jobTitle = paper.jobTitle?.ar ?? BLANK;
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
<html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>إيصال استلام — ${esc(name)}</title>
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
  .signs { margin-top: 64px; margin-inline-start: 34mm; line-height: 2.1; }
  .signs .gap { display: inline-block; width: 52mm; }
  .foot { margin-top: auto; display: flex; justify-content: space-between; direction: ltr; font-family: Arial, sans-serif; font-size: 11px; padding-top: 10px; }
</style></head>
<body><div class="sheet">
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
    <span>${esc(IT_CUSTODY_RECEIPT_FORM.code)}</span>
    <span>Issue / Rev. no.: ${esc(IT_CUSTODY_RECEIPT_FORM.revision)}</span>
    <span>Issue date: ${esc(IT_CUSTODY_RECEIPT_FORM.issueDate)}</span>
  </div>
</div>
${PRINT_ON_LOAD}
</body></html>`;
};

/**
 * Open the print window NOW, while the click still counts as the user's — the receipt is fetched
 * after, and a window opened once that round trip returns is one a popup blocker refuses. Null
 * when the browser blocked it anyway; the caller says so rather than doing nothing.
 */
export const openReceiptWindow = (waitingText: string): Window | null => {
  const win = window.open('', '_blank');
  if (win === null) return null;
  win.document.open();
  win.document.write(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body style="font-family: Tahoma, sans-serif; padding: 24px;">${esc(waitingText)}</body></html>`,
  );
  win.document.close();
  return win;
};

/** Write the composed receipt into the window `openReceiptWindow` opened; it prints itself. */
export const writeCustodyReceipt = (win: Window, paper: ItCustodyReceiptDocumentDto): void => {
  win.document.open();
  win.document.write(buildCustodyReceiptHtml(paper));
  win.document.close();
  win.focus();
};

/**
 * The whole print, start to finish: open, fetch, write — or close the window and rethrow when the
 * fetch fails, so a refused receipt never leaves an empty tab behind.
 */
export const printCustodyReceipt = async (
  load: () => Promise<ItCustodyReceiptDocumentDto>,
  waitingText: string,
): Promise<'printed' | 'blocked'> => {
  const win = openReceiptWindow(waitingText);
  if (win === null) return 'blocked';
  try {
    writeCustodyReceipt(win, await load());
    return 'printed';
  } catch (error) {
    win.close();
    throw error;
  }
};
