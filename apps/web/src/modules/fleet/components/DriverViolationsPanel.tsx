// «مخالفات يتحملها السائقين» — the left half of the violations screen.
//
// The bar COUNTS before it names. A clerk holding a stack of tickets for one car knows how many
// are speeding and how many are seatbelt long before they know whose each one is, so the bar is
// one counter per driver-side violation type and the naming happens after: each unit counted
// opens a card for its day, its driver and its money.
//
// The counters come from the CATALOG, never from a list in this file. A house that starts fining
// drivers for something new adds it once in the admin screen and gets a counter for it here.
//
// One save, one request: `POST /violations/driver/batch` is a transaction, so a stack of tickets
// is filed whole or not at all — five stored fines out of six is the outcome this shape exists to
// make impossible.
import { useMemo, useState } from 'react';
import {
  MAX_PAGE_SIZE,
  type FleetViolationDto,
  type Locale,
  type PageMeta,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, EditIcon, TrashIcon, PrinterIcon, ResetIcon, DownloadIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney, formatNumber, localized } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { saveBlob } from '../../../shared/lib/api-client';
import {
  useFleetCatalog,
  useRecordDriverViolations,
  useSetViolationCollected,
  useVehicles,
  useViolations,
} from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { EmployeeName } from './EmployeeName';
import { OptionalEmployeeField } from './OptionalEmployeeField';
import {
  cardLabel,
  entryCards,
  entryComplete,
  entryTotal,
  incompleteCards,
  toBatchPayload,
  type DriverEntryCard,
  type DriverEntryType,
} from '../lib/driver-violation-entry';
import { toCsv, exportFilename } from '../lib/violations-export';
import { printViolations } from '../lib/violations-print';

export const DriverViolationsPanel = ({
  vehicleCodes,
  driverEmployeeId,
  typeId,
  page,
  pageSize,
  onVehicleCodesChange,
  onDriverChange,
  onTypeChange,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
}: {
  vehicleCodes: string[];
  driverEmployeeId: string;
  typeId: string;
  page: number;
  pageSize: number;
  onVehicleCodesChange: (next: string[]) => void;
  onDriverChange: (next: string) => void;
  onTypeChange: (next: string) => void;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
  onEdit: (row: FleetViolationDto) => void;
  onDelete: (row: FleetViolationDto) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const mayRecord = can('fleetViolation.record');
  const mayCollect = can('fleetViolation.collect');
  const mayEdit = can('fleetViolation.edit');
  const mayDelete = can('fleetViolation.delete');

  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const idOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.code, v.id);
    return map;
  }, [vehicles.data]);
  const codeOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.id, v.code);
    return map;
  }, [vehicles.data]);

  // The driver-side vocabulary, live. Its ORDER is the catalog's, so the bar reads the way the
  // admin screen lists it rather than the way this file happened to type it.
  const catalog = useFleetCatalog('violationType', 'driver');
  const types: DriverEntryType[] = useMemo(
    () =>
      (catalog.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({ id: item.id, name: localized(item.name, locale) })),
    [catalog.data, locale],
  );
  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of types) map.set(type.id, type.name);
    return map;
  }, [types]);

  // ── the counting bar ──────────────────────────────────────────────────────
  const [formCode, setFormCode] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cards, setCards] = useState<DriverEntryCard[]>([]);
  const record = useRecordDriverViolations();

  const setCount = (id: string, raw: string): void => {
    const n = raw.trim() === '' ? 0 : Math.max(0, Math.trunc(Number(raw)));
    if (!Number.isFinite(n)) return;
    const next = { ...counts, [id]: n };
    setCounts(next);
    // Cards are derived from the counts, carrying over what has already been typed — raising a
    // counter must not blank the card beside it.
    setCards((held) => entryCards(types, next, held));
  };
  const patchCard = (key: string, patch: Partial<DriverEntryCard>): void =>
    setCards((held) => held.map((card) => (card.key === key ? { ...card, ...patch } : card)));

  const formVehicleId = idOf.get(formCode.trim());
  const missing = incompleteCards(cards);
  const canSave =
    mayRecord && formVehicleId !== undefined && entryComplete(cards) && !record.isPending;

  const save = async (): Promise<void> => {
    if (!canSave || formVehicleId === undefined) return;
    try {
      await record.mutateAsync(toBatchPayload(formVehicleId, cards));
      // Only on success: the batch is atomic, so a failure leaves the bar exactly as it was and
      // the reader re-tries the same stack rather than working out what got through.
      setCounts({});
      setCards([]);
      toast.success(t('fleet.violations.batchSaved', { count: String(cards.length) }));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  // ── the board ─────────────────────────────────────────────────────────────
  const params = useMemo(
    () => ({
      kind: 'driver' as const,
      page,
      pageSize,
      sortBy: 'date',
      sortDir: 'desc' as const,
      ...(vehicleCodes.length === 0 ? {} : { vehicleCodes: vehicleCodes.join(',') }),
      ...(driverEmployeeId === '' ? {} : { driverEmployeeIds: driverEmployeeId }),
      ...(typeId === '' ? {} : { violationTypeId: typeId }),
    }),
    [page, pageSize, vehicleCodes, driverEmployeeId, typeId],
  );
  const list = useViolations(params);
  const rows = list.data?.items ?? [];
  const meta: PageMeta | undefined = list.data?.meta;
  const collect = useSetViolationCollected();

  const toggleCollected = async (row: FleetViolationDto): Promise<void> => {
    try {
      await collect.mutateAsync({
        id: row.id,
        body: { collected: !row.collected, version: row.version },
      });
    } catch (error) {
      // No optimistic paint: the row turns green when the SERVER says it is collected, so a
      // refused write leaves the board telling the truth rather than a colour that lies.
      toast.error(errorMessage(error, locale));
    }
  };

  const pageTotal = rows.reduce((sum, row) => sum + row.amount, 0);

  const columns: Column<FleetViolationDto>[] = [
    {
      key: 'seq',
      header: t('fleet.violations.columns.seq'),
      align: 'center',
      render: (_row, index) =>
        formatNumber((meta === undefined ? 0 : (meta.page - 1) * meta.pageSize) + index + 1, locale),
    },
    {
      key: 'date',
      header: t('fleet.violations.fields.date'),
      render: (row) => formatDate(row.date, locale),
    },
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      align: 'center',
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {codeOf.get(row.vehicleId) ?? '—'}
        </span>
      ),
    },
    {
      key: 'driver',
      header: t('fleet.violations.fields.driver'),
      render: (row) =>
        row.driverEmployeeId === null ? '—' : <EmployeeName employeeId={row.driverEmployeeId} />,
    },
    {
      key: 'type',
      header: t('fleet.violations.fields.type'),
      render: (row) => typeName.get(row.violationTypeId) ?? '—',
    },
    {
      key: 'amount',
      header: t('fleet.violations.fields.amount'),
      align: 'end',
      render: (row) => (
        <span className="tabular-nums">{formatMoney(row.amount, 'EGP', locale)}</span>
      ),
    },
    ...(mayCollect || mayEdit || mayDelete
      ? [
          {
            key: 'actions',
            header: t('fleet.violations.columns.rowActions'),
            align: 'center' as const,
            render: (row: FleetViolationDto) => (
              <span className="flex items-center justify-center gap-1">
                {mayCollect && (
                  <button
                    type="button"
                    data-collect={row.id}
                    aria-pressed={row.collected}
                    aria-label={t(
                      row.collected ? 'fleet.violations.uncollect' : 'fleet.violations.collect',
                    )}
                    title={t(
                      row.collected ? 'fleet.violations.uncollect' : 'fleet.violations.collect',
                    )}
                    onClick={() => void toggleCollected(row)}
                    className={[
                      'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
                      row.collected
                        ? 'text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800',
                    ].join(' ')}
                  >
                    <CheckIcon className="h-4 w-4" />
                  </button>
                )}
                {mayDelete && (
                  <button
                    type="button"
                    data-delete={row.id}
                    aria-label={t('fleet.violations.delete')}
                    title={t('fleet.violations.delete')}
                    onClick={() => onDelete(row)}
                    className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:bg-rose-950"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
                {mayEdit && (
                  <button
                    type="button"
                    data-edit={row.id}
                    aria-label={t('fleet.violations.edit')}
                    title={t('fleet.violations.edit')}
                    onClick={() => onEdit(row)}
                    className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  const exportHeader = [
    t('fleet.violations.fields.date'),
    t('fleet.odometer.columns.vehicle'),
    t('fleet.violations.fields.driver'),
    t('fleet.violations.fields.type'),
    t('fleet.violations.fields.amount'),
    t('fleet.violations.collected'),
  ];
  const exportRows = (): string[][] =>
    rows.map((row) => [
      row.date === null ? '' : row.date.slice(0, 10),
      codeOf.get(row.vehicleId) ?? '',
      row.driverEmployeeId ?? '',
      typeName.get(row.violationTypeId) ?? '',
      String(row.amount),
      row.collected ? t('common.yes') : t('common.no'),
    ]);

  const onExport = (): void => {
    const blob = new Blob([toCsv(exportHeader, exportRows())], {
      type: 'text/csv;charset=utf-8',
    });
    saveBlob(blob, exportFilename('driver-violations', new Date().toISOString().slice(0, 10)));
  };
  const onPrint = (): void => {
    try {
      printViolations({
        title: t('fleet.violations.driverTitle'),
        subtitle: vehicleCodes.length === 0 ? t('fleet.violations.allVehicles') : vehicleCodes.join(', '),
        header: exportHeader,
        rows: exportRows(),
        totals: [
          { label: t('fleet.violations.lines.drivers'), value: formatMoney(pageTotal, 'EGP', locale) },
        ],
        rtl: locale === 'ar',
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };

  return (
    <section
      data-violations-panel="driver"
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="mb-4 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.violations.driverTitle')}
      </h2>

      <div className="mb-3 flex items-start gap-3">
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            data-print="driver"
            aria-label={t('common.print')}
            title={t('common.print')}
            onClick={onPrint}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <PrinterIcon className="h-6 w-6" />
          </button>
          <button
            type="button"
            data-export="driver"
            aria-label={t('fleet.violations.exportCsv')}
            title={t('fleet.violations.exportCsv')}
            onClick={onExport}
            className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-950"
          >
            <DownloadIcon className="h-6 w-6" />
          </button>
        </div>

        {/* ── count the stack ─────────────────────────────────────────────── */}
        <div
          data-driver-bar="true"
          className="flex min-w-0 flex-1 flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50"
        >
          <Field label={t('fleet.odometer.columns.vehicle')}>
            <Input
              data-driver-form="code"
              aria-label={t('fleet.odometer.columns.vehicle')}
              placeholder={t('fleet.violations.codePlaceholder')}
              value={formCode}
              onChange={(e) => setFormCode(e.target.value)}
              className="w-28"
              dir="ltr"
            />
          </Field>
          {types.map((type) => (
            <Field key={type.id} label={type.name}>
              <Input
                data-driver-count={type.id}
                aria-label={type.name}
                value={String(counts[type.id] ?? 0)}
                onChange={(e) => setCount(type.id, e.target.value)}
                className="w-20"
                dir="ltr"
                inputMode="numeric"
              />
            </Field>
          ))}
          <Button
            data-driver-save="true"
            disabled={!canSave}
            loading={record.isPending}
            onClick={() => void save()}
            className="mb-0.5"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* ── name what was counted ─────────────────────────────────────────── */}
      <div
        data-entered-panel="true"
        className="mb-3 rounded-lg bg-slate-900 p-3 dark:bg-slate-950"
      >
        <h3 className="mb-2 text-center text-sm font-semibold text-slate-100">
          {t('fleet.violations.enteredTitle')}
        </h3>
        {cards.length === 0 ? (
          <p data-entered-empty className="py-4 text-center text-xs text-slate-400">
            {t('fleet.violations.enteredEmpty')}
          </p>
        ) : (
          <>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {cards.map((card) => (
                <li
                  key={card.key}
                  data-entry-card={card.key}
                  data-entry-incomplete={missing.includes(card.key) ? 'true' : undefined}
                  className={[
                    'rounded-lg border p-2',
                    missing.includes(card.key)
                      ? 'border-amber-500/60 bg-slate-800'
                      : 'border-slate-700 bg-slate-800',
                  ].join(' ')}
                >
                  <div className="mb-1.5 text-xs font-semibold text-slate-200">
                    {cardLabel(card)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      data-entry-date={card.key}
                      aria-label={`${cardLabel(card)} · ${t('fleet.violations.fields.date')}`}
                      value={card.date}
                      onChange={(e) => patchCard(card.key, { date: e.target.value })}
                      className="w-40"
                      dir="ltr"
                    />
                    <div className="min-w-[10rem] flex-1 bg-white dark:bg-slate-900">
                      <OptionalEmployeeField
                        value={card.driverEmployeeId}
                        onChange={(id) => patchCard(card.key, { driverEmployeeId: id })}
                      />
                    </div>
                    <Input
                      data-entry-amount={card.key}
                      aria-label={`${cardLabel(card)} · ${t('fleet.violations.fields.amount')}`}
                      placeholder={t('fleet.violations.fields.amount')}
                      value={card.amount}
                      onChange={(e) => patchCard(card.key, { amount: e.target.value })}
                      className="w-24"
                      dir="ltr"
                      inputMode="decimal"
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
              <span data-entered-count>
                {t('fleet.violations.enteredCount', { count: String(cards.length) })}
              </span>
              <span data-entered-total className="tabular-nums">
                {formatMoney(entryTotal(cards), 'EGP', locale)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── what the board is showing ───────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <VehicleCodeFilter className="min-w-0" value={vehicleCodes} onChange={onVehicleCodesChange} />
        <div className="min-w-[12rem] flex-1">
          <OptionalEmployeeField value={driverEmployeeId} onChange={onDriverChange} />
        </div>
        <CatalogSelect
          kind="violationType"
          violationSide="driver"
          value={typeId}
          onChange={onTypeChange}
          ariaLabel={t('fleet.violations.pickType')}
          allLabel={t('fleet.violations.allTypes')}
        />
        <button
          type="button"
          data-driver-refresh="true"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          onClick={() => void list.refetch()}
          className="rounded-md bg-rose-800 p-2 text-white hover:bg-rose-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
        >
          <ResetIcon className="h-4 w-4" />
        </button>
        <span data-driver-count-badge className="text-lg font-bold text-brand-700 dark:text-brand-300">
          {formatNumber(meta?.totalItems ?? 0, locale)}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.isError ? list.error : undefined}
        onRetry={() => void list.refetch()}
        dense
        // Collected is a STATE OF THE ROW, so the row carries it — the tick is where you change
        // it, the tint is how the board reads at a glance.
        rowClassName={(row) =>
          row.collected ? 'bg-emerald-50 dark:bg-emerald-950/40' : undefined
        }
      />
      {meta !== undefined && meta.totalItems > 0 && (
        <>
          <table className="mt-2 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-t border-slate-200 dark:border-slate-800">
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                  {t('fleet.violations.lines.drivers')}
                </td>
                <td
                  data-driver-page-total
                  className="px-3 py-2 text-end text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200"
                >
                  {formatMoney(pageTotal, 'EGP', locale)}
                </td>
              </tr>
            </tbody>
          </table>
          <Pagination meta={meta} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
        </>
      )}
    </section>
  );
};
