// One stop, in full — what the captain reads before he acts on it.
//
// THE STOP IS FOUND IN THE DAY, NOT FETCHED ALONE. There is no per-stop endpoint and there should
// not be: the sequential lock is a property of the ROUTE, so `progress` only means anything
// relative to the other stops. Reading the same `my-day` query the list reads means the detail and
// the list can never disagree about which stop is current — and it costs nothing, because the
// query is already in the cache.
//
// A LOCKED STOP IS READABLE. The captain needs to see what is coming; what he does not get is a
// way to act on it. The refusal is stated in words, next to the reason, rather than by hiding the
// screen — a stop that silently offers nothing is indistinguishable from one that is broken.
import { useParams, useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { LockIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useMyDay } from '../api/operations-queries';
import { ShipmentTypeBadge } from '../components/ShipmentBadges';
import { CaptainShell } from './CaptainShell';
import { StopLocation } from './StopLocation';
import { resolveMyDayDate } from './CaptainDayPage';

export const StopDetailPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { assignmentId = '' } = useParams<{ assignmentId: string }>();
  const [sp] = useSearchParams();
  const date = resolveMyDayDate(sp.get('date'));
  const query = useMyDay(date);

  const stop = query.data?.stops.find((row) => row.assignmentId === assignmentId) ?? null;

  const body = ((): JSX.Element => {
    if (query.isLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      );
    }
    if (query.isError) {
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    // The id is not on today's route. A stale link, a day that moved on, or somebody else's stop —
    // all of which the server would refuse anyway, and none of which is worth guessing between.
    if (stop === null) {
      return (
        <EmptyState
          title={t('operations.mobile.stopNotFound.title')}
          description={t('operations.mobile.stopNotFound.body')}
        />
      );
    }

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {t('operations.mobile.stopNumber', { sequence: stop.sequence })}
            </h2>
            <ShipmentTypeBadge shipmentType={stop.shipmentType} />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {t(`operations.mobile.leg.${stop.leg}`)}
            </span>
          </div>
          {stop.referenceNumber !== null && (
            <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {stop.referenceNumber}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">
                {t('operations.mobile.executionLabel')}
              </dt>
              <dd className="font-medium text-slate-900 dark:text-slate-50">
                {t(`operations.mobile.execution.${stop.executionStatus}`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">
                {t('operations.common.status')}
              </dt>
              <dd className="font-medium text-slate-900 dark:text-slate-50">
                {t(`operations.shipment.status.${stop.status}`)}
              </dd>
            </div>
          </dl>
          {stop.packaging !== null && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('operations.vault.packageCounts', {
                bags: stop.packaging.bags,
                cartons: stop.packaging.cartons,
                boxes: stop.packaging.boxes,
              })}
            </p>
          )}
        </section>

        {/*
          The leg as a journey, in reading order: collect, then deliver. The arrow is decorative —
          the two panels are already labelled, so nothing depends on reading a glyph.
        */}
        <StopLocation label={t('operations.mobile.pickupFrom')} place={stop.pickup} />
        <p className="text-center text-2xl leading-none text-slate-300 dark:text-slate-600" aria-hidden="true">
          ↓
        </p>
        <StopLocation label={t('operations.mobile.deliverTo')} place={stop.delivery} />

        {stop.progress === 'locked' && (
          <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('operations.mobile.lockedReason')}
          </p>
        )}
      </div>
    );
  })();

  return (
    <CaptainShell
      title={t('operations.mobile.stopTitle')}
      {...(query.data === undefined
        ? {}
        : { subtitle: formatDate(date ?? query.data.date, locale) })}
      backTo={`/operations/my-day${date === null ? '' : `?date=${date}`}`}
    >
      {body}
    </CaptainShell>
  );
};
