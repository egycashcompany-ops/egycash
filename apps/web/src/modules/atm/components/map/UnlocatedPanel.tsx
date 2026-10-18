// The unlocated screen's panel (docs/12-planning/atm-map-zones.md §8.8 `UnlocatedPanel`,
// `Unlocated.dc.html:66-131`): «تم تحديد موقع n من m» with its bar, the reason chips, the sync and
// link cards, the search and the list.
//
// THE LIST AGREES WITH «n من m». Both are the summary's scope: the selected branch's machines in the
// branches where the reader can locate (§6.4, DM-39). The page hands in exactly those rows.
import { type Locale, type AtmMapLocationSummaryDto, type AtmMapPointDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { formatNumber } from '../../../../shared/lib/format';
import { SearchIcon } from '../../../../shared/ui/icons';
import { type UnlocatedChip } from '../../lib/unlocated-view';
import { LinkResolutionCard } from './LinkResolutionCard';
import { ReasonChips } from './ReasonChips';
import { SyncCard } from './SyncCard';
import { UnlocatedRow, type UnlocatedRowActions } from './UnlocatedRow';

export const UnlocatedPanel = ({
  locale,
  branchId,
  summary,
  chips,
  selectedReasons,
  rows,
  anyRows,
  query,
  openId,
  branchNames,
  actions,
  onToggleReason,
  onQuery,
  onToggleRow,
}: {
  locale: Locale;
  /** The page's branch; null = every branch in reach («كل الفروع»). */
  branchId: string | null;
  summary: AtmMapLocationSummaryDto | undefined;
  chips: readonly { chip: UnlocatedChip; count: number }[];
  selectedReasons: readonly string[];
  /** The rows after the chips and the search. */
  rows: readonly AtmMapPointDto[];
  /** Whether any machine of the scope is unlocated or under review at all. */
  anyRows: boolean;
  query: string;
  openId: string | null;
  branchNames: ReadonlyMap<string, string>;
  actions: UnlocatedRowActions;
  onToggleReason: (chip: UnlocatedChip) => void;
  onQuery: (text: string) => void;
  onToggleRow: (machineId: string) => void;
}): JSX.Element => {
  const t = useT();
  const done = summary?.located;
  const total = summary?.totalActive;
  const pct =
    done === undefined || total === undefined || total === 0 ? 0 : Math.round((done * 100) / total);
  return (
    <div data-unlocated-panel="true" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[13px] text-slate-700 dark:text-slate-200">
          <span>
            {t('atm.map.unlocated.progress', {
              done: formatNumber(done, locale),
              total: formatNumber(total, locale),
            })}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
              style: 'percent',
            }).format(pct / 100)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t('atm.map.unlocated.progress', {
            done: formatNumber(done, locale),
            total: formatNumber(total, locale),
          })}
          className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        >
          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${String(pct)}%` }} />
        </div>
      </div>

      <ReasonChips
        chips={chips}
        selected={selectedReasons}
        locale={locale}
        onToggle={onToggleReason}
      />
      <SyncCard
        branchId={branchId}
        pending={summary?.pendingSync}
        lastSyncAt={summary?.lastSyncAt}
        locale={locale}
      />
      <LinkResolutionCard
        branchId={branchId}
        pending={summary?.shortLinksPending}
        locale={locale}
      />

      <label className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[13px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        <SearchIcon className="h-3.5 w-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('atm.map.unlocated.search')}
          aria-label={t('atm.map.unlocated.search')}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-slate-100"
        />
      </label>

      <div
        data-unlocated-list="true"
        className="flex flex-col overflow-hidden rounded-[10px] border border-slate-100 dark:border-slate-800"
      >
        {rows.map((point) => (
          <UnlocatedRow
            key={point.machineId}
            point={point}
            branchName={branchNames.get(point.branchId) ?? ''}
            open={openId === point.machineId}
            locale={locale}
            actions={actions}
            onToggle={onToggleRow}
          />
        ))}
        {!anyRows && summary !== undefined && (
          <p className="px-3 py-6 text-center text-sm text-emerald-700 dark:text-emerald-300">
            {t('atm.map.unlocated.empty')}
          </p>
        )}
        {anyRows && rows.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('atm.map.empty.noMatch')}
          </p>
        )}
      </div>
    </div>
  );
};
