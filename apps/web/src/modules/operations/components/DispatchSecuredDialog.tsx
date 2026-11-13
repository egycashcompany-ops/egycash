// «صرف من الخزينة» — «صرف الخزينة»'s release: the محصنات leave the vault with their delivery crew
// (`POST /operations/secured/dispatch`, `operationsVault.dispatch`). One row from its own act, or
// the rows ticked on the board.
//
// ONE CALL PER VEHICLE. The endpoint takes ONE crew row and the shipments it carries, each assigned
// to that row (legacy `/deliver_mohsana` posted one tashghela row and its load), and does them in one
// transaction. Ticked rows of two vehicles are therefore two loads (`dispatchLoads`), each said
// here before the click — the vehicle, its captain(s), how many, and how much in each currency —
// and sent one after the other. A load refused is said by its vehicle and stays ticked on the board
// to be tried again; the loads before and after it go out as they would have alone (each vehicle's
// release is its own transaction, so a refusal never leaves one vehicle half released).
//
// What happens is said before the click, and the way back says «رجوع». One press sends once.
import { Fragment, useRef, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type Locale,
  type OperationsCurrencyDto,
  type OperationsSecuredDispatchRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useDispatchSecured,
  useOperationsBanks,
  useOperationsCurrencies,
} from '../api/operations-queries';
import { orderedBoardTotals } from '../lib/day-board';
import { dispatchLoads } from '../lib/secured-dispatch';
import { shipmentCaption } from '../lib/shipment-log';
import { SHIPMENT_PATH } from './shipment-icons';

/**
 * `rows` null = closed. The page hands in the rows to release — those it may release
 * (`offersDispatch`); a row with no delivery crew is not among them.
 */
export const DispatchSecuredDialog = ({
  rows,
  onClose,
  onDispatched,
}: {
  rows: readonly OperationsSecuredDispatchRowDto[] | null;
  onClose: () => void;
  /** The ids that left the vault — the page unticks them. */
  onDispatched: (ids: readonly string[]) => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const dispatch = useDispatchSecured();
  // The board's own catalog requests — the same keys, so these are read from its cache.
  const banks = useOperationsBanks(
    { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' },
    rows !== null,
  );
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE }, rows !== null);
  const sending = useRef(false);
  const [waiting, setWaiting] = useState(false);

  if (rows === null) return null;
  const loads = dispatchLoads(rows);
  const count = loads.reduce((sum, load) => sum + load.rows.length, 0);
  const busy = waiting || dispatch.isPending;

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);

  const send = async (): Promise<void> => {
    if (sending.current || count === 0) return;
    sending.current = true;
    setWaiting(true);
    const out: string[] = [];
    try {
      // One vehicle after another — each its own transaction on the server.
      for (const load of loads) {
        const ids = load.rows.map((row) => row.id);
        try {
          await dispatch.mutateAsync({ crewAssignmentId: load.crewAssignmentId, shipmentIds: ids });
          out.push(...ids);
        } catch (error) {
          toast.error(
            t('operations.secured.dispatch.loadFailed', {
              vehicle: load.vehicleCode ?? '…',
              reason: errorMessage(error, locale),
            }),
          );
        }
      }
    } finally {
      sending.current = false;
      setWaiting(false);
    }
    if (out.length > 0) {
      toast.success(
        t('operations.secured.dispatch.done', { count: formatNumber(out.length, locale) }),
      );
      onDispatched(out);
    }
    onClose();
  };

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t('operations.secured.dispatch.action')}
      subtitle={t('operations.secured.dispatch.loadCount', { count: formatNumber(count, locale) })}
      icon={PATH.truck}
      width="2xl"
      wrapTitle
      panelProps={{ 'data-dispatch-secured': String(count) }}
      footer={
        <>
          <DesignSave
            onClick={() => void send()}
            busy={busy}
            disabled={count === 0}
            label={t('operations.secured.dispatch.release', { count: formatNumber(count, locale) })}
            data-dispatch-secured-save="true"
          />
          <DesignCancel onClick={onClose} label={t('operations.secured.dispatch.back')} />
        </>
      }
    >
      {/* What the click does — before it is made. */}
      <div
        data-dispatch-secured-body="true"
        className="flex items-start gap-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-[15px] font-semibold leading-7 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/[0.08] dark:text-violet-100"
      >
        <BoardIcon
          d={PATH.truck}
          className="mt-1.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300"
        />
        <span>{t('operations.secured.dispatch.body')}</span>
      </div>

      {/* Each vehicle's load: who takes it, how many, how much — and which shipments. */}
      {loads.map((load) => (
        <section
          key={load.crewAssignmentId}
          data-dispatch-load={load.crewAssignmentId}
          className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-[15px] font-black text-slate-900 dark:text-white">
              <BoardIcon
                d={PATH.truck}
                className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
              />
              {t('operations.secured.dispatch.vehicleLoad', {
                vehicle: load.vehicleCode ?? '…',
              })}
            </span>
            {load.captainNames.length > 0 && (
              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-600 dark:text-slate-300">
                <BoardIcon d={SHIPMENT_PATH.person} className="h-3.5 w-3.5" />
                {load.captainNames.join(' · ')}
              </span>
            )}
            <span
              data-dispatch-load-count={load.rows.length}
              className="ms-auto rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-black text-violet-700 dark:text-violet-200"
            >
              {t('operations.secured.dispatch.loadCount', {
                count: formatNumber(load.rows.length, locale),
              })}
            </span>
          </header>
          {/* How much leaves in each currency, in the catalog's order — as the board's figures. */}
          <div className="flex flex-wrap gap-1.5">
            {orderedBoardTotals(load.rows, currencyOf).map((total) => (
              <span
                key={total.currencyId}
                className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm font-bold dark:border-[#2b3b6b] dark:bg-[#111827]"
              >
                <span dir="ltr" className={cn(NUM, 'text-slate-900 dark:text-white')}>
                  {formatAmount(total.amount, locale)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {currencyOf(total.currencyId)?.name ?? '…'}
                </span>
              </span>
            ))}
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm font-medium text-slate-700 dark:text-slate-200">
            {load.rows.map((row) => (
              // Wrapped between its parts, never inside one: a caption cut short on a phone cut
              // its date in half, and one wrapped anywhere broke the date at its hyphens.
              <li key={row.id} data-dispatch-load-row={row.id} className="leading-snug">
                {shipmentCaption(row, bankNameOf, t)
                  .split(' · ')
                  .map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 && ' · '}
                      <span className="whitespace-nowrap">{part}</span>
                    </Fragment>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </DesignDialog>
  );
};
