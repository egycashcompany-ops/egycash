// «مخالفات تتحملها الشركــة» — the right half of the violations screen.
//
// TWO THINGS, stacked. A bar that files ONE statement row (FR-9: year, car, type, unit value ×
// how many — the amount is the server's arithmetic, never this form's), and under it the annual
// board: one group per (vehicle, year) with the four totals the business reads it by.
//
// The board is `GET /violations/rollup` rendered verbatim. Every figure — the company's share,
// the drivers' share, the pre-appeal figure and the car's total — is derived server-side at query
// time, and this file adds no arithmetic of its own beyond summing the visible groups for its own
// footer.
//
// Hand-rolled `<table>` rather than `DataTable`, deliberately: a group is FOUR stacked rows under
// one spanning car cell, and `DataTable` renders exactly one `<tr>` per row with no rowSpan seam.
// The precedent is `FleetDashboardPage`, whose classes these copy so the two boards match.
import { useMemo, useState } from 'react';
import { MAX_PAGE_SIZE, type FleetViolationRollupDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  CheckIcon,
  EditIcon,
  PrinterIcon,
  ResetIcon,
  DownloadIcon,
} from '../../../shared/ui/icons';
import { formatMoney, formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import { saveBlob } from '../../../shared/lib/api-client';
import {
  useRecordVehicleViolation,
  useSetRollupCollected,
  useVehicles,
  useViolationRollup,
} from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { VehicleSelect } from './VehicleSelect';
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FilterField } from '../../../shared/ui/FilterField';
import { toCsv, exportFilename } from '../lib/violations-export';
import { printViolations } from '../lib/violations-print';

/** The four lines every group shows, in the order the business reads them. */
const TOTAL_ROWS = [
  {
    key: 'company',
    label: 'fleet.violations.lines.company',
    count: 'vehicleCount',
    amount: 'vehicleAmount',
  },
  {
    key: 'drivers',
    label: 'fleet.violations.lines.drivers',
    count: 'driverCount',
    amount: 'driverAmount',
  },
  {
    key: 'beforeGrievance',
    label: 'fleet.violations.lines.beforeGrievance',
    count: null,
    amount: 'totalBeforeGrievance',
  },
  {
    key: 'total',
    label: 'fleet.violations.lines.total',
    count: 'totalCount',
    amount: 'totalAmount',
  },
] as const;

const YEAR_SPAN = 20;

// The filter bar's rhythm, shared with the driver half — see `FilterField`.
const TIGHT = 'tight' as const;
/** `flex-1 basis-0` = an EQUAL share of the row, whatever each control's own words happen to be. */
const CELL = 'flex-1 basis-0 min-w-[6rem]';

export const CompanyViolationsPanel = ({
  year,
  vehicleCodes,
  onYearChange,
  onVehicleCodesChange,
  onClear,
  onInspect,
}: {
  /** '' = every year. The board is read as a history, so no year is a real answer. */
  year: string;
  vehicleCodes: string[];
  onYearChange: (next: string | null) => void;
  onVehicleCodesChange: (next: string[]) => void;
  /**
   * Clear this half in ONE write.
   *
   * Not two calls to the setters above: each builds the next URL from the params it was rendered
   * with, so firing both in one tick makes the second overwrite the first and one filter survives
   * the clear — measured, «السنة» came back every time.
   */
  onClear: () => void;
  /** Open one (vehicle, year)'s own violations — where a single row can be ticked or edited. */
  onInspect: (row: FleetViolationRollupDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayRecord = can('fleetViolation.record');
  const hasActiveFilters = year !== '' || vehicleCodes.length > 0;

  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: YEAR_SPAN }, (_, i) => thisYear - i),
    [thisYear],
  );

  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const idOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.code, v.id);
    return map;
  }, [vehicles.data]);
  // One car chosen narrows the board to it; several (or none) leave it whole — the rollup takes
  // a single vehicle, and pretending otherwise would silently show the first of a multi-select.
  const soleVehicleId = vehicleCodes.length === 1 ? idOf.get(vehicleCodes[0] as string) : undefined;

  const rollup = useViolationRollup(year === '' ? undefined : Number(year), soleVehicleId);
  const rows = rollup.data ?? [];

  // ── the entry bar ─────────────────────────────────────────────────────────
  const [formYear, setFormYear] = useState(String(thisYear));
  // The car is now held as an ID, because it is PICKED rather than typed — there is no longer a
  // code to resolve, and so no longer a way to have typed one that resolves to nothing.
  const [formVehicleId, setFormVehicleId] = useState('');
  const [formType, setFormType] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formCount, setFormCount] = useState('');
  const record = useRecordVehicleViolation();

  const isMoney = /^\d+(\.\d{1,3})?$/.test(formValue.trim());
  const isCount = /^\d+$/.test(formCount.trim()) && Number(formCount) >= 1;
  const canSave = mayRecord && formVehicleId !== '' && formType !== '' && isMoney && isCount;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    try {
      await record.mutateAsync({
        vehicleId: formVehicleId,
        year: Number(formYear),
        violationTypeId: formType,
        count: Number(formCount),
        unitValue: Number(formValue),
      });
      // The car and the year stay: a clerk files a run of fines for one car in one sitting.
      setFormType('');
      setFormValue('');
      setFormCount('');
      toast.success(t('fleet.violations.saved'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  // ── what the panel's own footer adds up ───────────────────────────────────
  const totals = useMemo(
    () => ({
      company: rows.reduce((sum, r) => sum + r.vehicleAmount, 0),
      drivers: rows.reduce((sum, r) => sum + r.driverAmount, 0),
      all: rows.reduce((sum, r) => sum + r.totalAmount, 0),
    }),
    [rows],
  );

  const scope = `${year === '' ? t('fleet.violations.allYears') : year}${
    vehicleCodes.length === 0 ? '' : ` · ${vehicleCodes.join(', ')}`
  }`;
  const exportRows = (): string[][] =>
    rows.map((r) => [
      String(r.year),
      r.code,
      String(r.vehicleCount),
      String(r.vehicleAmount),
      String(r.driverCount),
      String(r.driverAmount),
      String(r.totalBeforeGrievance),
      String(r.totalCount),
      String(r.totalAmount),
    ]);
  const exportHeader = [
    t('fleet.violations.fields.year'),
    t('fleet.odometer.columns.vehicle'),
    t('fleet.violations.rollup.vehicleCount'),
    t('fleet.violations.rollup.vehicleAmount'),
    t('fleet.violations.rollup.driverCount'),
    t('fleet.violations.rollup.driverAmount'),
    t('fleet.violations.rollup.totalBeforeGrievance'),
    t('fleet.violations.rollup.totalCount'),
    t('fleet.violations.rollup.totalAmount'),
  ];

  const onExport = (): void => {
    const blob = new Blob([toCsv(exportHeader, exportRows())], {
      type: 'text/csv;charset=utf-8',
    });
    saveBlob(blob, exportFilename('company-violations', new Date().toISOString().slice(0, 10)));
  };
  const onPrint = (): void => {
    try {
      printViolations({
        title: t('fleet.violations.companyTitle'),
        subtitle: scope,
        header: exportHeader,
        rows: exportRows(),
        totals: [
          {
            label: t('fleet.violations.lines.company'),
            value: formatMoney(totals.company, 'EGP', locale),
          },
          {
            label: t('fleet.violations.lines.drivers'),
            value: formatMoney(totals.drivers, 'EGP', locale),
          },
          { label: t('fleet.violations.totalAll'), value: formatMoney(totals.all, 'EGP', locale) },
        ],
        rtl: locale === 'ar',
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };

  const collectGroup = useSetRollupCollected();
  /** A group is settled only when EVERY row in it is, so the tick asks for the state it is not in. */
  const toggleYear = async (row: FleetViolationRollupDto): Promise<void> => {
    try {
      await collectGroup.mutateAsync({
        vehicleId: row.vehicleId,
        year: row.year,
        collected: row.collectedCount !== row.rowCount,
      });
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const cell = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';
  const head =
    'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  return (
    <section
      data-violations-panel="company"
      className="flex min-h-0 min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="mb-4 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.violations.companyTitle')}
      </h2>

      <div className="mb-3 flex items-start gap-3">
        {/* ORDER IS THE POINT: this row is RTL, so a child listed LAST is drawn on the LEFT. The
            entry bar is written first and the two document actions after it, which puts the export
            and the printer on the left edge of the panel where the owner asked for them. */}
        <div className="order-last flex shrink-0 flex-col gap-1">
          <button
            type="button"
            data-print="company"
            aria-label={t('common.print')}
            title={t('common.print')}
            onClick={onPrint}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <PrinterIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            data-export="company"
            aria-label={t('fleet.violations.exportCsv')}
            title={t('fleet.violations.exportCsv')}
            onClick={onExport}
            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950"
          >
            <DownloadIcon className="h-6 w-6" />
          </button>
        </div>

        {/* ── file one statement row ─────────────────────────────────────── */}
        {/* IT WRAPS, it does not scroll. This was `overflow-x-auto` on the argument that a
            statement line reads left to right as one sentence — but a half-width panel gives the
            row 556px and the controls need 825, so what that produced was a horizontal scrollbar
            inside a form: «العدد» and the total sat off-screen behind it, and nothing said they
            were there. A second line is visible; a scrolled-away field is not.

            `[&>*]:shrink-0` stays, and is still the load-bearing part. Without it the flex
            children give up width to fit rather than wrapping, and the first to disappear was
            «السنة» — squeezed until only its chevron was left. Each control keeps its own size
            and moves to the next line whole. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 [&>*]:shrink-0 dark:border-slate-700 dark:bg-slate-800/50">
          <Field label={t('fleet.violations.fields.year')}>
            {/* The width is on the WRAPPER, not the control: `cn` is a plain joiner, so a `w-28`
                handed to `Select` sits beside its own `w-full` and loses — measured, the year
                rendered 86px wide however large a class it was given. */}
            <div className="w-28">
              <Select
                aria-label={t('fleet.violations.fields.year')}
                data-company-form="year"
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
              >
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label={t('fleet.odometer.columns.vehicle')} required>
            {/* PICKED, not typed. A typed code that matches no car left `formVehicleId` undefined,
                which disabled Save with nothing on screen to say why — the commonest way this form
                refused to file a statement anybody had filled in correctly. One car at a time,
                because a statement row belongs to one car. */}
            <div className="w-36">
              <VehicleSelect
                value={formVehicleId}
                onChange={setFormVehicleId}
                anyStatus
                fullWidth
                testId="company-entry"
                ariaLabel={t('fleet.odometer.columns.vehicle')}
              />
            </div>
          </Field>
          {/* The NOUN above, the imperative inside. `Field` already renders its label and a
              required marker, so labelling it «اختر نوع المخالفة» printed the same sentence twice,
              stacked — once as the field's name and once as the empty row of its own select. */}
          <Field label={t('fleet.violations.fields.type')} required>
            {/* company side ONLY — the server refuses a driver type here, so offering one would
                be offering a 422 the reader can do nothing about.

                `requireChoice` makes the placeholder a DISABLED row: it still says what the
                control is for while it is empty, but it can no longer be chosen back, so «no
                type» stops being one of the answers on a field that has no such answer. */}
            <div className="w-48">
              <CatalogSelect
                kind="violationType"
                violationSide="company"
                value={formType}
                onChange={setFormType}
                ariaLabel={t('fleet.violations.pickType')}
                allLabel={t('fleet.violations.pickType')}
                requireChoice
                className="w-full"
              />
            </div>
          </Field>
          <Field label={t('fleet.violations.fields.unitValue')}>
            <div className="w-20">
              <Input
                data-company-form="value"
                aria-label={t('fleet.violations.fields.unitValue')}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                dir="ltr"
                inputMode="decimal"
              />
            </div>
          </Field>
          <span className="pb-2 text-sm font-medium text-slate-400">×</span>
          <Field label={t('fleet.violations.fields.count')}>
            <div className="w-16">
              <Input
                data-company-form="count"
                aria-label={t('fleet.violations.fields.count')}
                value={formCount}
                onChange={(e) => setFormCount(e.target.value)}
                dir="ltr"
                inputMode="numeric"
              />
            </div>
          </Field>
          {/* What this line will cost, before it is filed. The server owns the real arithmetic
              (count × unitValue) and this only mirrors it, so it shows a figure ONLY when both
              halves are valid — a total computed from a half-typed number is a wrong number, and a
              wrong number beside a Save button is worse than none. */}
          <Field label={t('fleet.violations.fields.amount')}>
            <output
              data-company-form-total
              className={[
                'block min-w-[5.5rem] rounded-md border px-2 py-1.5 text-center text-sm font-semibold tabular-nums',
                isMoney && isCount
                  ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200'
                  : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900',
              ].join(' ')}
            >
              {isMoney && isCount
                ? formatMoney(Number(formValue) * Number(formCount), 'EGP', locale)
                : '—'}
            </output>
          </Field>
          <Button
            data-company-save="true"
            disabled={!canSave}
            loading={record.isPending}
            onClick={() => void save()}
            className="mb-0.5 shrink-0"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* ── what the board is showing ────────────────────────────────────
          The same bar as the driver half, so the two ledgers read as one screen: each filter's
          NAME above its control, both controls the same width, the count beside them rather than
          floating after them. See `FilterField`. */}
      <FilterBar
        singleRow
        singleRowFrom={1280}
        trailing={
          <>
            {/* CLEARS this half's filters, which is what its icon and its position have always
                promised. It called `refetch()` before — a button that re-asked a question whose
                answer had not changed, so pressing it did nothing a reader could see, on a control
                that looks exactly like «مسح الفلاتر» everywhere else in the app. Shown only when
                there is something to clear, as `FilterBar` does; rendered here rather than through
                `FilterBar`'s own `onClear` so it keeps the hook the tests press it by. */}
            {hasActiveFilters && (
              <button
                type="button"
                data-company-clear="true"
                aria-label={t('common.filters.clear')}
                title={t('common.filters.clear')}
                onClick={onClear}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
              >
                <ResetIcon className="h-4 w-4" />
              </button>
            )}
            <span
              data-company-count
              role="status"
              title={t('fleet.violations.matchedGroups')}
              className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {formatNumber(rows.length, locale)}
            </span>
          </>
        }
      >
        <FilterField
          label={t('fleet.violations.fields.year')}
          active={year !== ''}
          className={CELL}
        >
          <Select
            aria-label={t('fleet.violations.fields.year')}
            data-company-filter="year"
            value={year}
            onChange={(e) => onYearChange(e.target.value === '' ? null : e.target.value)}
            density={TIGHT}
          >
            <option value="">{t('common.filters.all')}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField
          label={t('fleet.vehicles.fields.code')}
          active={vehicleCodes.length > 0}
          className={CELL}
        >
          <VehicleCodeFilter
            value={vehicleCodes}
            onChange={onVehicleCodesChange}
            placeholder={t('common.filters.all')}
            density={TIGHT}
            fullWidth
            className="w-full"
          />
        </FilterField>
      </FilterBar>

      {rollup.isPending ? (
        <Skeleton className="h-64 w-full shrink-0" />
      ) : rollup.isError ? (
        <ErrorState error={rollup.error} onRetry={() => void rollup.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('fleet.violations.empty')} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The BOARD is what scrolls, not the page — and its head stays put while it does, so a
              reader working down forty groups can still see which column is which. */}
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table data-company-table className="w-full min-w-[38rem] border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  <th className={head}>{t('fleet.violations.columns.seq')}</th>
                  <th className={head}>{t('fleet.violations.fields.year')}</th>
                  <th className={head}>{t('fleet.odometer.columns.vehicle')}</th>
                  <th className={head}>{t('fleet.violations.columns.totals')}</th>
                  <th className={head}>{t('fleet.violations.columns.totalCount')}</th>
                  <th className={head}>{t('fleet.violations.fields.amount')}</th>
                  <th className={head}>{t('fleet.violations.edit')}</th>
                </tr>
              </thead>
              {rows.map((row, index) => (
                // One tbody per (vehicle, year): the group is the unit, and the browser keeps its
                // four lines together when the board is printed or scrolled.
                <tbody
                  key={`${row.vehicleId}:${row.year}`}
                  data-rollup-group={`${row.code}:${row.year}`}
                  data-rollup-settled={
                    row.rowCount > 0 && row.collectedCount === row.rowCount ? 'true' : undefined
                  }
                  // SETTLED IS A STATE OF THE GROUP, so the group carries it — the tick is where
                  // it is changed, the tint is how the board reads at a glance. The tick already
                  // changed colour on its own, which told a reader nothing until they had found
                  // and looked at it; the driver board beside this one has tinted its settled rows
                  // green since it was built, and the two halves have to answer the same question
                  // the same way.
                  className={cn(
                    'border-t border-slate-200 dark:border-slate-800',
                    row.rowCount > 0 &&
                      row.collectedCount === row.rowCount &&
                      'bg-emerald-50 dark:bg-emerald-950/40',
                  )}
                >
                  {TOTAL_ROWS.map((total, line) => (
                    <tr
                      key={total.key}
                      className={line % 2 === 0 ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''}
                    >
                      {line === 0 && (
                        <>
                          <td rowSpan={4} className={`${cell} text-center tabular-nums`}>
                            {formatNumber(index + 1, locale)}
                          </td>
                          <td rowSpan={4} className={`${cell} text-center tabular-nums`}>
                            {row.year}
                          </td>
                          <td rowSpan={4} className={`${cell} text-center font-mono`} dir="ltr">
                            {row.code}
                          </td>
                        </>
                      )}
                      <td className={cell}>{t(total.label)}</td>
                      <td
                        className={`${cell} text-center tabular-nums`}
                        data-line-count={total.key}
                      >
                        {/* «قبل التظلم» counts nothing — it is a figure, not a tally, and a 0
                            there would read as "no violations" rather than "not applicable". */}
                        {total.count === null
                          ? '—'
                          : formatNumber(row[total.count] as number, locale)}
                      </td>
                      <td className={`${cell} text-end tabular-nums`} data-line-amount={total.key}>
                        {formatMoney(row[total.amount] as number, 'EGP', locale)}
                      </td>
                      {line === 0 && (
                        <td rowSpan={4} className={`${cell}`}>
                          <span className="flex items-center justify-center gap-1">
                            {/* THE TICK IS OUT HERE, beside the edit, because settling a year is a
                                decision about the GROUP the reader is looking at — it used to be
                                reachable only after opening the group, which put the commonest act
                                on this board two clicks behind the rarest one.

                                Three states, not two: every row ticked, none, or SOME. The middle
                                one is what a reader most needs to see, and it is why the rollup
                                carries two numbers instead of a boolean. */}
                            {can('fleetViolation.collect') && row.rowCount > 0 && (
                              <button
                                type="button"
                                data-rollup-collect={`${row.code}:${row.year}`}
                                data-collected-state={
                                  row.collectedCount === 0
                                    ? 'none'
                                    : row.collectedCount === row.rowCount
                                      ? 'all'
                                      : 'some'
                                }
                                aria-pressed={row.collectedCount === row.rowCount}
                                disabled={collectGroup.isPending}
                                aria-label={t('fleet.violations.collectYear', {
                                  code: row.code,
                                  year: String(row.year),
                                })}
                                title={t('fleet.violations.collectedOf', {
                                  collected: formatNumber(row.collectedCount, locale),
                                  total: formatNumber(row.rowCount, locale),
                                })}
                                onClick={() => void toggleYear(row)}
                                className={[
                                  'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
                                  row.collectedCount === row.rowCount
                                    ? 'text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400'
                                    : row.collectedCount > 0
                                      ? 'text-amber-500 hover:bg-amber-100 dark:text-amber-400'
                                      : 'text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800',
                                ].join(' ')}
                              >
                                <CheckIcon className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              data-inspect={`${row.code}:${row.year}`}
                              aria-label={t('fleet.violations.inspect', { code: row.code })}
                              title={t('fleet.violations.inspect', { code: row.code })}
                              onClick={() => onInspect(row)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
                            >
                              <EditIcon className="h-4 w-4" />
                            </button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <table className="mt-2 w-full shrink-0 border-collapse text-sm">
            <tbody>
              {[
                ['company', 'fleet.violations.lines.company', totals.company],
                ['drivers', 'fleet.violations.lines.drivers', totals.drivers],
                ['all', 'fleet.violations.totalAll', totals.all],
              ].map(([key, label, value]) => (
                <tr key={key as string} className="border-t border-slate-200 dark:border-slate-800">
                  <td className={cell}>{t(label as string)}</td>
                  <td
                    className={`${cell} text-end font-semibold tabular-nums`}
                    data-company-total={key as string}
                  >
                    {formatMoney(value as number, 'EGP', locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
