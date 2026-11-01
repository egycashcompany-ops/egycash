// A consumables memo's controls (FR-20) — the device receipt's and the line acknowledgment's, for
// «مذكرة صرف مستهلكات»: print it again (it keeps its number), and file, look at, replace or
// withdraw the employee's signed copy. The controls themselves are `CustodyReceipt.tsx`'s, so the
// department's three papers offer exactly the same; what is here is where a memo is kept
// (`/it/consumable-memos`), how it prints, and its number beside the controls — the memo's own
// series, which the register and the paper name it by.
//
// There is no «إصدار» for a memo: every issue records its memo in the same transaction, so a
// movement with no memo was never an issue to a person (a receipt, a scrap, a return).
import { formatConsumableMemoNumber, type ItConsumableMemoDocumentDto } from '@ecms/contracts';
import * as api from '../api/it-api';
import {
  useDeleteConsumableMemoSignedCopy,
  useItConsumableMemo,
  useUploadConsumableMemoSignedCopy,
} from '../api/it-queries';
import { printConsumableMemo } from '../lib/consumable-memo-print';
import { ReceiptPaperActions, usePaperPrinter, type ReceiptStore } from './CustodyReceipt';

/** The memos, for the shared controls. */
export const CONSUMABLE_MEMOS: ReceiptStore = {
  useReceipt: useItConsumableMemo,
  useUploadSignedCopy: useUploadConsumableMemoSignedCopy,
  useDeleteSignedCopy: useDeleteConsumableMemoSignedCopy,
  fetchSignedCopy: api.fetchConsumableMemoSignedCopy,
};

/** The memo's printer — the issue prints with it as it records, and the register prints again. */
export const useConsumableMemoPrinter = (): {
  print: (
    load: () => Promise<ItConsumableMemoDocumentDto>,
  ) => Promise<ItConsumableMemoDocumentDto | null>;
  isPrinting: boolean;
} => usePaperPrinter(printConsumableMemo);

/** What a movement's memo offers — or a dash for a movement that has none. */
export const ConsumableMemoActions = ({
  memoId,
  memoNumber,
  memoSigned,
}: {
  memoId: string | null;
  memoNumber: number | null;
  memoSigned: boolean | null;
}): JSX.Element => {
  const printer = useConsumableMemoPrinter();
  if (memoId === null) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-memo={memoId}>
      {memoNumber !== null && (
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
          {formatConsumableMemoNumber(memoNumber)}
        </span>
      )}
      <ReceiptPaperActions
        receiptId={memoId}
        signed={memoSigned}
        store={CONSUMABLE_MEMOS}
        isPrinting={printer.isPrinting}
        onPrint={() => void printer.print(() => api.printConsumableMemo(memoId))}
      />
    </span>
  );
};
