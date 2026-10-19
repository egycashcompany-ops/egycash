// «مزامنة المواقع من سجل الماكينات» (docs/12-planning/atm-map-zones.md DM-38, §8.8 `SyncCard`): the
// card that creates the pins from the register's two location columns. One call (§8.10); it never
// moves a pin a person set or approved unless the register's text changed (DM-2), and the toast
// says what it found.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatDateTime, formatNumber } from '../../../../shared/lib/format';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useSyncLocations } from '../../api/map-queries';
import { syncDoneToast } from '../../lib/map-toasts';

export const SyncCard = ({
  branchId,
  pending,
  lastSyncAt,
  locale,
}: {
  /** The page's branch; null = every branch the caller may locate in. */
  branchId: string | null;
  pending: number | undefined;
  lastSyncAt: string | null | undefined;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const sync = useSyncLocations();
  return (
    <section
      data-sync-card="true"
      className="flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('atm.map.sync.title')}
      </h2>
      <p className="text-xs leading-[1.7] text-slate-600 dark:text-slate-300">
        {t('atm.map.sync.body')}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span>{t('atm.map.sync.pending', { count: formatNumber(pending, locale) })}</span>
        {lastSyncAt !== undefined && lastSyncAt !== null && (
          <span>{t('atm.map.sync.last', { at: formatDateTime(lastSyncAt, locale) })}</span>
        )}
      </div>
      <Button
        size="sm"
        className="self-start"
        loading={sync.isPending}
        onClick={() =>
          sync.mutate(branchId === null ? {} : { branchId }, {
            onSuccess: (result) => {
              const words = syncDoneToast(result, t, locale);
              toast.success(words.title, words.description);
            },
            onError: (error) => toast.error(errorMessage(error, locale)),
          })
        }
      >
        {t('atm.map.sync.start')}
      </Button>
    </section>
  );
};
