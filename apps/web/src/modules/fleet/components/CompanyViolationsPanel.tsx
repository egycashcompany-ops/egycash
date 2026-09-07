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
import {
  MAX_PAGE_SIZE,
  type FleetViolationRollupDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PrinterIcon, ResetIcon, DownloadIcon } from '../../../shared/ui/icons';
import { formatMoney, formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { saveBlob } from '../../../shared/lib/api-client';
import { useRecordVehicleViolation, useVehicles, useViolationRollup } from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { toCsv, exportFilename } from '../lib/violations-export';
import { printViolations } from '../lib/violations-print';

/** The four lines every group shows, in the order the business reads them. */
const TOTAL_ROWS = [
  { key: 'company', label: 'fleet.violations.lines.company', count: 'vehicleCount', amount: 'vehicleAmount' },
  { key: 'drivers', label: 'fleet.violations.lines.drivers', count: 'driverCount', amount: 'driverAmount' },
  { key: 'beforeGrievance', label: 'fleet.violations.lines.beforeGrievance', count: null, amount: 'totalBeforeGrievance' },
  { key: 'total', label: 'fleet.violations.lines.total', count: 'totalCount', amount: 'totalAmount' },
] as const;

const YEAR_SPAN = 20;

export const CompanyViolationsPanel = ({
  year,
  vehicleCodes,
  onYearChange,
  onVehicleCodesChange,
  onInspect,
}: {
  /** '' = every year. The board is read as a history, so no year is a real answer. */
  year: string;
  vehicleCodes: string[];
  onYearChange: (next: string | null) => void;
  onVehicleCodesChange: (next: string[]) => void;
  /** Open one (vehicle, year)'s own violations — where a single row can be ticked or edited. */
  onInspect: (row: FleetViolationRollupDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayRecord = can('fleetViolation.record');

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
  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formCount, setFormCount] = useState('');
  const record = useRecordVehicleViolation();

  const formVehicleId = idOf.get(formCode.trim());
  const isMoney = /^\d+(\.\d{1,3})?$/.test(formValue.trim());
  const isCount = /^\d+$/.test(formCount.trim()) && Number(formCount) >= 1;
  const canSave = mayRecord && formVehicleId !== undefined && formType !== '' && isMoney && isCount;

  const save = async (): Promise<void> => {
    if (!canSave || formVehicleId === undefined) return;
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
          { label: t('fleet.violations.lines.company'), value: formatMoney(totals.company, 'EGP', locale) },
          { label: t('fleet.violations.lines.drivers'), value: formatMoney(totals.drivers, 'EGP', locale) },
          { label: t('fleet.violations.totalAll'), value: formatMoney(totals.all, 'EGP', locale) },
        ],
        rtl: locale === 'ar',
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };

  const cell = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';
  const head =
    'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

  return (
    <section
      data-violations-panel="company"
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="mb-4 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.violations.companyTitle')}
      </h2>

      <div className="mb-3 flex items-start gap-3">
        {/* The two document actions, stacked beside the bar exactly as the design has them. */}
        <div className="flex shrink-0 flex-col gap-1">
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
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
          <Field label={t('fleet.violations.fields.year')}>
            <Select
              aria-label={t('fleet.violations.fields.year')}
              data-company-form="year"
              value={formYear}
              onChange={(e) => setFormYear(e.target.value)}
              className="w-24"
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('fleet.odometer.columns.vehicle')}>
            <Input
              data-company-form="code"
              aria-label={t('fleet.odometer.columns.vehicle')}
              placeholder={t('fleet.violations.codePlaceholder')}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              className="w-28"
              dir="ltr"
            />
          </Field>
          <Field label={t('fleet.violations.pickType')}>
            {/* company side ONLY — the server refuses a driver type here, so offering one would
                be offering a 422 the reader can do nothing about. */}
            <CatalogSelect
              kind="violationType"
              violationSide="company"
              value={formType}
              onChange={setFormType}
              ariaLabel={t('fleet.violations.pickType')}
              allLabel={t('fleet.violations.pickType')}
            />
          </Field>
          <Field label={t('fleet.violations.fields.unitValue')}>
            <Input
              data-company-form="value"
              aria-label={t('fleet.violations.fields.unitValue')}
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              className="w-24"
              dir="ltr"
              inputMode="decimal"
            />
          </Field>
          <span className="pb-2 text-sm font-medium text-slate-400">×</span>
          <Field label={t('fleet.violations.fields.count')}>
            <Input
              data-company-form="count"
              aria-label={t('fleet.violations.fields.count')}
              value={formCount}
              onChange={(e) => setFormCount(e.target.value)}
              className="w-20"
              dir="ltr"
              inputMode="numeric"
            />
          </Field>
          <Button
            data-company-save="true"
            disabled={!canSave}
            loading={record.isPending}
            onClick={() => void save()}
            className="mb-0.5"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* ── what the board is showing ───────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('fleet.violations.fields.year')}
          data-company-filter="year"
          value={year}
          onChange={(e) => onYearChange(e.target.value === '' ? null : e.target.value)}
          className="w-32"
        >
          <option value="">{t('fleet.violations.allYears')}</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>
        <VehicleCodeFilter className="min-w-0 flex-1" value={vehicleCodes} onChange={onVehicleCodesChange} />
        <button
          type="button"
          data-company-refresh="true"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          onClick={() => void rollup.refetch()}
          className="rounded-md bg-rose-800 p-2 text-white hover:bg-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
        >
          <ResetIcon className="h-4 w-4" />
        </button>
        <span data-company-count className="text-lg font-bold text-brand-700 dark:text-brand-300">
          {formatNumber(rows.length, locale)}
        </span>
      </div>

      {rollup.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rollup.isError ? (
        <ErrorState error={rollup.error} onRetry={() => void rollup.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('fleet.violations.empty')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table data-company-table className="w-full min-w-[38rem] border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
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
                  className="border-t border-slate-200 dark:border-slate-800"
                >
                  {TOTAL_ROWS.map((total, line) => (
                    <tr key={total.key} className={line % 2 === 0 ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''}>
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
                      <td className={`${cell} text-center tabular-nums`} data-line-count={total.key}>
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
                        <td rowSpan={4} className={`${cell} text-center`}>
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
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <table className="mt-2 w-full border-collapse text-sm">
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
        </>
      )}
    </section>
  );
};
