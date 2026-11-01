// «إلغاء الاستعاضة المعلّقة» — a held replenishment withdrawn before its money came. Opened from its
// drawer's red words (`?cancelHeld=<id>`, mounted once in the fund's head with the other fund
// dialogs).
//
// What happens is said before the click: its memos go back to «لم تُستعَض بعد» (each one listed),
// «إجمالي العهدة لا يتغيّر» (the fund now, the same figure), and the letter stays in «سجل العهدة» as
// a cancelled replenishment — nothing is deleted. The reason is optional. The red button says
// «إلغاء الاستعاضة»; the way back says «رجوع», never «إلغاء», which would read as the action itself.
//
// Confirmed or cancelled elsewhere since it opened (409 / 404), or a link to one no longer held:
// «…فلم يُلغَ شيء», the log read again, the dialog closed. One press sends once.
import { useEffect, useRef, useState } from 'react';
import { type FleetCustodySource, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Textarea } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import {
  useCancelCustodyReplenishment,
  useCustodyFundSummary,
  useCustodyOperation,
} from '../api/fleet-queries';
import { useCustodyCount } from '../lib/custody-words';
import { cancelHeldBody, holdRefusalOf } from '../lib/custody-hold';
import { DesignCancel, DesignDialog } from './DesignDialog';
import { DesignField } from './FuelCardDialog';
import { BoardIcon, NUM, ymd } from './FuelCardBoard';
import { NOTE_BOX } from './LicenseExpensePaidGroup';
import { CountChip, MEMO_ICON, SectionHead } from './custody-memo-parts';
import { CANCEL_ICON } from './custody-hold-parts';
import { HeldMemoTable } from './custody-hold-memos';

const HOLD = 'fleet.custody.hold';
const REASON_MAX = 500;

/** The red save of the design: `DesignSave`'s shape, the danger colour. */
const DANGER_SAVE = cn(
  'flex items-center gap-2 rounded-xl px-8 py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60',
  'bg-gradient-to-r from-red-600 to-rose-600 shadow-[0_6px_24px_rgba(225,29,72,0.45)] hover:from-red-500 hover:to-rose-500',
);

export const CustodyCancelHeldDialog = ({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { count } = useCustodyCount();
  const op = useCustodyOperation(id);
  const fund = useCustodyFundSummary();
  const cancel = useCancelCustodyReplenishment();
  const [reason, setReason] = useState('');
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const data = op.data;
  const amount = data?.amount ?? 0;
  const kinds = [...(data?.memos ?? [])]
    .sort((a, b) => a.no - b.no)
    .reduce<FleetCustodySource[]>(
      (all, memo) => (all.includes(memo.kind) ? all : [...all, memo.kind]),
      [],
    );
  const fundNow = fund.data?.fundTotal;
  const money = (value: number): { figure: string; currency: string } =>
    formatMoneyParts(value, 'EGP', locale);
  const busy = waiting || cancel.isPending;

  const taken = (): void => {
    toast.error(t(`${HOLD}.cancelTaken`));
    onClose();
  };
  // A link to a replenishment that is no longer held: said, and closed, before anything is sent.
  useEffect(() => {
    if (sending.current || data === undefined) return;
    if (data.kind !== 'replenish' || data.status !== 'held') taken();
  }, [data]);

  const send = (): void => {
    if (sending.current || data === undefined) return;
    sending.current = true;
    setWaiting(true);
    cancel
      .mutateAsync({ id, body: cancelHeldBody(reason) })
      .then(
        () => {
          toast.success(t(`${HOLD}.cancelDone`));
          onClose();
        },
        (error: unknown) => {
          sending.current = false;
          if (holdRefusalOf(error) === 'taken') taken();
          else toast.error(errorMessage(error, locale));
        },
      )
      .finally(() => setWaiting(false));
  };

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t(`${HOLD}.cancel`)}
      subtitle={
        data === undefined
          ? undefined
          : t(`${HOLD}.cancelSubtitle`, {
              date: ymd(data.date),
              memos: count('memo', data.memos.length),
              amount: `${money(amount).figure} ${money(amount).currency}`,
            })
      }
      icon={CANCEL_ICON}
      width="3xl"
      panelProps={{ 'data-memo-cancel': id }}
      footer={
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            className={DANGER_SAVE}
            data-memo-cancel-save="true"
            aria-busy={busy}
            disabled={busy || data === undefined}
            onClick={send}
          >
            <BoardIcon d={CANCEL_ICON} className="h-4 w-4" />
            <span>{t(`${HOLD}.cancelSave`)}</span>
          </button>
          <DesignCancel onClick={onClose} label={t(`${HOLD}.cancelBack`)} />
        </div>
      }
    >
      {/* What the click does — before it is made. */}
      <div
        data-memo-cancel-body="true"
        className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-[15px] font-semibold leading-7 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/[0.08] dark:text-rose-100"
      >
        <BoardIcon
          d={CANCEL_ICON}
          className="mt-1.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
        />
        <span>{t(`${HOLD}.cancelBody`, { memos: count('memo', data?.memos.length ?? 0) })}</span>
      </div>

      {/* The fund, before and after: the same figure — nothing is taken from it, nothing added. */}
      {fundNow !== undefined && (
        <div
          data-memo-cancel-fund={fundNow}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
        >
          <span className="text-[15px] font-bold text-slate-700 dark:text-slate-200">
            {t(`${HOLD}.cancelFund`)}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span
              dir="ltr"
              className={cn(
                NUM,
                'text-lg font-black',
                fundNow < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white',
              )}
            >
              {fundNow < 0 ? '−' : ''}
              {money(Math.abs(fundNow)).figure}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {money(fundNow).currency}
            </span>
          </span>
        </div>
      )}

      <div>
        <DesignField label={t(`${HOLD}.cancelReason`)}>
          <Textarea
            rows={2}
            maxLength={REASON_MAX}
            value={reason}
            placeholder={t(`${HOLD}.cancelReasonHint`)}
            onChange={(e) => setReason(e.target.value)}
            className={NOTE_BOX}
            data-memo-cancel-reason="true"
          />
        </DesignField>
      </div>

      <section className="space-y-3">
        <SectionHead
          title={t(`${HOLD}.cancelMemos`)}
          icon={MEMO_ICON}
          end={
            data === undefined ? undefined : (
              <CountChip>{count('memo', data.memos.length)}</CountChip>
            )
          }
        />
        {data !== undefined ? (
          <HeldMemoTable op={data} kinds={kinds} tone="slate" mark="cancel" />
        ) : op.isError ? (
          <ErrorState error={op.error} onRetry={() => void op.refetch()} />
        ) : (
          <p className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </p>
        )}
      </section>
    </DesignDialog>
  );
};
