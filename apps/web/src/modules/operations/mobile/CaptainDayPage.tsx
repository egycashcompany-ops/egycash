// The captain's day, on a phone (Phase C).
//
// IDENTITY. The header names the captain from `day.captain`, which the SERVER resolved from the
// token — not from the client's own auth store and not from a route parameter. There is no
// captain id anywhere in this file, because there is none in the API: `my-day` takes a date and
// nothing else. That is the identity constraint made structural rather than remembered.
//
// CAPTAINCY IS NOT PERMISSION. Holding `operationsExecution.own` is what lets an employee OPEN
// this screen; being on the day's crew row is what makes him a captain TODAY. The two are
// answered separately — the route guard for the first, `isCaptainOnDay` for the second — because
// conflating them turns a grant into a job title.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { formatDate } from '../../../shared/lib/format';
import { useMyDay } from '../api/operations-queries';
import { CaptainShell } from './CaptainShell';
import { StopCard } from './StopCard';
import { captainDayState, dayProgress } from './day-view';

/** `?date=` empty means today, resolved by the server — the same contract the day board uses. */
export const resolveMyDayDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

export const CaptainDayPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp] = useSearchParams();
  const date = resolveMyDayDate(sp.get('date'));
  const query = useMyDay(date);

  const day = query.data;
  const shown = date ?? day?.date ?? null;
  const subtitle = shown === null ? undefined : formatDate(shown, locale);

  const body = ((): JSX.Element => {
    if (query.isLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      );
    }
    if (query.isError) {
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
    }
    if (day === undefined) return <EmptyState />;

    switch (captainDayState(day)) {
      // No operating day exists for this date at all. Distinct from "not a captain on it": one is
      // "the desk has not opened this day", the other is "it is open and you are not on it".
      case 'noDay':
        return (
          <EmptyState
            title={t('operations.mobile.noDay.title')}
            description={t('operations.mobile.noDay.body')}
          />
        );
      // Rostered by nobody today. NOT an error — an employee may legitimately hold the capability
      // and simply not be driving.
      case 'notCaptain':
        return (
          <EmptyState
            title={t('operations.mobile.notCaptain.title')}
            description={t('operations.mobile.notCaptain.body')}
          />
        );
      // Rostered, but dispatch has assigned nothing yet. The message must not read as "no duty".
      case 'noStops':
        return (
          <EmptyState
            title={t('operations.mobile.noStops.title')}
            description={t('operations.mobile.noStops.body')}
          />
        );
      default:
        return (
          <section aria-label={t('operations.mobile.routeTitle')} className="space-y-3">
            {/*
              RENDERED IN THE ORDER THE SERVER SENT. No sort, no filter, no renumbering — the
              sequence is established by `orderedCaptainRoute` and is what the execution lock is
              enforced against, so re-ordering here would put the screen and the API in
              disagreement about which stop is next.
            */}
            {day.stops.map((stop) => (
              <StopCard
                key={stop.assignmentId}
                stop={stop}
                href={`/operations/my-day/stops/${stop.assignmentId}${date === null ? '' : `?date=${date}`}`}
              />
            ))}
          </section>
        );
    }
  })();

  const progress = day === undefined ? null : dayProgress(day);

  return (
    <CaptainShell
      title={day?.captain.fullNameAr ?? t('operations.mobile.title')}
      {...(subtitle === undefined ? {} : { subtitle })}
    >
      {day !== undefined && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('operations.mobile.captainCode', { code: day.captain.code })}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-50">
                {t(
                  day.isCaptainOnDay
                    ? 'operations.mobile.onDuty'
                    : 'operations.mobile.offDuty',
                )}
              </p>
            </div>
            {progress !== null && progress.total > 0 && (
              <p className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
                {t('operations.mobile.progress', {
                  done: progress.done,
                  total: progress.total,
                })}
              </p>
            )}
          </div>
        </div>
      )}
      {body}
    </CaptainShell>
  );
};
