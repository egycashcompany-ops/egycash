// «حذف العملية» — «حذف طلب العهدة» / «حذف الاستعاضة» / «حذف التسوية», opened at `?deleteOp=<id>`
// from a line's red bin or a drawer's «حذف العملية» (mounted once in the fund's head with the other
// fund dialogs, `CustodyFundDialogs`). The shape is `CustodyCancelHeldDialog`'s:
//
//   · the rose sentence of what the click does, by kind and status — a held replenishment adds how
//     to keep it in the log instead («إلغاء الاستعاضة المعلّقة»);
//   · a charge with operations after it: allowed, said in red — how many, that each one's «بعدها» is
//     worked out again, and the fund below zero when it goes there;
//   · the strip «إجمالي العهدة الآن X ← بعد الحذف Y» (red, with its minus, below zero), or «إجمالي
//     العهدة لا يتغيّر» for a held or cancelled replenishment;
//   · «الخطابات التي طُبعت بعد هذه العملية…» when operations follow it and the fund moves;
//   · the optional «سبب الحذف»;
//   · the memos (`HeldMemoTable`) or the licence parts that go back.
//
// The red button says «حذف العملية»; the way back says «رجوع». One press sends once. Changed or
// deleted elsewhere since it opened (409 / 404): «…فلم يُحذف شيء», the log read again, closed.
import { useRef, useState } from 'react';
import { type FleetCustodySource, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Textarea } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { AlertIcon } from '../../../shared/ui/icons';
import { errorMessage } from '../../../shared/lib/errors';
import { formatMoneyParts } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useCustodyFundSummary, useCustodyLedger, useCustodyOperation } from '../api/fleet-queries';
import { useDeleteCustodyOperation } from '../api/custody-delete-queries';
import { useCustodyCount } from '../lib/custody-words';
import { partsPhrase } from '../lib/custody-ledger-words';
import { operationStatusOf } from '../lib/custody-hold';
import {
  deleteBody,
  deleteBodyKey,
  deleteRefusalOf,
  deleteTitleKey,
  deletionEffectOf,
  fundAfterDelete,
  laterOperationsOf,
  laterOperationsQuery,
} from '../lib/custody-delete';
import { DesignCancel, DesignDialog } from './DesignDialog';
import { DesignField } from './FuelCardDialog';
import { BoardIcon, NUM, ymd } from './FuelCardBoard';
import { NOTE_BOX } from './LicenseExpensePaidGroup';
import { CUSTODY_OPS } from './CustodyFundActions';
import { useLedgerWordsKit } from './CustodyOperationDrawer';
import { useCount } from './custody-dashboard-parts';
import { CountChip, MEMO_ICON, SectionHead } from './custody-memo-parts';
import { HeldMemoTable } from './custody-hold-memos';
import { BIN_ICON, DeleteMemoCards, DeletePartsTable } from './custody-delete-parts';

const DELETE = 'fleet.custody.delete';
const REASON_MAX = 500;
/** Where a figure stands in a sentence — the sentence is split on it, the figure drawn apart. */
const MARK = '';
const LICENCE_ICON: readonly string[] = [
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
  'M14 2v6h6',
  'M8 13h8',
  'M8 17h5',
];
const INFO_ICON: readonly string[] = [
  'M12 21a9 9 0 100-18 9 9 0 000 18z',
  'M12 16v-5',
  'M12 8h.01',
];

/** The red save of the design — the cancel-held dialog's. */
const DANGER_SAVE = cn(
  'flex items-center gap-2 rounded-xl px-8 py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60',
  'bg-gradient-to-r from-red-600 to-rose-600 shadow-[0_6px_24px_rgba(225,29,72,0.45)] hover:from-red-500 hover:to-rose-500',
);
const NEGATIVE_INK = 'text-red-600 dark:text-red-400';

/** A figure as the strip draws it: big, the minus before it (left to right), red below zero. */
const StripFigure = ({ value, mark }: { value: number; mark: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const money = formatMoneyParts(Math.abs(value), 'EGP', locale);
  return (
    <span className="flex items-baseline gap-1.5" data-delete-fund={mark}>
      <span
        dir="ltr"
        className={cn(
          NUM,
          'text-lg font-black',
          value < 0 ? NEGATIVE_INK : 'text-slate-900 dark:text-white',
        )}
      >
        {value < 0 ? '−' : ''}
        {money.figure}
      </span>
      <span className="text-sm text-slate-500 dark:text-slate-400">{money.currency}</span>
    </span>
  );
};

export const CustodyDeleteOperationDialog = ({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { count } = useCustodyCount();
  const cars = useCount();
  const kit = useLedgerWordsKit();
  const op = useCustodyOperation(id);
  const fund = useCustodyFundSummary();
  const data = op.data;
  // Where it stands in the whole history: the operations recorded after it (oldest first, from its
  // day on) — their «بعدها» moves, and the letters printed after it keep their figures.
  const ledger = useCustodyLedger(laterOperationsQuery(data ?? { date: '' }), data !== undefined);
  const later = laterOperationsOf(ledger.data, id) ?? 0;
  const remove = useDeleteCustodyOperation();
  const [reason, setReason] = useState('');
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const status = data === undefined ? 'done' : operationStatusOf(data);
  const effect = data === undefined ? null : deletionEffectOf(data);
  const fundNow = fund.data?.fundTotal;
  const fundAfter =
    fundNow === undefined || effect === null ? undefined : fundAfterDelete(fundNow, effect);
  const money = (value: number): string => {
    const parts = formatMoneyParts(value, 'EGP', locale);
    return `${parts.figure} ${parts.currency}`;
  };
  const busy = waiting || remove.isPending;

  const send = (): void => {
    if (sending.current || data === undefined) return;
    sending.current = true;
    setWaiting(true);
    remove
      .mutateAsync({ id, body: deleteBody(reason, data.version) })
      .then(
        () => {
          toast.success(t(`${DELETE}.done`));
          onClose();
        },
        (error: unknown) => {
          sending.current = false;
          if (deleteRefusalOf(error) === 'taken') {
            toast.error(t(`${DELETE}.taken`));
            onClose();
          } else toast.error(errorMessage(error, locale));
        },
      )
      .finally(() => setWaiting(false));
  };

  const kinds = [...(data?.memos ?? [])]
    .sort((a, b) => a.no - b.no)
    .reduce<FleetCustodySource[]>(
      (all, memo) => (all.includes(memo.kind) ? all : [...all, memo.kind]),
      [],
    );
  const body =
    data === undefined
      ? ''
      : t(deleteBodyKey(data), {
          memos: count('memo', data.memos.length),
          parts: data.parts
            .map((part) =>
              t('fleet.custody.fundForm.settle.pill', {
                kind: t(`fleet.custody.fundForm.settle.kind.${part.part}`),
                cars: cars.count('car', part.cars),
              }),
            )
            .join(kit.separator),
        });
  const subtitle =
    data === undefined
      ? undefined
      : t(`${DELETE}.${data.kind === 'replenish' ? 'subtitleMemos' : 'subtitle'}`, {
          op: t(CUSTODY_OPS[data.kind].label),
          date: ymd(data.date),
          memos: count('memo', data.memos.length),
          amount: money(data.amount),
        });
  const goesNegative = fundAfter !== undefined && fundAfter < 0 && (fundNow ?? 0) >= 0;
  const [negBefore = '', negAfter = ''] = t(`${DELETE}.negative`, { amount: MARK }).split(MARK);
  const moves = effect !== null && effect.fundDelta !== 0;

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={data === undefined ? t(`${DELETE}.action`) : t(deleteTitleKey(data))}
      subtitle={subtitle}
      icon={BIN_ICON}
      width="3xl"
      panelProps={{ 'data-custody-delete': id }}
      footer={
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            className={DANGER_SAVE}
            data-custody-delete-save="true"
            aria-busy={busy}
            disabled={busy || data === undefined}
            onClick={send}
          >
            <BoardIcon d={BIN_ICON} className="h-4 w-4" />
            <span>{t(`${DELETE}.save`)}</span>
          </button>
          <DesignCancel onClick={onClose} label={t(`${DELETE}.back`)} />
        </div>
      }
    >
      {/* What the click does — before it is made. */}
      <div
        data-custody-delete-body="true"
        className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-[15px] font-semibold leading-7 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/[0.08] dark:text-rose-100"
      >
        <BoardIcon
          d={BIN_ICON}
          className="mt-1.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
        />
        <span>
          {body}
          {/* A held one has two exits: say which keeps it in the log. */}
          {data !== undefined && data.kind === 'replenish' && status === 'held' && (
            <span
              className="mt-1 block text-[14px] font-semibold text-rose-800/90 dark:text-rose-200/90"
              data-custody-delete-held-or-cancel="true"
            >
              {t(`${DELETE}.heldOrCancel`)}
            </span>
          )}
        </span>
      </div>

      {/* A charge with operations after it: allowed, said in red — and below zero, the figure. */}
      {data !== undefined && data.kind === 'charge' && later > 0 && (
        <div
          data-custody-delete-later={later}
          className="flex items-start gap-3 rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-[15px] leading-7 text-red-900 dark:border-red-500/70 dark:bg-red-500/[0.12] dark:text-red-100"
        >
          <AlertIcon className="mt-1 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <span className="font-semibold">
            <b className="block font-black text-red-700 dark:text-red-300">
              {t(`${DELETE}.laterTitle`, { operations: count('operation', later) })}
            </b>
            {t(`${DELETE}.laterBody`)}
            {goesNegative && fundAfter !== undefined && (
              <span className="mt-1 block font-bold" data-custody-delete-negative="true">
                {negBefore}
                <span dir="ltr" className={cn(NUM, 'font-black text-red-700 dark:text-red-300')}>
                  −{formatMoneyParts(Math.abs(fundAfter), 'EGP', locale).figure}
                </span>{' '}
                {formatMoneyParts(0, 'EGP', locale).currency}
                {negAfter}
              </span>
            )}
            <span className="mt-1 block text-[13px] font-semibold text-red-800/90 dark:text-red-200/90">
              {t(`${DELETE}.allowed`)}
            </span>
          </span>
        </div>
      )}

      {/* The fund now → after the delete; the same figure when nothing moves. */}
      {fundNow !== undefined && fundAfter !== undefined && (
        <div
          data-custody-delete-strip="true"
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3',
            fundAfter < 0
              ? 'border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/[0.06]'
              : 'border-slate-200 bg-slate-50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80',
          )}
        >
          {!moves ? (
            <>
              <span className="text-[15px] font-bold text-slate-700 dark:text-slate-200">
                {t(`${DELETE}.fundUnchanged`)}
              </span>
              <StripFigure value={fundNow} mark="same" />
            </>
          ) : (
            <>
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  {t(`${DELETE}.fundNow`)}
                </span>
                <StripFigure value={fundNow} mark="now" />
              </span>
              <span
                aria-hidden="true"
                className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400"
              >
                <span
                  dir="ltr"
                  data-custody-delete-delta={effect?.fundDelta ?? 0}
                  className={cn(
                    NUM,
                    'rounded-full border px-2.5 py-0.5 text-[13px] font-black',
                    (effect?.fundDelta ?? 0) < 0
                      ? 'border-red-300 text-red-700 dark:border-red-500/50 dark:text-red-300'
                      : 'border-emerald-300 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300',
                  )}
                >
                  {(effect?.fundDelta ?? 0) < 0 ? '−' : '+'}
                  {formatMoneyParts(Math.abs(effect?.fundDelta ?? 0), 'EGP', locale).figure}
                </span>
                <span className="hidden text-lg sm:inline">←</span>
                <span className="text-lg sm:hidden">↓</span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <span
                  className={cn(
                    'text-xs font-bold',
                    fundAfter < 0 ? NEGATIVE_INK : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  {t(`${DELETE}.fundAfter`)}
                </span>
                <StripFigure value={fundAfter} mark="after" />
              </span>
            </>
          )}
        </div>
      )}

      {/* Signed paper is not rewritten — said only when the delete moves the fund (a held or
          cancelled replenishment never entered a later letter's figures). */}
      {later > 0 && moves && (
        <p
          data-custody-delete-letters="true"
          className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold leading-6 text-slate-600 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:text-slate-300"
        >
          <BoardIcon
            d={INFO_ICON}
            className="mt-1 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
          />
          {t(`${DELETE}.lettersKept`)}
        </p>
      )}

      <div>
        <DesignField label={t(`${DELETE}.reason`)}>
          <Textarea
            rows={2}
            maxLength={REASON_MAX}
            value={reason}
            placeholder={t(`${DELETE}.reasonHint`)}
            onChange={(e) => setReason(e.target.value)}
            className={NOTE_BOX}
            data-custody-delete-reason="true"
          />
        </DesignField>
      </div>

      {data !== undefined && effect !== null && effect.memos && (
        <section className="space-y-3">
          <SectionHead
            title={t(`${DELETE}.memosBack`)}
            icon={MEMO_ICON}
            end={<CountChip>{count('memo', data.memos.length)}</CountChip>}
          />
          <div className="hidden sm:block">
            <HeldMemoTable op={data} kinds={kinds} tone="slate" mark="cancel" />
          </div>
          <DeleteMemoCards op={data} />
        </section>
      )}

      {data !== undefined && effect !== null && effect.parts && (
        <section className="space-y-3">
          <SectionHead
            title={t(`${DELETE}.partsBack`)}
            icon={LICENCE_ICON}
            end={<CountChip>{partsPhrase(data.parts.length, kit)}</CountChip>}
          />
          <DeletePartsTable op={data} />
        </section>
      )}

      {data === undefined &&
        (op.isError ? (
          <ErrorState error={op.error} onRetry={() => void op.refetch()} />
        ) : (
          <p className="flex justify-center py-6">
            <Spinner className="h-5 w-5" />
          </p>
        ))}
    </DesignDialog>
  );
};
