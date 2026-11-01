// إقرار استلام — a mobile line handed to an employee, on the department's own form (FR-19).
//
// «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز أعملهم صفحة لإدارتهم وتسليمهم»: a line is handed
// over the way a device is, and the employee signs the same paper for it — the same letterhead, the
// same «إقرار استلام», the same undertaking, signature block and numbered footer, every one of them
// the device paper's own (`custody-receipt-print.ts`, which exports them for exactly this). What
// differs is what is received: «… بأنني قد استلمت خط محمول رقم [الرقم] وبياناته كالتالي:», then a
// small table of the line's facts — the network, the number, the SIM's serial (or «شريحة
// إلكترونية (eSIM)», which has no card to read one from), the plan and the account. A row the
// register has nothing for is left off, as the device paper leaves off an empty specification.
//
// ONE LINE, ONE PAGE: a hand-over is of one line, so the paper is one sheet and the footer's red
// block carries no page count. Its number is the F-14 series the device papers use — one
// department, one form, one counter (the API keeps the two kinds from sharing a number).
//
// The line's identifiers are printed as the network writes them — Latin digits, kept whole on one
// line: the number, the ICCID and the account are what the SIM card and the network's invoice say,
// and the paper is checked against them digit by digit. The employee's code and national ID stay
// in the form's own digits, exactly as on the device paper.
//
// NO SCRIPT INSIDE THE PAGE — the tab inherits the app's Content-Security-Policy; printing and the
// toolbar are attached by `shared/lib/print-window.ts`, every printed document's one door.
import {
  IT_MOBILE_NETWORK_NAMES,
  type ItMobileLineReceiptDocumentDto,
  type ItMobileLineReceiptLineDto,
} from '@ecms/contracts';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import {
  RECEIPT_COLORS,
  esc,
  fill,
  formDigits,
  receiptDocument,
  receiptSheet,
  type ReceiptWindowLabels,
} from './custody-receipt-print';

/** What an eSIM's serial row says: there is no card, so there is no ICCID to print. */
export const ESIM_SERIAL = 'شريحة إلكترونية (eSIM)';

/** One row of the line's table: the form's label, and what the register holds for it. */
export interface LineFactRow {
  label: string;
  value: string;
}

/**
 * The line's facts, in the order the paper lists them. The network and the number are always
 * there; the serial, the plan and the account only when the register has them — an eSIM's serial
 * row says it is an eSIM rather than leaving the reader to wonder whether somebody forgot.
 */
export const lineFacts = (line: ItMobileLineReceiptLineDto): LineFactRow[] => {
  const serial = line.simKind === 'esim' ? ESIM_SERIAL : (line.simSerial?.trim() ?? '');
  const rows: [string, string][] = [
    ['الشبكة', IT_MOBILE_NETWORK_NAMES[line.network].ar],
    ['رقم الخط', line.phoneNumber],
    ['مسلسل الشريحة', serial],
    ['الباقة', line.ratePlan?.trim() ?? ''],
    ['رقم الحساب', line.accountNumber?.trim() ?? ''],
  ];
  return rows.filter(([, value]) => value !== '').map(([label, value]) => ({ label, value }));
};

/** The table: the form's shaded label on the right, the register's fact in the form's red. */
const factTable = (rows: readonly LineFactRow[]): string =>
  `<table class="facts">
    <tbody>${rows
      .map((row) => `<tr><th>${esc(row.label)}</th><td>${fill(row.value, 18, true)}</td></tr>`)
      .join('')}</tbody>
  </table>`;

/** The table's own rules, after the form's shared ones. */
const LINE_STYLE = `  .facts { border-collapse: collapse; margin: 0 12mm 1mm; min-width: 55%; font-size: 14pt; line-height: 1.3; }
  .facts th, .facts td { border: 0.5pt solid #000; padding: 0.8mm 3mm; text-align: start; vertical-align: top; }
  .facts th { background: ${RECEIPT_COLORS.shade}; font-weight: 700; white-space: nowrap; width: 38mm; }
  @media screen and (max-width: 860px) {
    .facts { margin-left: 0; margin-right: 0; width: 100%; }
  }
`;

/** The printable line acknowledgment. Exported for its own test — composing it is where the rules live. */
export const buildMobileLineReceiptHtml = (
  paper: ItMobileLineReceiptDocumentDto,
  labels: Pick<ReceiptWindowLabels, 'print' | 'close'>,
): string => {
  const { line } = paper;
  const body = `<p class="statement">أقر أنا / ${fill(paper.employeeName, 36)} بوظيفة ${fill(paper.jobTitle?.ar, 32)} بشركة إيجي كاش للحلول النقدية، كود ${fill(paper.employeeCode === null ? null : formDigits(paper.employeeCode), 12, true)}، بطاقة رقم قومي ${fill(paper.nationalId === null ? null : formDigits(paper.nationalId), 26, true)} بأنني قد استلمت خط محمول رقم ${fill(line.phoneNumber, 14, true)} وبياناته كالتالي:</p>
  ${factTable(lineFacts(line))}`;
  return receiptDocument({
    paper,
    labels,
    sheets: receiptSheet({ paper, body, block: '' }),
    style: LINE_STYLE,
  });
};

/**
 * The whole print, start to finish: open, fetch, write. Answers the paper that was printed — the
 * hand-over records its number — or null when the browser refused the tab; a fetch that fails
 * closes the tab and rethrows, so a refused acknowledgment never leaves an empty tab behind.
 */
export const printMobileLineReceipt = async (
  load: () => Promise<ItMobileLineReceiptDocumentDto>,
  labels: ReceiptWindowLabels,
): Promise<ItMobileLineReceiptDocumentDto | null> => {
  // The tab first, while the click still counts as the user's; the paper is fetched after.
  const win = openPrintWindow(labels.waiting);
  if (win === null) return null;
  try {
    const paper = await load();
    writePrintWindow(win, buildMobileLineReceiptHtml(paper, labels));
    return paper;
  } catch (error) {
    win.close();
    throw error;
  }
};
