// مذكرة صرف مستهلكات — the paper an employee signs for the consumables handed to them (FR-20).
//
// «وأقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك وأتبدل لمين واطبعله مذكره»: every issue to an
// employee prints one memo, and the owner approved it designed on the device acknowledgment's
// letterhead, with a numbered series of its own. So the letterhead, the page, the toolbar, the
// three-part name under a signature and the numbered footer are the device paper's own
// (`custody-receipt-print.ts`, which exports them for exactly this), and only what the paper says
// is its own:
//   · «مذكرة صرف مستهلكات» under the letterhead;
//   · «أقر أنا / … بوظيفة … كود … بأنني قد استلمت من قطاع تكنولوجيا المعلومات الأصناف الموضحة
//     أدناه:» — the employee filled in red, as the device paper fills them;
//   · a table of the items: م · الصنف · النوع · الكمية · مركّب على · السبب («جديد» / «بدل تالف»),
//     «مركّب على» being the register's asset an item went into («أقدر أذكر الجهاز اللى أتركب عليه
//     من الأصول»);
//   · «وأتعهد باستخدامها في أعمال الشركة والمحافظة عليها.»;
//   · TWO signature blocks — «المستلم» (name, signature, date) and «مسؤول تكنولوجيا المعلومات»
//     (name, signature): a store hands the items over, and the one who hands them signs too;
//   · the footer «EGYCASH | IT Dept. | EGYCASH-IT-CON-0001».
//
// NO NATIONAL ID on this paper: a mouse handed over is not a device's custody, and the approved
// memo has no line for one. The number is the memo's own series (`formatConsumableMemoNumber`),
// reserved inside the issue's own transaction, so no paper names an issue that did not happen.
//
// The paper is Arabic and filled in the form's digits — the serial, the quantity, the employee's
// code and the date — while the store's codes and the asset's are printed as their labels print
// them, in Latin letters, kept whole.
//
// NO SCRIPT INSIDE THE PAGE — the tab inherits the app's Content-Security-Policy; printing and the
// toolbar are attached by `shared/lib/print-window.ts`, every printed document's one door.
import {
  formatConsumableMemoNumber,
  type ItConsumableIssueReason,
  type ItConsumableMemoDocumentDto,
  type ItConsumableMemoLineDto,
} from '@ecms/contracts';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import {
  RECEIPT_COLORS,
  RECEIPT_LETTERHEAD,
  esc,
  fill,
  formDigits,
  paperDocument,
  receiptDate,
  receiptFooter,
  signatureName,
  type ReceiptWindowLabels,
} from './custody-receipt-print';

/** The paper's name, as the approved design writes it. */
export const CONSUMABLE_MEMO_TITLE = 'مذكرة صرف مستهلكات';

/** The items table's heading row, in the paper's order. */
export const CONSUMABLE_MEMO_COLUMNS = [
  'م',
  'الصنف',
  'النوع',
  'الكمية',
  'مركّب على',
  'السبب',
] as const;

/** Why an item was issued, in the paper's words: a new need, or in place of a damaged one. */
export const CONSUMABLE_MEMO_REASONS: Readonly<Record<ItConsumableIssueReason, string>> = {
  new: 'جديد',
  replacement: 'بدل تالف',
};

/** The undertaking the employee signs — the approved wording, never paraphrased. */
export const CONSUMABLE_MEMO_UNDERTAKING = 'وأتعهد باستخدامها في أعمال الشركة والمحافظة عليها.';

/** One row of the items table, as the paper prints each cell. */
export interface ConsumableMemoRow {
  /** «١», «٢» … in the form's digits. */
  serial: string;
  /** The item as the store calls it. */
  item: string;
  /** The store's code under it — «CON-00001». */
  code: string;
  /** Its type as it was named when the memo was written; empty when there is none. */
  type: string;
  /** «٢ قطعة» — the quantity in the form's digits, and the item's unit. */
  qty: string;
  /** «AST-00012 — لاب توب Lenovo»; empty when it was installed on nothing. */
  installedOn: string;
  reason: string;
}

/** «AST-00012 — لاب توب Lenovo»: the asset by its label's code, then its name. */
const assetLabel = (line: ItConsumableMemoLineDto): string =>
  line.assetId === null
    ? ''
    : [line.assetCode, line.assetName]
        .map((part) => part?.trim() ?? '')
        .filter((part) => part !== '')
        .join(' — ');

/** The memo's lines as the table prints them, in the order they were issued. */
export const consumableMemoRows = (
  lines: readonly ItConsumableMemoLineDto[],
): ConsumableMemoRow[] =>
  lines.map((line, index) => ({
    serial: formDigits(String(index + 1)),
    item: line.name.trim(),
    code: line.code.trim(),
    type: line.typeName?.ar.trim() ?? '',
    qty: `${formDigits(String(line.qty))} ${line.unit.trim()}`.trim(),
    installedOn: assetLabel(line),
    reason: CONSUMABLE_MEMO_REASONS[line.reason],
  }));

/** A cell the memo has nothing for — a dash, so an empty box never reads as left out. */
const cell = (value: string): string => (value === '' ? '—' : `<bdi>${esc(value)}</bdi>`);

const itemsTable = (lines: readonly ItConsumableMemoLineDto[]): string =>
  `<table class="memo-items">
    <colgroup><col class="n" /><col class="item" /><col class="type" /><col class="qty" /><col class="asset" /><col class="reason" /></colgroup>
    <thead><tr>${CONSUMABLE_MEMO_COLUMNS.map((heading) => `<th>${heading}</th>`).join('')}</tr></thead>
    <tbody>${consumableMemoRows(lines)
      .map(
        (row) =>
          `<tr><td class="n">${row.serial}</td><td>${cell(row.item)}${row.code === '' ? '' : `<span class="code" dir="ltr">${esc(row.code)}</span>`}</td><td>${cell(row.type)}</td><td class="qty">${cell(row.qty)}</td><td>${cell(row.installedOn)}</td><td>${esc(row.reason)}</td></tr>`,
      )
      .join('')}</tbody>
  </table>`;

/**
 * The two signature blocks, side by side: the employee who received the items on the right — the
 * start of an Arabic line, where the form's own block of the receiver stands — and the IT officer
 * who handed them over on the left. Each name is its first three parts, as on the device paper.
 */
const signatures = (paper: ItConsumableMemoDocumentDto): string =>
  `<div class="memo-signs">
    <div class="sign" data-sign="receiver">
      <div class="by">المستلم</div>
      <div>الاسم: ${esc(signatureName(paper.employeeName))}</div>
      <div>التوقيع:</div>
      <div>التاريخ: ${receiptDate(paper.issuedAt)}</div>
    </div>
    <div class="sign" data-sign="it">
      <div class="by">مسؤول تكنولوجيا المعلومات</div>
      <div>الاسم: ${esc(signatureName(paper.issuedByName))}</div>
      <div>التوقيع:</div>
    </div>
  </div>`;

/** The memo's own parts, after the form's shared rules. */
const MEMO_STYLE = `  .memo-items { width: calc(100% - 24mm); margin: 0 12mm 1mm; border-collapse: collapse; table-layout: fixed; font-size: 12.5pt; line-height: 1.3; }
  .memo-items col.n { width: 7%; }
  .memo-items col.item { width: 29%; }
  .memo-items col.type { width: 15%; }
  .memo-items col.qty { width: 12%; }
  .memo-items col.asset { width: 23%; }
  .memo-items col.reason { width: 14%; }
  .memo-items thead { display: table-header-group; }
  .memo-items tr { break-inside: avoid; }
  .memo-items th, .memo-items td { border: 0.5pt solid #000; padding: 1mm 1.8mm; text-align: start; vertical-align: top; overflow-wrap: anywhere; }
  .memo-items th { background: ${RECEIPT_COLORS.shade}; font-weight: 700; text-align: center; }
  .memo-items td.n, .memo-items td.qty { text-align: center; white-space: nowrap; }
  .memo-items .code { display: block; font-family: Arial, sans-serif; font-size: 9pt; color: #444; }
  .memo-notes { margin: 2mm 12mm 0; font-size: 13pt; }
  .memo-signs { display: flex; gap: 12mm; margin: 7mm 12mm 0; line-height: 1.6; }
  .memo-signs .sign { flex: 1; min-width: 0; }
  .memo-signs .sign > div { white-space: nowrap; }
  .memo-signs .by { font-weight: 700; margin-bottom: 5mm; }
  @media screen and (max-width: 860px) {
    .memo-items { width: 100%; margin-left: 0; margin-right: 0; }
    .memo-notes, .memo-signs { margin-left: 0; margin-right: 0; }
  }
`;

/** The printable memo. Exported for its own test — composing it is where the rules live. */
export const buildConsumableMemoHtml = (
  paper: ItConsumableMemoDocumentDto,
  labels: Pick<ReceiptWindowLabels, 'print' | 'close'>,
): string => {
  const number = formatConsumableMemoNumber(paper.memoNumber);
  const notes = paper.notes?.trim() ?? '';
  const sheet = `<section class="page">
  ${RECEIPT_LETTERHEAD}
  <h1>${CONSUMABLE_MEMO_TITLE}</h1>
  <p class="statement">أقر أنا / ${fill(paper.employeeName, 36)} بوظيفة ${fill(paper.jobTitle?.ar, 32)} كود ${fill(paper.employeeCode === null ? null : formDigits(paper.employeeCode), 12, true)} بأنني قد استلمت من قطاع تكنولوجيا المعلومات الأصناف الموضحة أدناه:</p>
  ${itemsTable(paper.lines)}
  ${notes === '' ? '' : `<p class="memo-notes">ملاحظات: ${esc(notes)}</p>`}
  <p class="undertaking">${CONSUMABLE_MEMO_UNDERTAKING}</p>
  ${signatures(paper)}
  ${receiptFooter(number, '')}
</section>`;
  return paperDocument({
    title: `${CONSUMABLE_MEMO_TITLE} ${number} — ${paper.employeeName ?? ''}`,
    number,
    labels,
    sheets: sheet,
    style: MEMO_STYLE,
  });
};

/**
 * The whole print, start to finish: open, fetch, write. Answers the memo that was printed, or null
 * when the browser refused the tab — and then `load` is never called, so an issue that prints its
 * memo as it records it records nothing the reader could not print. A load that fails closes the
 * tab and rethrows, so a refused issue never leaves an empty tab behind.
 */
export const printConsumableMemo = async (
  load: () => Promise<ItConsumableMemoDocumentDto>,
  labels: ReceiptWindowLabels,
): Promise<ItConsumableMemoDocumentDto | null> => {
  // The tab first, while the click still counts as the user's; the memo is fetched after.
  const win = openPrintWindow(labels.waiting);
  if (win === null) return null;
  try {
    const paper = await load();
    writePrintWindow(win, buildConsumableMemoHtml(paper, labels));
    return paper;
  } catch (error) {
    win.close();
    throw error;
  }
};
