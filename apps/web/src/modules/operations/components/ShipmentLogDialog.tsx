// «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» — one shipment's story, opened from «السجل» in its
// row on the day board and on the history («السجل … على الشاشتين»), and from a deleted shipment.
//
// OLDEST FIRST, as the server sends it: a shipment's log is short — booked, perhaps edited, crewed,
// carried, confirmed — and reads as a story from the top, the way the desk tells it. The newest act
// is the last line, beside the close button; when the server left the oldest out (`truncated`),
// the note saying so stands at the top, where the missing lines would be.
//
// The Fleet dialogs' look (`DesignDialog`, as «عملات أخرى»): each entry a tile in its kind's
// colour on a rail, its sentence, who («غير مسجَّل» when no name was kept), when (the Cairo day
// and hour, Latin digits as the board writes figures), and — for a booking, an edit, a crew or a
// vault entry —
// what it set, field by field, old → new («عُدّلت الشحنة» shows exactly what the edit changed:
// «اللى يتعدل يظهر ف السجل»).
import { Fragment, type ReactNode } from 'react';
import {
  OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES,
  type OperationsShipmentLogDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { Spinner } from '../../../shared/ui/Spinner';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { useOperationsShipmentLog } from '../api/operations-queries';
import {
  cairoStamp,
  logFieldLabel,
  logKindKey,
  logKindLook,
  logValue,
  showsOldValues,
  type LogTone,
} from '../lib/shipment-log';
import { SHIPMENT_PATH } from './shipment-icons';

/** Each kind's tile — a soft square of its colour, as the board's figure pills draw theirs. */
const TILE: Record<LogTone, string> = {
  brand: 'bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300',
  blue: 'bg-blue-500/15 text-blue-600 ring-blue-500/30 dark:text-[#58a8e8]',
  red: 'bg-red-500/15 text-red-600 ring-red-500/30 dark:text-[#e86870]',
  emerald: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400',
  rose: 'bg-rose-500/15 text-rose-600 ring-rose-500/30 dark:text-rose-300',
  sky: 'bg-sky-500/15 text-sky-600 ring-sky-500/30 dark:text-sky-400',
  violet: 'bg-violet-500/15 text-violet-600 ring-violet-500/30 dark:text-violet-300',
  slate: 'bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300',
  cyan: 'bg-cyan-500/15 text-cyan-700 ring-cyan-500/30 dark:text-cyan-300',
  amber: 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300',
  teal: 'bg-teal-500/15 text-teal-600 ring-teal-500/30 dark:text-teal-300',
  indigo: 'bg-indigo-500/15 text-indigo-600 ring-indigo-500/30 dark:text-indigo-300',
};

/** «→» in the reading direction: old on the side a line starts, new where it ends. */
const Becomes = (): JSX.Element => {
  const t = useT();
  return (
    <>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 self-center text-slate-400 rtl:-scale-x-100 dark:text-slate-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path d="M5 12h14m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{t('operations.shipment.log.becomes')}</span>
    </>
  );
};

/** A centred line in the timeline's place — while it loads, when it failed, when it is empty. */
const Notice = ({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'alert';
}): JSX.Element => (
  <div
    role={tone === 'alert' ? 'alert' : 'status'}
    className={cn(
      'flex flex-col items-center gap-3 py-10 text-center text-sm font-bold',
      tone === 'alert' ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400',
    )}
  >
    {children}
  </div>
);

/**
 * The timeline itself, or the line in its place — apart from the dialog so it can be rendered (and
 * pinned) without the portal or the query.
 */
export const ShipmentLogTimeline = ({
  log,
  loading,
  failed,
  onRetry,
}: {
  log: OperationsShipmentLogDto | undefined;
  loading: boolean;
  /** The read failed and nothing is on screen — not an empty log, which would be a claim. */
  failed: boolean;
  onRetry: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);

  if (log === undefined) {
    if (failed) {
      return (
        <Notice tone="alert">
          <p>{t('operations.shipment.log.loadFailed')}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 dark:border-white/[0.12] dark:text-slate-200 dark:hover:bg-white/[0.06]"
          >
            {t('common.retry')}
          </button>
        </Notice>
      );
    }
    return (
      <Notice>
        {loading && <Spinner className="h-5 w-5" />}
        <p>{t('common.loading')}</p>
      </Notice>
    );
  }
  if (log.entries.length === 0) {
    return (
      <Notice>
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', TILE.slate)}>
          <BoardIcon d={[...SHIPMENT_PATH.history]} className="h-6 w-6" />
        </span>
        <p>{t('operations.shipment.log.empty')}</p>
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      {log.truncated && (
        <p
          data-shipment-log-truncated="true"
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <BoardIcon d={[...PATH.warn]} className="mt-px h-4 w-4 shrink-0" />
          {t('operations.shipment.log.truncated', {
            max: formatNumber(OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES, locale),
          })}
        </p>
      )}
      <ol data-shipment-log="true" className="relative">
        {log.entries.map((entry, index) => {
          const look = logKindLook(entry.kind);
          const stamp = cairoStamp(entry.at);
          const withOld = showsOldValues(entry);
          return (
            <li
              key={entry.id}
              data-log-entry={entry.kind}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {/* The rail from this tile down to the next one. */}
              {index < log.entries.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 start-[1.125rem] top-10 w-px bg-slate-200 dark:bg-[#2b3b6b]"
                />
              )}
              <span
                className={cn(
                  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
                  TILE[look.tone],
                )}
              >
                <BoardIcon d={[...look.icon]} className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-[15px] font-black text-slate-900 dark:text-white">
                    {t(logKindKey(entry.kind))}
                  </p>
                  {entry.leg !== null && (
                    <span
                      data-log-leg={entry.leg}
                      className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:border-white/[0.12] dark:text-slate-300"
                    >
                      {t(`operations.shipment.log.leg.${entry.leg}`)}
                    </span>
                  )}
                  {/* When — the Cairo day and hour, one line, Latin digits. */}
                  <time
                    dateTime={entry.at}
                    dir="ltr"
                    data-log-at="true"
                    className={cn(
                      'ms-auto whitespace-nowrap text-xs font-bold text-slate-500 dark:text-slate-400',
                      NUM,
                    )}
                  >
                    {stamp.day}{' '}
                    <span className="text-slate-400 dark:text-slate-500">{stamp.time}</span>
                  </time>
                </div>
                {/* Who — the name the audit kept at the time. With none, «غير مسجَّل», as the
                    platform's audit screen words a row with no actor snapshot: a null name is a
                    lookup that found nobody, or a row with no actor, never proof that nobody acted —
                    so the log does not credit «النظام» with what a person may have done. */}
                <p
                  data-log-actor="true"
                  className={cn(
                    'mt-0.5 flex items-center gap-1.5 text-xs font-bold',
                    entry.actorName === null
                      ? 'text-slate-400 dark:text-slate-500'
                      : 'text-slate-600 dark:text-slate-300',
                  )}
                >
                  <BoardIcon
                    d={[...SHIPMENT_PATH.person]}
                    className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500"
                  />
                  {entry.actorName ?? t('operations.shipment.log.actorUnknown')}
                </p>
                {entry.changes.length > 0 && (
                  <dl
                    data-log-changes="true"
                    // Label beside value from a tablet up; on a phone the label sits over its value,
                    // which then has the card's whole width rather than breaking «(BA-3)» in two.
                    className="mt-2 grid grid-cols-1 gap-x-3 border-t border-slate-200 pt-2 text-[13px] sm:grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] sm:gap-y-1 dark:border-white/[0.06]"
                  >
                    {entry.changes.map((change) => (
                      <Fragment key={change.field}>
                        <dt className="font-bold text-slate-500 max-sm:mt-1.5 max-sm:text-[11px] max-sm:first:mt-0 dark:text-slate-400">
                          {logFieldLabel(change.field, t)}
                        </dt>
                        <dd
                          data-log-field={change.field}
                          className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"
                        >
                          {withOld && (
                            <>
                              <bdi
                                data-log-old="true"
                                className="text-slate-400 line-through decoration-slate-400/60 dark:text-slate-500"
                              >
                                {logValue(change.field, change.old, t)}
                              </bdi>
                              <Becomes />
                            </>
                          )}
                          <bdi
                            data-log-new="true"
                            className="font-bold text-slate-900 dark:text-white"
                          >
                            {logValue(change.field, change.new, t)}
                          </bdi>
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/** What the log is about: the shipment's id, and the line under the title that names it. */
export interface ShipmentLogTarget {
  id: string;
  /** «الأهلي · المعادي ← الدقي · 2026-11-11» (`shipmentCaption`). */
  caption: string;
}

/** The log in the Fleet dialog. Asked for only while open; `target` null = closed. */
export const ShipmentLogDialog = ({
  target,
  onClose,
}: {
  target: ShipmentLogTarget | null;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const log = useOperationsShipmentLog(target?.id ?? null);
  return (
    <DesignDialog
      open={target !== null}
      onClose={onClose}
      title={t('operations.shipment.log.title')}
      subtitle={target?.caption}
      icon={SHIPMENT_PATH.history}
      width="3xl"
      wrapTitle
      panelProps={{ 'data-shipment-log-dialog': target?.id ?? '' }}
      footer={<DesignCancel onClick={onClose} label={t('common.close')} />}
    >
      <ShipmentLogTimeline
        log={log.data}
        loading={log.isFetching}
        failed={log.isError}
        onRetry={() => void log.refetch()}
      />
    </DesignDialog>
  );
};
