// The ticket's stream (design §2.6): history AND conversation, one list, one source.
//
// Entries are handled BY TYPE and by the TYPED columns the model carries (`fromStatus`/`toStatus`,
// `body`/`visibility`) — never by probing `metadata`. A renderer that asked "does this row have a
// `technicianUserId`?" would break silently the day a type stopped carrying one.
//
// Internal comments reach this component only for callers the SERVER let read them (FR-7). The
// badge below is a signal to the technician that a note is not public — it is not the mechanism
// that keeps it private, and it must never be mistaken for one.
import { type ItTicketEventDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { formatDateTime } from '../../../shared/lib/format';
import { CommentAttachments } from './TicketAttachments';

const TONE: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  opened: 'info',
  assigned: 'brand',
  statusChanged: 'neutral',
  priorityChanged: 'neutral',
  commented: 'success',
  slaBreached: 'danger',
};

export const TicketStream = ({
  entries,
  isPending,
  isError,
  error,
  onRetry,
}: {
  entries: ItTicketEventDto[];
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  if (isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} {...(onRetry === undefined ? {} : { onRetry })} />;
  if (entries.length === 0) {
    return (
      <EmptyState
        title={t('it.tickets.streamEmptyTitle')}
        description={t('it.tickets.streamEmptyBody')}
      />
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const internal = entry.visibility === 'internal';
        return (
          <li
            key={entry.id}
            className={`rounded-lg border p-3 ${
              internal
                ? 'border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[entry.type] ?? 'neutral'}>
                {t(`it.tickets.event.${entry.type}`)}
              </Badge>
              {/* Typed columns, not metadata probing — this is why they are columns. */}
              {entry.type === 'statusChanged' && entry.toStatus !== null && (
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {entry.fromStatus === null
                    ? t(`it.tickets.status.${entry.toStatus}`)
                    : `${t(`it.tickets.status.${entry.fromStatus}`)} → ${t(`it.tickets.status.${entry.toStatus}`)}`}
                </span>
              )}
              {internal && <Badge tone="warning">{t('it.tickets.internalNote')}</Badge>}
              <span className="ms-auto text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {formatDateTime(entry.at, locale)}
              </span>
            </div>
            {entry.body !== null && entry.body !== '' && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                {entry.body}
              </p>
            )}
            {entry.notes !== null && entry.notes !== '' && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                {entry.notes}
              </p>
            )}
            {/* Only a comment can carry files; a status change has nothing to attach. */}
            {entry.type === 'commented' && <CommentAttachments commentId={entry.id} />}
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {entry.actorName === ''
                ? t('it.custody.systemActor')
                : `${t('it.custody.by')} ${entry.actorName}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
};
