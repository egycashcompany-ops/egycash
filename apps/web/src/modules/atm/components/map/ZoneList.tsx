// «القطاعات (n)» in view mode (docs/12-planning/atm-map-zones.md §8.8 `ZoneList`): 48 px rows — a
// swatch, the name, the count in words and a chevron — ten to a page. A row's hover raises the
// zone's fill on the map; a click zooms to it and opens its details. With «كل الفروع» the rows sit
// under their branch's heading.
import { useEffect, useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { foldIncludes } from '../../../../shared/lib/fold';
import { NumberedPager } from '../../../../shared/ui/NumberedPager';
import { SearchIcon } from '../../../../shared/ui/icons';
import { machineCountText } from '../../lib/map-count-text';

export interface ZoneRow {
  id: string;
  branchId: string;
  name: string;
  color: string;
  /** Primary membership over the visible points (§6.4). */
  count: number;
}

export const ZONES_PER_PAGE = 10;

export const ZoneList = ({
  rows,
  branchNames,
  locale,
  onHover,
  onOpen,
}: {
  rows: readonly ZoneRow[];
  /** Branch headings, with «كل الفروع»; null for one branch. */
  branchNames: ReadonlyMap<string, string> | null;
  locale: Locale;
  onHover: (zoneId: string | null) => void;
  onOpen: (zoneId: string) => void;
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const matching = useMemo(
    () => (query.trim() === '' ? rows : rows.filter((row) => foldIncludes(row.name, query))),
    [rows, query],
  );
  const pages = Math.max(1, Math.ceil(matching.length / ZONES_PER_PAGE));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const shown = matching.slice((page - 1) * ZONES_PER_PAGE, page * ZONES_PER_PAGE);

  const groups: { branchId: string; rows: ZoneRow[] }[] = [];
  for (const row of shown) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.branchId === row.branchId) last.rows.push(row);
    else groups.push({ branchId: row.branchId, rows: [row] });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[13px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
        <SearchIcon className="h-3.5 w-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t('atm.map.panel.zonesSearch')}
          aria-label={t('atm.map.panel.zonesSearch')}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-slate-100"
        />
      </label>
      <div
        data-zone-list="true"
        className="flex flex-col overflow-hidden rounded-[10px] border border-slate-100 dark:border-slate-800"
      >
        {groups.map((group) => (
          <div key={group.branchId}>
            {branchNames !== null && (
              <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {branchNames.get(group.branchId) ?? ''}
              </div>
            )}
            {group.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-zone-row={row.id}
                onMouseEnter={() => onHover(row.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(row.id)}
                onBlur={() => onHover(null)}
                onClick={() => onOpen(row.id)}
                className="flex h-12 w-full items-center gap-2.5 border-b border-slate-100 bg-white px-3 text-start text-sm text-slate-900 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: row.color,
                    boxShadow: `0 0 0 2px #fff, 0 0 0 3px ${row.color}`,
                  }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {machineCountText(row.count, t, locale)}
                </span>
                <span aria-hidden="true" className="text-slate-400 rtl:-scale-x-100">
                  ›
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {matching.length > ZONES_PER_PAGE && (
        <NumberedPager
          mark="zone-pager"
          meta={{ page, pageSize: ZONES_PER_PAGE, totalItems: matching.length, totalPages: pages }}
          onPageChange={setPage}
        />
      )}
    </div>
  );
};
