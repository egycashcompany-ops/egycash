// A line acknowledgment's controls (FR-19) — the device receipt's, for the line papers: print it
// again, and file, look at, replace or withdraw the employee's signed copy. The controls themselves
// are `CustodyReceipt.tsx`'s, so the two kinds of paper offer exactly the same; what is here is
// where a line acknowledgment is kept (`/it/mobile-line-receipts`) and how it prints.
//
// A line held by a CAR has no paper — a car signs nothing — and there is no «إصدار إيصال» for a
// line: every employee hand-over records its acknowledgment, so a line with none was never handed
// to an employee.
import { type ItMobileLineReceiptDocumentDto } from '@ecms/contracts';
import * as api from '../api/it-api';
import {
  useDeleteMobileLineReceiptSignedCopy,
  useItMobileLineReceipt,
  useUploadMobileLineReceiptSignedCopy,
} from '../api/it-queries';
import { printMobileLineReceipt } from '../lib/mobile-line-receipt-print';
import { ReceiptPaperActions, usePaperPrinter, type ReceiptStore } from './CustodyReceipt';

/** The line acknowledgments, for the shared controls. */
export const LINE_RECEIPTS: ReceiptStore = {
  useReceipt: useItMobileLineReceipt,
  useUploadSignedCopy: useUploadMobileLineReceiptSignedCopy,
  useDeleteSignedCopy: useDeleteMobileLineReceiptSignedCopy,
  fetchSignedCopy: api.fetchMobileLineReceiptSignedCopy,
};

/** The line acknowledgment's printer — the hand-over prints with it before it records anything. */
export const useLineReceiptPrinter = (): {
  print: (
    load: () => Promise<ItMobileLineReceiptDocumentDto>,
  ) => Promise<ItMobileLineReceiptDocumentDto | null>;
  isPrinting: boolean;
} => usePaperPrinter(printMobileLineReceipt);

/** What a line's acknowledgment offers — or a dash for a line with none (a car, or returned). */
export const MobileLineReceiptActions = ({
  receiptId,
  receiptSigned,
}: {
  receiptId: string | null;
  receiptSigned: boolean | null;
}): JSX.Element => {
  const printer = useLineReceiptPrinter();
  if (receiptId === null) return <span className="text-xs text-slate-400">—</span>;
  return (
    <ReceiptPaperActions
      receiptId={receiptId}
      signed={receiptSigned}
      store={LINE_RECEIPTS}
      isPrinting={printer.isPrinting}
      onPrint={() => void printer.print(() => api.printMobileLineReceipt(receiptId))}
    />
  );
};
