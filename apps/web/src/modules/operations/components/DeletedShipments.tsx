// «اعملى ايقون اقدر اجيب منه اللى اتمسح» — the history's deleted shipments, behind one icon in its
// toolbar (the day board has none: it is today's working set, and what was deleted from it is found
// on the history like any other day).
//
// The icon counts the shipments deleted from the board days of the history's own «من» … «إلى»
// range (the server's list: the history's union over deleted rows, newest deleted first). Its
// dialog shows each as the board shows a row — the van, the bank, من → إلى, the money in the
// board's currency order, the captain, the day — and when and by whom it was deleted, with
// «السجل» (its story, the same dialog as a row's) and «استرجاع», which puts it back on its day and
// on the history. Restoring takes the grant that deletes (`operationsShipment.delete`): whoever
// may take a shipment off its board may put it back.
import { Fragment, useState, type ReactNode } from 'react';
import {
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type Locale,
  type OperationsCurrencyDto,
  type OperationsDeletedShipmentDto,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { cn } from '../../../shared/lib/cn';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { HistoryIcon } from '../../../shared/ui/icons';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { Filled } from '../../fleet/components/fuel-reconcile/reconcile-cells';
import {
  useOperationsDeletedShipments,
  useRestoreOperationsShipment,
} from '../api/operations-queries';
import { branchCell, orderedBoardTotals } from '../lib/day-board';
import { isHistoryTooLarge, type HistoryRange } from '../lib/shipment-history';
import { cairoStampText, shipmentCaption } from '../lib/shipment-log';
import { ShipmentTypeBadge } from './ShipmentBadges';
import { ShipmentLogDialog, type ShipmentLogTarget } from './ShipmentLogDialog';
import { SHIPMENT_PATH } from './shipment-icons';

/** The toolbar's icon: a quiet square beside «الإحصائيات», the count in a red dot on its corner. */
const ICON_BUTTON =
  'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:h-8 sm:w-8 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]';

/** The two buttons on a card: the log in slate (a log, as among a row's actions), restore in green. */
const LOG_BUTTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 active:scale-95 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]';
const RESTORE_BUTTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-700 transition hover:bg-emerald-500/25 active:scale-95 disabled:opacity-60 dark:text-emerald-300';

/** One fact of a card: its name over it, as the Fleet cards set theirs. */
const Fact = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <div className={cn('min-w-0', className)}>
    <dt className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">{children}</dd>
  </div>
);

/** One side of the route — the branch, with its bank above it when the board prints one there. */
const Side = ({
  bank,
  branch,
  bankTone,
}: {
  bank: string | null;
  branch: string | null;
  bankTone: string;
}): JSX.Element => (
  <span className="min-w-0 leading-tight">
    {bank !== null && <span className={cn('block text-[11px]', bankTone)}>{bank}</span>}
    <span className="block">{branch ?? '…'}</span>
  </span>
);

/** One deleted shipment, as a card. */
const DeletedShipmentCard = ({
  row,
  bankNameOf,
  currencyOf,
  locale,
  canRestore,
  restoring,
  onLog,
  onRestore,
}: {
  row: OperationsDeletedShipmentDto;
  bankNameOf: (bankId: string) => string;
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: Locale;
  canRestore: boolean;
  restoring: boolean;
  onLog: (row: OperationsDeletedShipmentDto) => void;
  onRestore: (row: OperationsDeletedShipmentDto) => void;
}): JSX.Element => {
  const t = useT();
  const origin = branchCell(row, 'origin', bankNameOf);
  const destination = branchCell(row, 'destination', bankNameOf);
  const totals = orderedBoardTotals([row], currencyOf);
  const deletedAt = (
    <bdi dir="ltr" className={NUM}>
      {cairoStampText(row.deletedAt)}
    </bdi>
  );
  return (
    <li
      data-deleted-shipment={row.id}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-[#e86870]">
          <BoardIcon d={[...SHIPMENT_PATH.shipment]} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 leading-tight">
            <span className="text-lg font-black text-slate-900 dark:text-white">
              {bankNameOf(row.mainBankId) || '…'}
            </span>
            <ShipmentTypeBadge shipmentType={row.shipmentType} />
          </p>
          {/* «من فرع» → «إلى فرع», with the other bank above a branch where the board prints it. */}
          <p className="mt-1.5 flex flex-wrap items-end gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <Side
              bank={origin.bank}
              branch={origin.branch}
              bankTone="text-amber-700 dark:text-amber-300"
            />
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="mb-0.5 h-4 w-4 shrink-0 text-slate-400 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M5 12h14m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <Side
              bank={destination.bank}
              branch={destination.branch}
              bankTone="text-red-700 dark:text-red-400"
            />
          </p>
        </div>
        {/* The board day — a secured row's collection day (green) above its delivery day, as the
            board's «التاريخ» column writes them. */}
        <span
          dir="ltr"
          className={cn(
            'shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-end text-xs font-bold leading-tight text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200',
            NUM,
          )}
        >
          {row.shipmentType === 'secured' ? (
            <>
              <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">
                {row.collectionDate.slice(0, 10)}
              </span>
              <span className="block">{row.deliveryDate?.slice(0, 10) ?? '—'}</span>
            </>
          ) : (
            row.collectionDate.slice(0, 10)
          )}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[6rem_minmax(0,12rem)_minmax(0,1fr)]">
        <Fact label={t('operations.board.vehicle')}>
          <span className={NUM}>{row.crew?.vehicleCode ?? '—'}</span>
        </Fact>
        <Fact label={t('operations.board.captain')}>{row.crew?.captainName ?? '—'}</Fact>
        <Fact label={t('operations.shipment.form.amount')} className="col-span-2 sm:col-span-1">
          {/* The board's amount cell: one line per currency, مصري then دولار then the rest. */}
          <span className="grid w-fit grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5">
            {totals.map((total) => (
              <Fragment key={total.currencyId}>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {currencyOf(total.currencyId)?.name ?? '…'}
                </span>
                <span dir="ltr" className={cn('whitespace-nowrap text-right', NUM)}>
                  {formatAmount(total.amount, locale)}
                </span>
              </Fragment>
            ))}
          </span>
        </Fact>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-white/[0.06]">
        <p
          data-deleted-by="true"
          className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300"
        >
          <BoardIcon d={[...PATH.trash]} className="h-3.5 w-3.5 shrink-0" />
          <span>
            {row.deletedByName !== null ? (
              <Filled
                template={t('operations.shipment.deletedList.deletedBy')}
                values={{ at: deletedAt, name: row.deletedByName }}
              />
            ) : (
              <Filled
                template={t('operations.shipment.deletedList.deletedAt')}
                values={{ at: deletedAt }}
              />
            )}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-deleted-log={row.id}
            aria-haspopup="dialog"
            onClick={() => onLog(row)}
            className={LOG_BUTTON}
          >
            <HistoryIcon className="h-3.5 w-3.5" />
            {t('operations.shipment.deletedList.log')}
          </button>
          {canRestore && (
            <button
              type="button"
              data-deleted-restore={row.id}
              disabled={restoring}
              aria-busy={restoring}
              onClick={() => onRestore(row)}
              className={RESTORE_BUTTON}
            >
              {restoring ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <BoardIcon d={[...SHIPMENT_PATH.trashRestore]} className="h-3.5 w-3.5" />
              )}
              {t('operations.shipment.deletedList.restore')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

/**
 * The cards, or the empty line — apart from the dialog and its query so it can be rendered (and
 * pinned) without either.
 */
export const DeletedShipmentsList = ({
  rows,
  bankNameOf,
  currencyOf,
  locale,
  canRestore,
  restoringId,
  onLog,
  onRestore,
}: {
  rows: readonly OperationsDeletedShipmentDto[];
  bankNameOf: (bankId: string) => string;
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
  locale: Locale;
  /** `operationsShipment.delete` — the grant that deletes is the one that brings back. */
  canRestore: boolean;
  /** The row being restored now — its button waits. */
  restoringId: string | null;
  onLog: (row: OperationsDeletedShipmentDto) => void;
  onRestore: (row: OperationsDeletedShipmentDto) => void;
}): JSX.Element => {
  const t = useT();
  if (rows.length === 0) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-500/15 text-slate-500 dark:text-slate-400">
          <BoardIcon d={[...SHIPMENT_PATH.trashRestore]} className="h-7 w-7" />
        </span>
        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
          {t('operations.shipment.deletedList.empty')}
        </p>
      </div>
    );
  }
  return (
    <ul data-deleted-shipments-list="true" className="space-y-3">
      {rows.map((row) => (
        <DeletedShipmentCard
          key={row.id}
          row={row}
          bankNameOf={bankNameOf}
          currencyOf={currencyOf}
          locale={locale}
          canRestore={canRestore}
          restoring={restoringId === row.id}
          onLog={onLog}
          onRestore={onRestore}
        />
      ))}
    </ul>
  );
};

/**
 * The toolbar's icon with its count, the dialog it opens, and the log a card opens. Mounted by the
 * board only where the page hands it a range — the history.
 */
export const DeletedShipmentsControl = ({
  range,
  enabled,
  type,
  bankNameOf,
  currencyOf,
}: {
  range: HistoryRange;
  /** False while the page holds a range the endpoint would refuse — the icon waits, disabled. */
  enabled: boolean;
  /**
   * Round 12 — one shipment type only, as the page's history reads it: «سجل الخزينة» lists the
   * deleted محصنات alone, never the deleted dailies beside them. Left out, both («سجل الشحنات»).
   */
  type?: OperationsShipmentType | undefined;
  bankNameOf: (bankId: string) => string;
  currencyOf: (id: string) => OperationsCurrencyDto | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const deleted = useOperationsDeletedShipments(range, enabled, type);
  const restore = useRestoreOperationsShipment();
  const [open, setOpen] = useState(false);
  const [logOf, setLogOf] = useState<ShipmentLogTarget | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const rows = enabled ? (deleted.data?.shipments ?? []) : [];
  const count = rows.length;
  const canRestore = can('operationsShipment.delete');
  const label = !enabled
    ? t('operations.shipment.deletedList.unavailable')
    : count > 0
      ? t('operations.shipment.deletedList.openCount', { count: formatNumber(count, locale) })
      : t('operations.shipment.deletedList.open');

  const openList = (): void => {
    setOpen(true);
    // Another desk's delete only marks this list stale (it is a whole range — `isStaleOnlyKey`),
    // so opening it is when it is read afresh.
    if (deleted.isStale) void deleted.refetch();
  };

  const restoreRow = async (row: OperationsDeletedShipmentDto): Promise<void> => {
    // It changes two screens at once — the day it returns to, and the history — so it is confirmed.
    if (!window.confirm(t('operations.shipment.deletedList.confirmRestore'))) return;
    setRestoringId(row.id);
    try {
      await restore.mutateAsync(row.id);
      toast.success(t('operations.shipment.deletedList.restored'));
    } catch {
      // The global notifier words the refusal (`OPERATIONS_SHIPMENT_NOT_DELETED` when another desk
      // restored it first), and the list has refreshed behind it.
    } finally {
      setRestoringId(null);
    }
  };

  const tooLarge = isHistoryTooLarge(deleted.error);
  let body: JSX.Element;
  if (deleted.data === undefined && deleted.isError) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm font-bold text-red-700 dark:text-red-300">
          {tooLarge
            ? t('operations.history.tooLarge', {
                max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
              })
            : t('operations.shipment.deletedList.loadFailed')}
        </p>
        {!tooLarge && (
          <button type="button" onClick={() => void deleted.refetch()} className={LOG_BUTTON}>
            {t('common.retry')}
          </button>
        )}
      </div>
    );
  } else if (deleted.data === undefined) {
    body = (
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-10 text-center text-sm font-bold text-slate-500 dark:text-slate-400"
      >
        <Spinner className="h-5 w-5" />
        <p>{t('common.loading')}</p>
      </div>
    );
  } else {
    body = (
      <DeletedShipmentsList
        rows={rows}
        bankNameOf={bankNameOf}
        currencyOf={currencyOf}
        locale={locale}
        canRestore={canRestore}
        restoringId={restoringId}
        onLog={(row) => setLogOf({ id: row.id, caption: shipmentCaption(row, bankNameOf, t) })}
        onRestore={(row) => void restoreRow(row)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        data-deleted-shipments="true"
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        disabled={!enabled}
        onClick={openList}
        className={ICON_BUTTON}
      >
        <BoardIcon d={[...SHIPMENT_PATH.trashRestore]} className="h-4 w-4" />
        {count > 0 && (
          <span
            aria-hidden="true"
            data-deleted-count={count}
            className="absolute -end-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white dark:bg-red-500 dark:ring-[#0b1220]"
          >
            {formatNumber(count, locale)}
          </span>
        )}
      </button>

      <DesignDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('operations.shipment.deletedList.title')}
        // The two days in their own order inside the Arabic sentence (`ltrIsolate`'s reason).
        subtitle={
          <Filled
            template={t('operations.shipment.deletedList.subtitle')}
            values={{
              from: (
                <bdi dir="ltr" className={NUM}>
                  {range.from}
                </bdi>
              ),
              to: (
                <bdi dir="ltr" className={NUM}>
                  {range.to}
                </bdi>
              ),
            }}
          />
        }
        icon={SHIPMENT_PATH.trashRestore}
        width="4xl"
        wrapTitle
        panelProps={{ 'data-deleted-shipments-dialog': 'true' }}
        footer={<DesignCancel onClick={() => setOpen(false)} label={t('common.close')} />}
      >
        {body}
      </DesignDialog>

      <ShipmentLogDialog target={logOf} onClose={() => setLogOf(null)} />
    </>
  );
};
