// The department tiles at the top of the org chart (P-ORG-3 §2.1): one per company department, the
// picked one drawn as the crew card draws a picked department. A single choice, so each tile is a
// button that says it is pressed — the project's way for a one-of-many pick.
import { foldOrgUnitName, type Locale, type OrgChartDepartmentDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { cn } from '../../../../shared/lib/cn';
import { localized } from '../../../../shared/lib/format';

/** Over this many tiles, a search box narrows them (as the crew card's does). */
const SEARCH_FROM = 8;

const Count = ({ children }: { children: string }): JSX.Element => (
  <span className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
    {children}
  </span>
);

export const DepartmentTiles = ({
  departments,
  jobCounts,
  selectedKey,
  onSelect,
  search,
  onSearch,
  locale,
}: {
  departments: readonly OrgChartDepartmentDto[];
  jobCounts: ReadonlyMap<string, number>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  search: string;
  onSearch: (next: string) => void;
  locale: Locale;
}): JSX.Element => {
  const t = useT();
  const folded = foldOrgUnitName(search);
  const shown =
    folded === ''
      ? departments
      : departments.filter(
          (d) =>
            foldOrgUnitName(d.name.ar).includes(folded) ||
            foldOrgUnitName(d.name.en).includes(folded),
        );

  return (
    <div className="mb-4 space-y-3">
      {departments.length >= SEARCH_FROM && (
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t('organization.chart.search')}
          debounceMs={0}
          className="sm:max-w-sm"
        />
      )}
      {shown.length === 0 ? (
        <p className="py-2 text-sm text-slate-500 dark:text-slate-400">{t('common.noResults')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((department) => {
            const picked = department.key === selectedKey;
            const sections = department.sections.length;
            return (
              <li key={department.key} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={picked}
                  onClick={() => onSelect(department.key)}
                  className={cn(
                    'flex h-full w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors',
                    picked
                      ? 'border-brand-400 bg-brand-50/70 dark:border-brand-600 dark:bg-brand-950/50'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {localized(department.name, locale)}
                    </span>
                    {!department.editable && department.departmentCatalogId === null && (
                      <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
                        {t('organization.chart.notLinked')}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <Count>
                      {sections === 0
                        ? t('organization.chart.noSections')
                        : t('organization.chart.sectionsCount', { n: sections })}
                    </Count>
                    <Count>
                      {t('organization.chart.jobsCount', { n: jobCounts.get(department.key) ?? 0 })}
                    </Count>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
