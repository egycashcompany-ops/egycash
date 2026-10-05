// The custody receipt's controls (FR-18) — «وإمكانية طباعة الإيصال بردو بعد التسليم» and «رفع صورة
// الإيصال مره أخري بعد توقيع الموظف».
//
// One component for every place a custody interval is shown — the asset's current custody, the
// custody register and an employee's history — so the three never disagree about what a receipt
// offers: print it again, file the signed copy (or look at it, replace it, withdraw it), and, for
// custody handed over before receipts existed, issue one.
//
// The signed copy's bytes are guarded, so they are fetched with the session and shown as an object
// URL — a photo inline, a scanned PDF in a frame.
import { useEffect, useState } from 'react';
import { type ItAssetAssignmentDto, type ItCustodyReceiptDocumentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon, PrinterIcon, UploadIcon } from '../../../shared/ui/icons';
import * as api from '../api/it-api';
import {
  useDeleteReceiptSignedCopy,
  useIssueAssignmentReceipt,
  useItCustodyReceipt,
  useUploadReceiptSignedCopy,
} from '../api/it-queries';
import { printCustodyReceipt } from '../lib/custody-receipt-print';

/** What the signed copy may be: a phone photo of the paper, or the office scanner's PDF. */
export const RECEIPT_COPY_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const iconButton =
  'inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100';

/**
 * Print a receipt — the tab first, while the click still counts, then the paper. Answers the paper
 * that was printed (the hand-over records its number), or null when nothing was: the browser
 * blocked the tab, or the server refused the receipt — each said, rather than a button that seems
 * to do nothing.
 */
export const useReceiptPrinter = (): {
  print: (
    load: () => Promise<ItCustodyReceiptDocumentDto>,
  ) => Promise<ItCustodyReceiptDocumentDto | null>;
  isPrinting: boolean;
} => {
  const t = useT();
  const [isPrinting, setPrinting] = useState(false);
  const print = async (
    load: () => Promise<ItCustodyReceiptDocumentDto>,
  ): Promise<ItCustodyReceiptDocumentDto | null> => {
    setPrinting(true);
    try {
      const paper = await printCustodyReceipt(load, {
        waiting: t('it.custody.receipt.preparing'),
        print: t('it.custody.receipt.print'),
        close: t('common.close'),
      });
      if (paper === null) toast.error(t('it.custody.receipt.popupBlocked'));
      return paper;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
      return null;
    } finally {
      setPrinting(false);
    }
  };
  return { print, isPrinting };
};

const useSignedCopyUrl = (
  receiptId: string,
  fileId: string | null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; failed: boolean }>({
    url: null,
    loading: false,
    failed: false,
  });
  useEffect(() => {
    if (fileId === null || receiptId === '') {
      setState({ url: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: false });
    void api
      .fetchReceiptSignedCopy(receiptId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [receiptId, fileId]);
  return state;
};

/** A file input dressed as a button: picking a file files it as the receipt's signed copy. */
export const SignedCopyUpload = ({
  receiptId,
  label,
  className,
  children,
}: {
  receiptId: string;
  label: string;
  className?: string;
  children: JSX.Element | string | (JSX.Element | string)[];
}): JSX.Element => {
  const t = useT();
  const upload = useUploadReceiptSignedCopy();
  const [inputKey, setInputKey] = useState(0);
  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      await upload.mutateAsync({ id: receiptId, file });
      toast.success(t('it.custody.receipt.uploaded'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setInputKey((k) => k + 1);
    }
  };
  return (
    <label data-receipt-upload={receiptId} className={className ?? iconButton} title={label}>
      {children}
      <input
        key={inputKey}
        type="file"
        accept={RECEIPT_COPY_ACCEPT}
        className="hidden"
        disabled={upload.isPending}
        aria-label={label}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </label>
  );
};

/** The signed copy, large — with «استبدال» and «حذف» for a reader who holds the custody grant. */
export const SignedCopyDialog = ({
  open,
  onClose,
  receiptId,
}: {
  open: boolean;
  onClose: () => void;
  receiptId: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const mayEdit = can('itAsset.assign');
  const receipt = useItCustodyReceipt(open ? receiptId : null);
  const copy = receipt.data?.signedCopy ?? null;
  const { url, loading, failed } = useSignedCopyUrl(
    receiptId,
    open ? (copy?.fileId ?? null) : null,
  );
  const remove = useDeleteReceiptSignedCopy();
  const [confirming, setConfirming] = useState(false);

  const confirmDelete = async (): Promise<void> => {
    try {
      await remove.mutateAsync(receiptId);
      toast.success(t('it.custody.receipt.deleted'));
      setConfirming(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t('it.custody.receipt.signedTitle')}
        description={receipt.data?.employeeName ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {url !== null && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('it.custody.receipt.openNewTab')}
              </a>
            )}
            {mayEdit && (
              <SignedCopyUpload
                receiptId={receiptId}
                label={t('it.custody.receipt.replaceSigned')}
                className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t('it.custody.receipt.replaceSigned')}
              </SignedCopyUpload>
            )}
            {mayEdit && copy !== null && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('it.custody.receipt.deleteSigned')}
              </Button>
            )}
          </>
        }
      >
        {(receipt.isPending || loading) && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}
        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('it.custody.receipt.loadFailed')}
          </p>
        )}
        {url !== null &&
          (copy?.mime === 'application/pdf' ? (
            <iframe
              src={url}
              title={t('it.custody.receipt.signedTitle')}
              className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <img
              src={url}
              alt={t('it.custody.receipt.signedTitle')}
              className="mx-auto max-h-[70vh] rounded-lg"
            />
          ))}
      </Dialog>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('it.custody.receipt.deleteSigned')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('it.custody.receipt.deleteSignedBody')}
        </p>
      </Dialog>
    </>
  );
};

/**
 * Everything a custody interval's receipt offers, on one line: print it again, its signed copy
 * (filed → look at it; not yet → upload it, or «بانتظار التوقيع» for a reader who cannot), and,
 * for an interval still open with no receipt at all, issue one.
 */
export const CustodyReceiptActions = ({
  assignment,
}: {
  assignment: Pick<ItAssetAssignmentDto, 'id' | 'receiptId' | 'receiptSigned' | 'returnedAt'>;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const mayAssign = can('itAsset.assign');
  const printer = useReceiptPrinter();
  const issue = useIssueAssignmentReceipt();
  const [viewing, setViewing] = useState(false);
  const receiptId = assignment.receiptId;

  if (receiptId === null) {
    // A returned asset needs no paper; an open one handed over before receipts gets one.
    if (assignment.returnedAt !== null || !mayAssign) {
      return <span className="text-xs text-slate-400">—</span>;
    }
    return (
      <button
        type="button"
        className={iconButton}
        title={t('it.custody.receipt.issueHint')}
        disabled={printer.isPrinting || issue.isPending}
        onClick={() => void printer.print(() => issue.mutateAsync(assignment.id))}
      >
        <PrinterIcon className="h-4 w-4" />
        {t('it.custody.receipt.issue')}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        data-receipt-print={receiptId}
        className={iconButton}
        title={t('it.custody.receipt.print')}
        aria-label={t('it.custody.receipt.print')}
        disabled={printer.isPrinting}
        onClick={() => void printer.print(() => api.printCustodyReceipt(receiptId))}
      >
        <PrinterIcon className="h-4 w-4" />
      </button>
      {assignment.receiptSigned === true ? (
        <button
          type="button"
          data-receipt-signed={receiptId}
          className={iconButton}
          title={t('it.custody.receipt.viewSigned')}
          onClick={() => setViewing(true)}
        >
          <EyeIcon className="h-4 w-4" />
          <Badge tone="success" size="sm">
            {t('it.custody.receipt.signed')}
          </Badge>
        </button>
      ) : mayAssign ? (
        <SignedCopyUpload receiptId={receiptId} label={t('it.custody.receipt.uploadSigned')}>
          <UploadIcon className="h-4 w-4" />
          <Badge tone="warning" size="sm">
            {t('it.custody.receipt.awaitingSignature')}
          </Badge>
        </SignedCopyUpload>
      ) : (
        <Badge tone="warning" size="sm">
          {t('it.custody.receipt.awaitingSignature')}
        </Badge>
      )}
      <SignedCopyDialog open={viewing} onClose={() => setViewing(false)} receiptId={receiptId} />
    </span>
  );
};
