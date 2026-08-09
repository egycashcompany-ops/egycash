// The asset's business history (design §2.3) — rendered from `it_asset_events`, never from the
// audit trail. That distinction is the point of ADR-021 and it is visible here: this list is a
// chronology of what happened to the ASSET, in business language, for anyone who can view it.
//
// Entries are handled BY TYPE and never by probing `metadata` keys. A renderer that asked "does
// this row have a `toEmployeeId`?" would break silently the day a type stopped carrying one; a
// switch on `type` breaks loudly at the compiler instead.
import { type ItAssetHistoryEntryDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { ClipboardIcon } from '../../../shared/ui/icons';
import { formatDateTime } from '../../../shared/lib/format';

const TONE: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = {
  registered: 'neutral',
  updated: 'neutral',
  assigned: 'info',
  returned: 'success',
  transferred: 'brand',
  maintenanceStarted: 'warning',
  maintenanceCompleted: 'success',
  warrantyUpdated: 'neutral',
  disposed: 'danger',
};

/** A metadata value rendered as a short string, or null when there is nothing to show. */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export const AssetHistoryList = ({
  entries,
  isPending,
  isError,
  error,
  onRetry,
}: {
  entries: ItAssetHistoryEntryDto[];
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
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState error={error} {...(onRetry === undefined ? {} : { onRetry })} />;
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        title={t('it.custody.historyEmptyTitle')}
        description={t('it.custody.historyEmptyBody')}
      />
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        // Condition notes are the fact most often looked for after the fact, so they are surfaced
        // on the row rather than hidden behind an expander.
        const condition =
          text(entry.metadata.conditionOnReturn) ?? text(entry.metadata.conditionOnIssue);
        return (
          <li
            key={entry.id}
            className="flex gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
          >
            <span className="mt-0.5 shrink-0">
              <Badge tone={TONE[entry.type] ?? 'neutral'}>
                {t(`it.custody.event.${entry.type}`)}
              </Badge>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800 dark:text-slate-100">
                {formatDateTime(entry.at, locale)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {entry.actorName === ''
                  ? t('it.custody.systemActor')
                  : `${t('it.custody.by')} ${entry.actorName}`}
              </p>
              {condition !== null && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {t('it.custody.conditionNoted')}: {condition}
                </p>
              )}
              {entry.notes !== null && entry.notes !== '' && (
                <p className="mt-1 flex items-start gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <ClipboardIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{entry.notes}</span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
