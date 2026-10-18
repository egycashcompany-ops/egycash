// The map's filter bar (docs/12-planning/atm-map-zones.md §8.8 `MapFilters`): «البنك», «المنطقة»,
// «القطاع», «الحالة», «الموقع», the fly-to search and the reset — on the vehicles registry's dark
// bar, each control in its icon frame, as `MachinesPage` draws it.
//
// THE PAGE OWNS THE ADDRESS BAR. It declares `REMEMBERED_FILTERS` and reads every param itself (the
// remembered-filters census reads the page's own source, §7.5); this bar receives the values and
// a `patch` callback, and never touches `URLSearchParams`.
//
// The search is not a filter: Enter flies to the machine and opens its popup, and a machine that
// has no point says so instead (§8.8).
import { useEffect, useState } from 'react';
import {
  ATM_BANK_CODES,
  ATM_BANK_NAMES,
  ATM_MAP_STATUS_FILTERS,
  joinAtmNameList,
  type AtmMapStatusFilter,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { FilterBar, FilterResetStyleContext } from '../../../../shared/ui/FilterBar';
import { FilterWithIcon } from '../../../../shared/ui/FilterWithIcon';
import { Input } from '../../../../shared/ui/form';
import { MultiSelect, type MultiSelectOption } from '../../../../shared/ui/MultiSelect';
import { StrokeIcon } from '../../../../shared/ui/StrokeIcon';
import { DARK_FILTER_BAR } from '../../../../shared/ui/dark-filter-bar';
import { MACHINE_ICON } from '../MachineFigures';
import {
  BANK_NONE,
  MAP_LOCATION_FILTERS,
  ZONE_MULTI,
  ZONE_NONE,
  type MapFilters as Filters,
  type MapLocationFilter,
} from '../../lib/map-filters';
import { MAP_ICON } from './map-icons';

/** The machines page's reset: red, once a filter is set. */
const RESET_LIKE_MACHINES = { tone: 'red', always: false } as const;

export type MapFilterPatch = Partial<
  Record<'banks' | 'areas' | 'zones' | 'status' | 'loc' | 'q', string | null>
>;

const LOCATION_LABEL: Record<MapLocationFilter, string> = {
  all: 'atm.map.filters.all',
  located: 'atm.map.location.located',
  review: 'atm.map.location.review',
};

/** A single-answer filter in the bar's own box: the question, then the answer (the mockup). */
const SingleFilter = ({
  icon,
  tone,
  label,
  value,
  options,
  onChange,
  className,
}: {
  icon: readonly string[];
  tone: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}): JSX.Element => (
  <label
    className={cn(
      'flex h-9 min-w-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 pe-1 ps-2 text-xs text-slate-600 dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-300',
      className,
    )}
  >
    <StrokeIcon d={icon} className={cn('h-3.5 w-3.5 shrink-0', tone)} />
    <span className="shrink-0">{label}</span>
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-0 pe-6 ps-1 text-sm font-medium text-slate-900 focus:ring-0 dark:bg-[#080C14] dark:text-slate-100"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

export const MapFilters = ({
  filters,
  locale,
  areas,
  zoneOptions,
  patch,
  onSearch,
}: {
  filters: Filters;
  locale: Locale;
  /** The areas the branch's machines carry. */
  areas: readonly string[];
  /** The zones on offer (with «كل الفروع», labelled "name — branch"). */
  zoneOptions: readonly MultiSelectOption[];
  patch: (updates: MapFilterPatch) => void;
  /** Enter in the search box: fly to the machine it names. */
  onSearch: (text: string) => void;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState(filters.q);
  // A cleared or restored `q` replaces what is in the box.
  useEffect(() => setText(filters.q), [filters.q]);

  const bankOptions: MultiSelectOption[] = [
    ...ATM_BANK_CODES.map((code) => ({
      value: code,
      label: ATM_BANK_NAMES[code][locale],
      shortLabel: code,
    })),
    { value: BANK_NONE, label: t('atm.map.filters.bankNone') },
  ];
  const zones: MultiSelectOption[] = [
    ...zoneOptions,
    { value: ZONE_NONE, label: t('atm.map.filters.zoneNone') },
    { value: ZONE_MULTI, label: t('atm.map.filters.zoneMulti') },
  ];
  const filtered =
    filters.banks.length > 0 ||
    filters.areas.length > 0 ||
    filters.zones.length > 0 ||
    filters.status !== 'active' ||
    filters.loc !== 'all' ||
    filters.q.trim() !== '';

  return (
    <div
      role="search"
      data-map-filters="true"
      className={cn(DARK_FILTER_BAR, 'mb-4', '[&_[role=listbox]]:animate-menu-in')}
    >
      <FilterResetStyleContext.Provider value={RESET_LIKE_MACHINES}>
        <FilterBar
          hasActiveFilters={filtered}
          onClear={() => {
            setText('');
            patch({ banks: null, areas: null, zones: null, status: null, loc: null, q: null });
          }}
        >
          <FilterWithIcon
            icon={MACHINE_ICON.bank}
            tone="text-violet-600 dark:text-violet-300"
            className="w-36 shrink-0"
          >
            <MultiSelect
              clearable
              className="w-full"
              fullWidth
              density="tight"
              showSelectedValues
              chips
              label={t('atm.map.filters.bank')}
              options={bankOptions}
              value={filters.banks}
              onChange={(next) =>
                patch({ banks: next.length === 0 ? null : joinAtmNameList(next) })
              }
            />
          </FilterWithIcon>
          <FilterWithIcon
            icon={MACHINE_ICON.area}
            tone="text-amber-700 dark:text-amber-300"
            className="w-36 shrink-0"
          >
            <MultiSelect
              clearable
              className="w-full"
              fullWidth
              density="tight"
              showSelectedValues
              chips
              label={t('atm.map.filters.area')}
              options={areas.map((area) => ({ value: area, label: area }))}
              value={filters.areas}
              onChange={(next) =>
                patch({ areas: next.length === 0 ? null : joinAtmNameList(next) })
              }
            />
          </FilterWithIcon>
          <FilterWithIcon
            icon={MAP_ICON.zone}
            tone="text-brand-600 dark:text-brand-300"
            className="w-36 shrink-0"
          >
            <MultiSelect
              clearable
              className="w-full"
              fullWidth
              density="tight"
              showSelectedValues
              chips
              label={t('atm.map.filters.zone')}
              options={zones}
              value={filters.zones}
              onChange={(next) =>
                patch({ zones: next.length === 0 ? null : joinAtmNameList(next) })
              }
            />
          </FilterWithIcon>
          <SingleFilter
            icon={MAP_ICON.status}
            tone="text-emerald-600 dark:text-emerald-400"
            label={t('atm.map.filters.status')}
            value={filters.status}
            options={ATM_MAP_STATUS_FILTERS.map((status: AtmMapStatusFilter) => ({
              value: status,
              label: t(`atm.map.status.${status}`),
            }))}
            onChange={(value) => patch({ status: value === 'active' ? null : value })}
            className="w-44 shrink-0"
          />
          <SingleFilter
            icon={MAP_ICON.locate}
            tone="text-sky-600 dark:text-sky-400"
            label={t('atm.map.filters.location')}
            value={filters.loc}
            options={MAP_LOCATION_FILTERS.map((loc) => ({
              value: loc,
              label: t(LOCATION_LABEL[loc]),
            }))}
            onChange={(value) => patch({ loc: value === 'all' ? null : value })}
            className="w-48 shrink-0"
          />
          <FilterWithIcon
            icon={MAP_ICON.search}
            tone="text-slate-500 dark:text-slate-400"
            className="min-w-[10rem] flex-1"
          >
            <Input
              type="search"
              density="tight"
              aria-label={t('atm.map.filters.search')}
              placeholder={t('atm.map.filters.search')}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                onSearch(text);
              }}
            />
          </FilterWithIcon>
        </FilterBar>
      </FilterResetStyleContext.Provider>
    </div>
  );
};
