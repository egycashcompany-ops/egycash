// The filter bar of the five «حسب الفلاتر» tabs — the approved Phase-1 sample's bar (zz-fleetdash-p1.tsx,
// `PanelHead`), in the system palette. ONE filter state for the five tabs (`PeriodFilters`, the
// address bar): a change here is written there by the page (`onFilters` → `periodFiltersPatch`), so
// switching tabs keeps it and the «الآن» tabs never see it.
//
//   «الفترة»          هذا الشهر · الشهر الماضي · آخر 30 يومًا · هذه السنة · مخصص (من / إلى)
//   «نوع السيارة»     vehicle types       — shown to a reader who may read the types list
//   «التشغيل»         operations          — shown to a reader who may read the operations catalog
//   «أكواد السيارات»  vehicle codes       — shown to a reader who may read the registry
//   «مسح الفلاتر»
//
// THE CHIPS UNDER THE BAR SAY WHAT THE FIGURES ARE OVER: the range and the set the server ECHOED
// (`range`, `vehicleScope`), never the browser's clock — while a new filter loads, they keep
// describing the figures still on screen.
//
// A list the reader may not read is never asked for (no 403 on the dashboard): its control is not
// drawn, and its chip names the filter without the names.
//
// `periodOnly` («التراخيص والتجديدات», critic A3): the period choices alone — the preset, the custom
// dates and the range chip. A licence-expense memo carries no branch, car type, operation or amount
// per car, so nothing else moves that tab's figures: its type / operation / codes controls and chips
// are not drawn (their lists never asked for), and «مسح الفلاتر» there brings back the default period
// only — the set the other tabs hold stays in the address bar untouched.
import {
  FLEET_DASHBOARD_DEFAULT_PRESET,
  FLEET_DASHBOARD_PRESETS,
  type FleetDashboardPeriodDto,
  type FleetDashboardPreset,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Input, Select } from '../../../../shared/ui/form';
import { MultiSelect, optionLabel } from '../../../../shared/ui/MultiSelect';
import { useFleetCatalog } from '../../api/fleet-queries';
import { customRangeValid, type PeriodFilters } from '../../lib/fleet-dashboard-url';
import {
  CODE_READERS,
  OPERATION_READERS,
  TYPE_READERS,
  useVehicleTypeOptions,
} from '../../lib/vehicle-set-params';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { CatalogMultiSelect } from '../CatalogMultiSelect';
import { FILTER_ICON, FilterWithIcon } from '../FilterWithIcon';
import { VehicleCodeFilter } from '../VehicleCodeFilter';
import { TIGHT } from '../custody-memo-parts';
import { AMBER, CHIP, Card, FOCUS, MUTED, N, RULE, cn } from './dash-kit';
import { Phrase, count, useNoun } from './dash-shell';

// The reader lists live with the vehicle-set params (every screen that draws the set's controls
// gates them the same way); re-exported here for the bar's own specs.
export { CODE_READERS, OPERATION_READERS, TYPE_READERS };

const mayAny = (keys: readonly string[], can: (permission: string) => boolean): boolean =>
  keys.some((key) => can(key));

/** The default state — what «مسح الفلاتر» goes back to. */
export const CLEARED: PeriodFilters = {
  preset: FLEET_DASHBOARD_DEFAULT_PRESET,
  from: '',
  to: '',
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
};

export const isCleared = (f: PeriodFilters): boolean =>
  f.preset === FLEET_DASHBOARD_DEFAULT_PRESET &&
  f.typeIds.length === 0 &&
  f.operationIds.length === 0 &&
  f.vehicleCodes.length === 0;

/** Nothing left for «مسح الفلاتر» to undo: on a period-only bar, the default period alone (the set
 *  it does not draw is not its to clear). */
export const isClearedFor = (f: PeriodFilters, periodOnly: boolean): boolean =>
  periodOnly ? f.preset === FLEET_DASHBOARD_DEFAULT_PRESET : isCleared(f);

/** What «مسح الفلاتر» leaves: the default state, or — on a period-only bar — the default period
 *  with the other tabs' set kept as it is in the address bar. */
export const clearedFor = (f: PeriodFilters, periodOnly: boolean): PeriodFilters =>
  periodOnly ? { ...f, preset: CLEARED.preset, from: '', to: '' } : CLEARED;

/** A new preset. «مخصص» starts from the range on show (the server's echo), the others carry no dates. */
export const withPreset = (
  f: PeriodFilters,
  preset: FleetDashboardPreset,
  shown: { from: string; to: string } | null,
): PeriodFilters =>
  preset === 'custom'
    ? {
        ...f,
        preset,
        from: f.from !== '' ? f.from : (shown?.from ?? ''),
        to: f.to !== '' ? f.to : (shown?.to ?? ''),
      }
    : { ...f, preset, from: '', to: '' };

/** The bar's controls take the dashboard's own field face (the sample's rounded slate boxes). */
const CONTROLS = cn(
  'flex flex-wrap items-center gap-2.5',
  '[&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!border-slate-200 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!border-[#223048] dark:[&_button[aria-haspopup]]:!bg-[#0a0e17]',
  '[&_select]:!rounded-xl [&_select]:!border-slate-200 [&_select]:!bg-slate-50 dark:[&_select]:!border-[#223048] dark:[&_select]:!bg-[#0a0e17]',
  '[&_input]:!rounded-xl [&_input]:!border-slate-200 [&_input]:!bg-slate-50 dark:[&_input]:!border-[#223048] dark:[&_input]:!bg-[#0a0e17]',
);
const BOX = 'w-full sm:w-48';
const CHIP_FACE = cn(CHIP, 'font-semibold');

/** The operations' names, read only by a reader the catalog answers. */
const OperationChip = ({ ids }: { ids: readonly string[] }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data } = useFleetCatalog('operation');
  const options = (data?.items ?? []).map((item) => ({
    value: item.id,
    label: localized(item.name, locale),
  }));
  return (
    <span data-period-chip="operation" className={CHIP_FACE}>
      {ids.length === 0
        ? t('fleet.dash.filters.allOperations')
        : ids.map((id) => optionLabel(options, id)).join(', ')}
    </span>
  );
};

export const PeriodFilterBar = ({
  filters,
  onFilters,
  data,
  can,
  periodOnly = false,
}: {
  filters: PeriodFilters;
  onFilters: (next: PeriodFilters) => void;
  /** R2's answer on screen: its echo names the chips. */
  data: FleetDashboardPeriodDto | undefined;
  can: (permission: string) => boolean;
  /** The period choices alone (the preset, the custom dates, the range chip): a tab whose figures
   *  no vehicle set reaches. */
  periodOnly?: boolean;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const mayTypes = !periodOnly && mayAny(TYPE_READERS, can);
  const mayOperations = !periodOnly && mayAny(OPERATION_READERS, can);
  const mayCodes = !periodOnly && mayAny(CODE_READERS, can);
  const typeOptions = useVehicleTypeOptions(mayTypes);
  const custom = filters.preset === 'custom';
  const shown = data?.range ?? null;
  const scope = data?.vehicleScope ?? null;
  const set = (patch: Partial<PeriodFilters>): void => onFilters({ ...filters, ...patch });

  const date = (side: 'from' | 'to'): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-full sm:w-40"
      datePicker={{ label: t(`fleet.dash.filters.${side}`) }}
    >
      <Input
        type="date"
        dir="ltr"
        density={TIGHT}
        data-period-date={side}
        aria-label={t(`fleet.dash.filters.${side}`)}
        title={t(`fleet.dash.filters.${side}`)}
        value={filters[side]}
        onChange={(e) =>
          set(
            side === 'from'
              ? { preset: 'custom', from: e.target.value }
              : { preset: 'custom', to: e.target.value },
          )
        }
        className="dark:[color-scheme:dark]"
      />
    </FilterWithIcon>
  );

  return (
    <Card
      data-period-filters="true"
      {...(periodOnly ? { 'data-period-only': 'true' } : {})}
      className="mb-5 p-3"
    >
      <div
        role="group"
        data-period-controls="true"
        aria-label={t('fleet.dash.filters.label')}
        className={CONTROLS}
      >
        <FilterWithIcon
          icon={FILTER_ICON.calendar}
          tone="text-slate-500 dark:text-slate-400"
          className={BOX}
        >
          <Select
            density={TIGHT}
            data-period-preset="true"
            // The icon sits in the box's start gutter (the frame pads only inputs and list buttons).
            className="!ps-7"
            aria-label={t('fleet.dash.filters.period')}
            title={t('fleet.dash.filters.period')}
            value={filters.preset}
            onChange={(e) =>
              onFilters(withPreset(filters, e.target.value as FleetDashboardPreset, shown))
            }
          >
            {FLEET_DASHBOARD_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {t(`fleet.dash.filters.preset.${preset}`)}
              </option>
            ))}
          </Select>
        </FilterWithIcon>
        {custom && date('from')}
        {custom && date('to')}
        {mayTypes && (
          <FilterWithIcon
            icon={FILTER_ICON.car}
            tone="text-slate-500 dark:text-slate-400"
            className={BOX}
          >
            <MultiSelect
              clearable
              fullWidth
              showSelectedValues
              className="w-full"
              density={TIGHT}
              label={t('fleet.dash.filters.type')}
              options={typeOptions}
              value={filters.typeIds}
              onChange={(next) => set({ typeIds: next })}
            />
          </FilterWithIcon>
        )}
        {mayOperations && (
          <FilterWithIcon
            icon={FILTER_ICON.operation}
            tone="text-slate-500 dark:text-slate-400"
            className={BOX}
          >
            <CatalogMultiSelect
              kind="operation"
              fullWidth
              className="w-full"
              density={TIGHT}
              label={t('fleet.dash.filters.operation')}
              value={filters.operationIds}
              onChange={(next) => set({ operationIds: next })}
            />
          </FilterWithIcon>
        )}
        {mayCodes && (
          <FilterWithIcon
            icon={FILTER_ICON.car}
            tone="text-emerald-600 dark:text-emerald-400"
            className={BOX}
          >
            <VehicleCodeFilter
              fullWidth
              density={TIGHT}
              placeholder={t('fleet.dash.filters.codes')}
              value={filters.vehicleCodes}
              onChange={(next) => set({ vehicleCodes: next })}
            />
          </FilterWithIcon>
        )}
        <button
          type="button"
          data-period-clear="true"
          disabled={isClearedFor(filters, periodOnly)}
          onClick={() => onFilters(clearedFor(filters, periodOnly))}
          className={cn(
            'ms-auto rounded-xl px-3 py-2 text-[13px] font-bold transition-colors enabled:hover:bg-slate-100 enabled:hover:text-slate-800 disabled:cursor-default disabled:opacity-60 dark:enabled:hover:bg-slate-800/60 dark:enabled:hover:text-white',
            MUTED,
            FOCUS,
          )}
        >
          {t('fleet.dash.filters.clear')}
        </button>
      </div>

      {custom && !customRangeValid(filters.from, filters.to) && (
        <p data-period-invalid="true" className={cn('mt-2 text-xs font-semibold', AMBER)}>
          {t('fleet.dash.filters.customInvalid')}
        </p>
      )}

      {shown !== null && scope !== null && (
        <div className={cn('mt-2.5 flex flex-wrap gap-1.5 border-t pt-2.5', RULE)}>
          <span data-period-chip="range" className={CHIP_FACE}>
            <Phrase
              text={t('fleet.dash.filters.rangeChip')}
              parts={{ from: <N>{slashDay(shown.from)}</N>, to: <N>{slashDay(shown.to)}</N> }}
            />
          </span>
          {!periodOnly && (
            <>
              <span data-period-chip="type" className={CHIP_FACE}>
                {scope.typeIds.length === 0
                  ? t('fleet.dash.filters.allTypes')
                  : mayTypes
                    ? scope.typeIds.map((id) => optionLabel(typeOptions, id)).join(', ')
                    : t('fleet.dash.filters.someTypes')}
              </span>
              {mayOperations ? (
                <OperationChip ids={scope.operationIds} />
              ) : (
                <span data-period-chip="operation" className={CHIP_FACE}>
                  {scope.operationIds.length === 0
                    ? t('fleet.dash.filters.allOperations')
                    : t('fleet.dash.filters.someOperations')}
                </span>
              )}
              <span data-period-chip="codes" className={CHIP_FACE}>
                {scope.vehicleCodes.length === 0 ? (
                  t('fleet.dash.filters.allCars')
                ) : (
                  <N>{scope.vehicleCodes.join(', ')}</N>
                )}
              </span>
              {scope.count !== null && (
                <span data-period-chip="count" className={CHIP_FACE}>
                  <Phrase
                    text={t('fleet.dash.filters.setCount')}
                    parts={{ count: <N>{count(scope.count)}</N>, noun: noun('car', scope.count) }}
                  />
                </span>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
};
