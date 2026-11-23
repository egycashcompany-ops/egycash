// «الشحنات المسلَّمة» (Round 33 B) — its row's «الحالة», its ✓ and undo, and the ✓'s dialog. The
// owner: «الاجراءات هيكون فيه علامة صح لما ادوس عليها لازم يكون فيه رقم الايصال ويفضل الصورة تكون
// مرفوعه و يحدد البنك من او الى اللى هيتحسب عليه تكلفة نقل الشحنة»; on the photo, «اختيارية مع تنبيه».
//
// THE ROW. Awaiting its ✓ it is the day board's «تم التسليم» on a yellow row (the captain's van on
// the badge), with the time he delivered it; confirmed it is green, «مؤكَّدة», with the receipt's
// number and the bank billed under it — and «بدون صورة» while it has no receipt photo, until one is
// uploaded from the row's own «صورة الإيصال» cell (the day board's).
//
// THE ✓. A dialog in the board's design (`DesignDialog`): «رقم الإيصال» required (the contract's
// rule, `deliveryReceiptNumberProblem`, checked here and on the server), «صورة الإيصال» optional —
// the one there is shown; a new one is picked here and uploaded right after the confirmation, through
// the day board's own upload; without one the dialog says the row will keep «بدون صورة» — and
// «البنك الذي تُحتسب عليه تكلفة النقل», one of exactly two: «من» (the origin branch's bank) or «إلى»
// (the destination's), each named by its bank and its branch. The bank billed is the SERVER's, read
// from the side chosen; nothing here names one. Tab stays in the window, Escape closes it.
//
// THE UNDO. «إلغاء التأكيد», confirmed first: the receipt's number and the bank billed leave the
// row, which goes back to yellow awaiting its ✓. The photo stays — it is the shipment's.
import { useEffect, useRef, useState } from 'react';
import {
  isOperationsReceiptPhotoAddable,
  type Locale,
  type OperationsDeliveredShipmentDto,
  type OperationsDeliveryBilledSide,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { Badge } from '../../../shared/ui/Badge';
import { Input } from '../../../shared/ui/form';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, EyeIcon } from '../../../shared/ui/icons';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { DesignField, LOOK, MONO, boxTone } from '../../fleet/components/FuelCardDialog';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { actionTone, PRESSED } from '../../fleet/components/row-actions-look';
import {
  useConfirmShipmentDelivery,
  useUndoShipmentDelivery,
  useUploadShipmentReceiptImage,
} from '../api/operations-queries';
import {
  EMPTY_DELIVERY_DRAFT,
  RECEIPT_NUMBER_MAX,
  billedSideOptions,
  deliveredStateOf,
  deliveryDraftProblems,
  billedSideAfterKey,
  billedSideTabStop,
  deliveryRefusalOf,
  deliveryRequestBody,
  lacksReceiptPhoto,
  sameBankBothSides,
  type DeliveryDraft,
} from '../lib/delivered-board';
import { cairoStamp } from '../lib/shipment-log';
import { DeliveryStatusBadge } from './ShipmentBadges';
import {
  SHIPMENT_RECEIPT_IMAGE_ACCEPT,
  useShipmentReceiptImageUrl,
} from './ShipmentReceiptImageCell';
import { SHIPMENT_PATH } from './shipment-icons';
import { useFocusTrap } from './use-focus-trap';

/** The amber mark of a confirmed row with no photo — «اختيارية مع تنبيه». */
const NO_PHOTO =
  'inline-flex items-center gap-1 rounded-md border border-amber-400/70 bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-200';

/** «من» / «إلى» — the side's own word, in the reader's language. */
const sideKey = (side: 'origin' | 'destination'): string =>
  side === 'origin' ? 'operations.delivered.side.origin' : 'operations.delivered.side.destination';

/**
 * The row's «الحالة»: «تم التسليم» awaiting its ✓ (the day board's captain badge, and when he
 * delivered it), or «مؤكَّدة» with the receipt number, the bank billed and «بدون صورة» when it has
 * no photo.
 */
export const DeliveredStatusCell = ({
  row,
}: {
  row: OperationsDeliveredShipmentDto;
}): JSX.Element => {
  const t = useT();
  const confirmation = row.deliveryConfirmation;
  const at = cairoStamp(row.captainDeliveredAt).time;
  if (confirmation === null) {
    return (
      <div className="space-y-0.5" data-delivered-state="awaiting">
        <DeliveryStatusBadge delivery="captain" />
        <p className="whitespace-nowrap text-[11px] text-amber-800 dark:text-amber-200">
          {t('operations.delivered.awaiting')} ·{' '}
          <bdi dir="ltr" className={NUM}>
            {at}
          </bdi>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5" data-delivered-state="confirmed">
      <Badge tone="success" size="sm">
        <CheckIcon className="h-3.5 w-3.5" aria-hidden />
        {t('operations.delivered.confirmed')}
      </Badge>
      <p className="whitespace-nowrap text-[11px] text-emerald-800 dark:text-emerald-200">
        {t('operations.delivered.receiptNo')}{' '}
        <bdi dir="ltr" className={NUM} data-delivered-receipt={row.id}>
          {confirmation.receiptNumber}
        </bdi>
      </p>
      <p
        className="max-w-[10rem] truncate text-[11px] text-emerald-800 dark:text-emerald-200"
        title={confirmation.billedBankName}
        data-delivered-billed={confirmation.billedSide}
      >
        {t('operations.delivered.billedTo', {
          bank: confirmation.billedBankName === '' ? '…' : confirmation.billedBankName,
          side: t(sideKey(confirmation.billedSide)),
        })}
      </p>
      {lacksReceiptPhoto(row) && (
        <span className={NO_PHOTO} data-delivered-no-photo={row.id}>
          <BoardIcon d={SHIPMENT_PATH.alert} className="h-3 w-3" />
          {t('operations.delivered.noPhoto')}
        </span>
      )}
    </div>
  );
};

/**
 * The row's act at the ✓'s place: the ✓ on a row awaiting it, «إلغاء التأكيد» on a confirmed one —
 * both for the day board's ✓ grant (`operationsShipment.complete`), the server's own. Null for a
 * reader without it.
 */
export const DeliveredRowAction = ({
  row,
  onConfirm,
}: {
  row: OperationsDeliveredShipmentDto;
  onConfirm: (row: OperationsDeliveredShipmentDto) => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const undo = useUndoShipmentDelivery();
  if (!can('operationsShipment.complete')) return null;
  if (deliveredStateOf(row) === 'awaiting') {
    return (
      <button
        type="button"
        data-delivered-confirm={row.id}
        aria-haspopup="dialog"
        className={actionTone('status')}
        aria-label={t('operations.delivered.confirm')}
        title={t('operations.delivered.confirm')}
        onClick={() => onConfirm(row)}
      >
        <CheckIcon className="h-4 w-4" />
      </button>
    );
  }
  const takeBack = (): void => {
    // The receipt number and the bank billed leave the row: asked first, as the desk's undo of the
    // captain's ✓ is.
    if (!window.confirm(t('operations.delivered.undoConfirm'))) return;
    // A refusal is said ONCE, by the global notifier: the hook declares no `onError`, so a toast
    // here too printed the same sentence twice (Round 33 verifier). A conflict re-reads the row.
    undo.mutate(
      { id: row.id, body: { version: row.version } },
      { onSuccess: () => toast.success(t('operations.delivered.undone')) },
    );
  };
  // Round 33 critic — a plain button named for what it does, «إلغاء التأكيد», with NO
  // `aria-pressed`: a name that says the undo together with "pressed" is announced as if the undo
  // were what is switched on (the day board's own warning on its ✓). The pressed look stays.
  return (
    <button
      type="button"
      data-delivered-undo={row.id}
      className={cn(actionTone('status'), PRESSED)}
      aria-label={t('operations.delivered.undo')}
      title={t('operations.delivered.undo')}
      disabled={undo.isPending}
      onClick={takeBack}
    >
      <BoardIcon d={SHIPMENT_PATH.undo} className="h-4 w-4" />
    </button>
  );
};

/**
 * One of the two sides, a radio in the board's design: the word, the bank, the branch. Round 33
 * critic: ONE Tab stop for the group (`tabStop` — the side chosen, else the first that can be) and
 * the arrows move inside it (`billedSideAfterKey`, on the group), as the swap window's three ways.
 */
const SideChoice = ({
  checked,
  tabStop,
  disabled,
  word,
  bank,
  branch,
  onPick,
  side,
  buttonRef,
}: {
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  word: string;
  bank: string;
  branch: string;
  onPick: () => void;
  side: string;
  buttonRef: (node: HTMLButtonElement | null) => void;
}): JSX.Element => (
  <button
    ref={buttonRef}
    type="button"
    role="radio"
    aria-checked={checked}
    tabIndex={tabStop ? 0 : -1}
    disabled={disabled}
    data-delivered-side={side}
    onClick={onPick}
    className={cn(
      'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-start transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-50',
      checked
        ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:border-indigo-400 dark:bg-indigo-500/15'
        : 'border-slate-200 bg-slate-50 hover:border-indigo-400 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60',
    )}
  >
    <span className="flex items-center gap-1.5 text-[13px] font-black text-slate-700 dark:text-slate-200">
      <span
        aria-hidden
        className={cn(
          'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
          checked ? 'border-indigo-600 dark:border-indigo-300' : 'border-slate-400',
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 dark:bg-indigo-300" />}
      </span>
      {word}
    </span>
    <span
      className="w-full truncate text-[15px] font-bold text-slate-900 dark:text-white"
      title={bank}
    >
      {bank}
    </span>
    <span className="w-full truncate text-xs text-slate-600 dark:text-slate-300" title={branch}>
      {branch}
    </span>
  </button>
);

/** The photo there now, small — opened whole from the row's own cell. */
const CurrentPhoto = ({ row }: { row: OperationsDeliveredShipmentDto }): JSX.Element => {
  const t = useT();
  const { url, loading } = useShipmentReceiptImageUrl(row.id, row.receiptImage?.fileId ?? null);
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-500/40 dark:bg-emerald-500/10"
      data-delivered-photo="current"
    >
      {url !== null ? (
        <img
          src={url}
          alt={t('operations.shipment.receiptImage.title')}
          className="h-12 w-12 rounded-md object-cover"
        />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
          <EyeIcon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 text-sm">
        <p className="font-bold text-emerald-900 dark:text-emerald-100">
          {t('operations.delivered.photo.current')}
        </p>
        <p className="truncate text-xs text-emerald-800 dark:text-emerald-200">
          {loading ? t('common.loading') : (row.receiptImage?.fileName ?? '')}
        </p>
      </div>
    </div>
  );
};

/**
 * «تأكيد التسليم» — `row` null is closed. Mounted once per screen. A refusal that says the row moved
 * (not delivered any more, a colleague's ✓, a newer version) closes it over the screen the refusal
 * re-read; a box the server names is marked and the dialog stays.
 */
export const DeliveryConfirmDialog = ({
  row,
  onClose,
}: {
  row: OperationsDeliveredShipmentDto | null;
  onClose: () => void;
}): JSX.Element | null => {
  if (row === null) return null;
  return <DeliveryConfirmWindow key={row.id} row={row} onClose={onClose} />;
};

const DeliveryConfirmWindow = ({
  row,
  onClose,
}: {
  row: OperationsDeliveredShipmentDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const confirm = useConfirmShipmentDelivery();
  const upload = useUploadShipmentReceiptImage();
  const [draft, setDraft] = useState<DeliveryDraft>(EMPTY_DELIVERY_DRAFT);
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  // What the server said of a box, kept until that box is changed.
  const [refused, setRefused] = useState<{
    receiptNumber: 'required' | 'tooLong' | null;
    billedSide: boolean;
  }>({ receiptNumber: null, billedSide: false });
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const inside = useRef<HTMLDivElement>(null);
  const numberBox = useRef<HTMLInputElement>(null);
  const sideButtons = useRef<
    Partial<Record<OperationsDeliveryBilledSide, HTMLButtonElement | null>>
  >({});
  useFocusTrap(inside, () => numberBox.current);

  // A picked photo previewed before it is sent; its URL let go with it.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (file === null) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const problems = deliveryDraftProblems(draft);
  const numberProblem = refused.receiptNumber ?? (tried ? problems.receiptNumber : null);
  const sideMissing = refused.billedSide || (tried && problems.billedSide !== null);
  const options = billedSideOptions(row);
  const tabStop = billedSideTabStop(options, draft.billedSide);
  const oneBank = sameBankBothSides(row);
  const hasPhoto = row.receiptImage !== null;
  // A photo may be picked here where the row's own cell would take one (the day board's rule; a
  // محصنة out of the vault and delivered takes its first one — Round 33 B).
  const mayPickPhoto =
    !hasPhoto &&
    can('operationsShipment.edit') &&
    isOperationsReceiptPhotoAddable({ ...row, hasReceiptImage: false });
  const busy = waiting || confirm.isPending || upload.isPending;
  const box = boxTone(LOOK.add);

  const send = (): void => {
    setTried(true);
    if (sending.current || problems.receiptNumber !== null || problems.billedSide !== null) return;
    sending.current = true;
    setWaiting(true);
    confirm
      .mutateAsync({ id: row.id, body: deliveryRequestBody(draft, row.version) })
      .then(
        async () => {
          // The photo goes up AFTER the confirmation, through the day board's own upload: the
          // confirmation is the record, the photo is the shipment's. A photo that fails to go up
          // leaves the row confirmed, «بدون صورة», to be photographed from its cell.
          if (file !== null) {
            try {
              await upload.mutateAsync({ id: row.id, file });
              toast.success(t('operations.delivered.done'));
            } catch {
              toast.error(t('operations.delivered.photoFailed'));
            }
          } else {
            toast.success(
              hasPhoto ? t('operations.delivered.done') : t('operations.delivered.doneNoPhoto'),
            );
          }
          onClose();
        },
        (error: unknown) => {
          const refusal = deliveryRefusalOf(error);
          if (refusal?.kind === 'receiptNumber') {
            setRefused((r) => ({ ...r, receiptNumber: refusal.problem }));
          } else if (refusal?.kind === 'billedSide') {
            setRefused((r) => ({ ...r, billedSide: true }));
          } else {
            toast.error(errorMessage(error, locale));
            // The row moved: the screen is re-read (the query hook), the dialog closes onto it.
            if (refusal?.kind === 'stale') onClose();
          }
        },
      )
      .finally(() => {
        sending.current = false;
        setWaiting(false);
      });
  };

  /** A side chosen — by a click, or by the arrows, which move the focus with it. */
  const pickSide = (side: OperationsDeliveryBilledSide): void => {
    setDraft((d) => ({ ...d, billedSide: side }));
    setRefused((r) => ({ ...r, billedSide: false }));
  };

  const numberError =
    numberProblem === 'required'
      ? t('operations.delivered.receipt.required')
      : numberProblem === 'tooLong'
        ? t('operations.delivered.receipt.tooLong', {
            max: formatNumber(RECEIPT_NUMBER_MAX, locale),
          })
        : undefined;

  const caption = [
    row.origin?.bankName,
    `${row.origin?.name ?? '…'} ← ${row.destination?.name ?? '…'}`,
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t('operations.delivered.dialog.title')}
      subtitle={caption}
      icon={SHIPMENT_PATH.receipt}
      width="xl"
      wrapTitle
      panelProps={{ 'data-delivered-dialog': row.id }}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <DesignSave
            onClick={send}
            busy={busy}
            label={t('operations.delivered.dialog.save')}
            data-delivered-save="true"
          />
          <DesignCancel onClick={onClose} label={t('common.cancel')} />
        </div>
      }
    >
      <div ref={inside} className="space-y-5">
        <DesignField
          label={t('operations.delivered.receipt.label')}
          required
          missing={numberProblem === 'required'}
          error={numberError}
          hint={t('operations.delivered.receipt.hint', {
            max: formatNumber(RECEIPT_NUMBER_MAX, locale),
          })}
        >
          <Input
            ref={numberBox}
            value={draft.receiptNumber}
            // The server's ceiling, with room for spaces it trims.
            maxLength={RECEIPT_NUMBER_MAX + 10}
            dir="ltr"
            inputMode="text"
            autoComplete="off"
            aria-required="true"
            aria-invalid={numberProblem !== null}
            tone={cn(box, MONO, 'text-center')}
            data-delivered-receipt-input="true"
            onChange={(e) => {
              setDraft((d) => ({ ...d, receiptNumber: e.target.value }));
              setRefused((r) => ({ ...r, receiptNumber: null }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
        </DesignField>

        {/* «صورة الإيصال» — optional, with its warning («اختيارية مع تنبيه»). */}
        <div className="space-y-2" data-delivered-photo-field="true">
          <span className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900 dark:text-white">
            {t('operations.delivered.photo.label')}
            <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {t('operations.delivered.photo.optional')}
            </span>
          </span>
          {hasPhoto ? (
            <CurrentPhoto row={row} />
          ) : (
            <>
              {mayPickPhoto && (
                <div className="flex flex-wrap items-center gap-3">
                  <PhotoPickButton
                    accept={SHIPMENT_RECEIPT_IMAGE_ACCEPT}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-indigo-500/60 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:text-slate-200"
                    disabled={busy}
                    label={t('operations.delivered.photo.pick')}
                    data-delivered-photo-pick="true"
                    onFile={(picked) => setFile(picked)}
                  >
                    <BoardIcon d={SHIPMENT_PATH.receipt} className="h-4 w-4" />
                    {file === null
                      ? t('operations.delivered.photo.pick')
                      : t('operations.delivered.photo.change')}
                  </PhotoPickButton>
                  {file !== null && (
                    <span className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      {preview !== null && (
                        <img src={preview} alt="" className="h-10 w-10 rounded-md object-cover" />
                      )}
                      <span className="truncate" data-delivered-photo-picked="true">
                        {file.name}
                      </span>
                    </span>
                  )}
                </div>
              )}
              {file === null && (
                <p
                  role="note"
                  data-delivered-photo-warning="true"
                  className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <BoardIcon d={SHIPMENT_PATH.alert} className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {mayPickPhoto
                      ? t('operations.delivered.photo.warning')
                      : t('operations.delivered.photo.warningCannotPick')}
                  </span>
                </p>
              )}
            </>
          )}
        </div>

        {/* «البنك الذي تُحتسب عليه تكلفة النقل» — exactly two, «من» or «إلى». */}
        <div className="space-y-2">
          <span
            id={`delivered-side-${row.id}`}
            className="block text-[15px] font-bold text-slate-900 dark:text-white"
          >
            {t('operations.delivered.side.label')} <span className="text-rose-500">*</span>
          </span>
          <div
            role="radiogroup"
            aria-labelledby={`delivered-side-${row.id}`}
            aria-required="true"
            aria-invalid={sideMissing}
            onKeyDown={(event) => {
              if (busy) return;
              // The next side lies in the reading direction — left in Arabic, right in English.
              const next = billedSideAfterKey(
                options,
                draft.billedSide,
                event.key,
                locale === 'ar',
              );
              if (next === null) return;
              event.preventDefault();
              pickSide(next);
              sideButtons.current[next]?.focus();
            }}
            className={cn(
              'flex flex-col gap-2 sm:flex-row',
              sideMissing &&
                'rounded-xl ring-1 ring-rose-500/70 ring-offset-2 ring-offset-transparent',
            )}
          >
            {options.map((option) => (
              <SideChoice
                key={option.side}
                side={option.side}
                checked={draft.billedSide === option.side}
                tabStop={tabStop === option.side}
                disabled={!option.available || busy}
                word={t(sideKey(option.side))}
                bank={option.available ? option.bankName : '…'}
                branch={option.branchName}
                onPick={() => pickSide(option.side)}
                buttonRef={(node) => {
                  sideButtons.current[option.side] = node;
                }}
              />
            ))}
          </div>
          {oneBank && (
            <p
              className="text-[13px] font-medium text-slate-600 dark:text-slate-300"
              data-delivered-one-bank="true"
            >
              {t('operations.delivered.side.sameBank', { bank: row.origin?.bankName ?? '' })}
            </p>
          )}
          {sideMissing && (
            <p
              role="alert"
              className="text-[13px] font-semibold text-[#ff6b81]"
              data-delivered-side-missing="true"
            >
              {t('operations.delivered.side.required')}
            </p>
          )}
        </div>
      </div>
    </DesignDialog>
  );
};
