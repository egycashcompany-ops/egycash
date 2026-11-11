// «إلغاء استلام الخزينة» (Round 10). After the vault's ✓ nobody edits a محصنة — «الشاشه بتاعت استلام
// الخزينة لما تعمل صح ميقدر حد من القادة او العمليات او الخزنه يعدل عليها» — and the owner's answer
// to "what if the receipt was a mistake": «بس صلاحية خاصة تقدر تلغى استلام الخزينة». This is that
// special grant's act (`operationsVault.cancelReceipt`), opened from a green row's «إلغاء استلام
// الخزينة» on the secured screen and on the vault's receive screen (`ShipmentsBoard`).
//
// What happens is said before the click: the محصنة leaves the vault and is yellow again, as before
// the receipt — editable, and receivable anew — and the cancelled receipt stays in «السجل» with its
// reason (the server voids the custody, it never erases it). The reason is REQUIRED, within the
// server's own bounds (`receiptCancelReasonProblem`), and the red button stays off until it is
// there. The way back says «رجوع», never «إلغاء», which would read as the act itself (the Fleet
// custody's cancel dialog's rule).
//
// A refusal is said in the reader's words (`errorMessage`). One that says the row on screen is out
// of date — someone dispatched it (`OPERATIONS_SECURED_NOT_IN_VAULT`) or acted on it first
// (`STALE_DOCUMENT`) — closes the dialog over the board the refusal re-read; asking again from the
// same stale row could only be refused again. One press sends once.
import { useRef, useState } from 'react';
import {
  OPERATIONS_RECEIPT_CANCEL_REASON_MAX,
  OPERATIONS_RECEIPT_CANCEL_REASON_MIN,
  type Locale,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { Textarea } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { DesignField } from '../../fleet/components/FuelCardDialog';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { NOTE_BOX } from '../../fleet/components/LicenseExpensePaidGroup';
import { useCancelVaultReceipt } from '../api/operations-queries';
import { receiptCancelReasonProblem } from '../lib/secured-stage';
import { SHIPMENT_PATH } from './shipment-icons';

/** What the dialog is about: the row in the vault, and the line under the title that names it. */
export interface CancelReceiptTarget {
  row: OperationsShipmentDto;
  /** «الأهلي · المعادي ← الدقي · 2026-11-12» (`shipmentCaption`), as «السجل» names it. */
  caption: string;
}

/** The red save of the design: `DesignSave`'s shape, the danger colour (as the custody's cancel). */
const DANGER_SAVE = cn(
  'flex items-center gap-2 rounded-xl px-8 py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60',
  'bg-gradient-to-r from-red-600 to-rose-600 shadow-[0_6px_24px_rgba(225,29,72,0.45)] hover:from-red-500 hover:to-rose-500',
);

/** A refusal saying the row on screen is out of date — asking again from it cannot succeed. */
const isStaleRow = (error: unknown): boolean => error instanceof ApiError && error.status === 409;

/** `target` null = closed. Mounted once per board, as «السجل» is. */
export const CancelVaultReceiptDialog = ({
  target,
  onClose,
}: {
  target: CancelReceiptTarget | null;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const cancel = useCancelVaultReceipt();
  const [reason, setReason] = useState('');
  // The words are said only once someone has tried to send — not over an empty box just opened.
  const [tried, setTried] = useState(false);
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);

  // A new row opened starts from an empty reason: what was typed for one shipment is not another's.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const id = target?.row.id ?? null;
  if (openFor !== id) {
    setOpenFor(id);
    setReason('');
    setTried(false);
  }

  if (target === null) return null;
  const { row } = target;
  const problem = receiptCancelReasonProblem(reason);
  const busy = waiting || cancel.isPending;

  const send = (): void => {
    setTried(true);
    if (sending.current || problem !== null) return;
    sending.current = true;
    setWaiting(true);
    cancel
      .mutateAsync({ id: row.id, body: { reason: reason.trim(), version: row.version } })
      .then(
        () => {
          toast.success(t('operations.secured.cancelReceipt.done'));
          onClose();
        },
        (error: unknown) => {
          toast.error(errorMessage(error, locale));
          if (isStaleRow(error)) onClose();
        },
      )
      .finally(() => {
        sending.current = false;
        setWaiting(false);
      });
  };

  const length = reason.trim().length;
  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t('operations.secured.cancelReceipt.action')}
      subtitle={target.caption}
      icon={SHIPMENT_PATH.unlock}
      width="xl"
      wrapTitle
      panelProps={{ 'data-cancel-receipt': row.id }}
      footer={
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            className={DANGER_SAVE}
            data-cancel-receipt-save="true"
            aria-busy={busy}
            // Off until the reason is there: the act is not sent without its words.
            disabled={busy || problem !== null}
            onClick={send}
          >
            {busy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <BoardIcon d={SHIPMENT_PATH.unlock} className="h-4 w-4" />
            )}
            <span>{t('operations.secured.cancelReceipt.save')}</span>
          </button>
          <DesignCancel onClick={onClose} label={t('operations.secured.cancelReceipt.back')} />
        </div>
      }
    >
      {/* What the click does — before it is made. */}
      <div
        data-cancel-receipt-body="true"
        className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-[15px] font-semibold leading-7 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/[0.08] dark:text-rose-100"
      >
        <BoardIcon
          d={SHIPMENT_PATH.unlock}
          className="mt-1.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
        />
        <span>{t('operations.secured.cancelReceipt.body')}</span>
      </div>

      {/* The receipt being cancelled, by its number — what the treasury signed. */}
      {row.receiptNumber !== null && (
        <div
          data-cancel-receipt-number={row.receiptNumber}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
        >
          <span className="text-[15px] font-bold text-slate-700 dark:text-slate-200">
            {t('operations.secured.cancelReceipt.receiptNumber')}
          </span>
          <bdi dir="ltr" className={cn(NUM, 'text-lg font-black text-slate-900 dark:text-white')}>
            {row.receiptNumber}
          </bdi>
        </div>
      )}

      <div>
        <DesignField
          label={t('operations.secured.cancelReceipt.reason')}
          required
          missing={tried && problem === 'short'}
          error={
            tried && problem === 'short'
              ? t('operations.secured.cancelReceipt.reasonShort', {
                  min: formatNumber(OPERATIONS_RECEIPT_CANCEL_REASON_MIN, locale),
                })
              : undefined
          }
        >
          <Textarea
            rows={3}
            // The server's ceiling, so the box cannot hold a reason it would refuse as too long.
            maxLength={OPERATIONS_RECEIPT_CANCEL_REASON_MAX}
            value={reason}
            placeholder={t('operations.secured.cancelReceipt.reasonHint')}
            onChange={(e) => setReason(e.target.value)}
            className={NOTE_BOX}
            data-cancel-receipt-reason="true"
            aria-required="true"
          />
        </DesignField>
        {/* How much of the room is used, in the reader's digits. */}
        <p
          data-cancel-receipt-count={length}
          className={cn(
            'mt-1.5 text-end text-xs font-bold text-slate-500 dark:text-slate-400',
            NUM,
          )}
        >
          {formatNumber(length, locale)} /{' '}
          {formatNumber(OPERATIONS_RECEIPT_CANCEL_REASON_MAX, locale)}
        </p>
      </div>
    </DesignDialog>
  );
};
