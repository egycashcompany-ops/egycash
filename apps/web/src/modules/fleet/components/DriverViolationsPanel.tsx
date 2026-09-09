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
import { MAX_PAGE_SIZE, type FleetViolationDto, type Locale, type PageMeta } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  CheckIcon,
  EditIcon,
  TrashIcon,
  PrinterIcon,
  ResetIcon,
  DownloadIcon,
} from '../../../shared/ui/icons';
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
import { SideLayer } from '../../../shared/ui/SideLayer';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { FilterField } from '../../../shared/ui/FilterField';
import { RegistryDriverPicker } from './RegistryDriverPicker';
import { DebouncedInput } from '../../../shared/ui/DebouncedInput';
import { violationTypeColour } from '../lib/violation-type-colour';
import { cn } from '../../../shared/lib/cn';
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { VehicleSelect } from './VehicleSelect';
import { EmployeeName } from './EmployeeName';
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

// The filter bar's rhythm, shared by all four fields — see `FilterField` for why the name sits
// above the control and why every control is the same width.
const TIGHT = 'tight' as const;
/** `flex-1 basis-0` = an EQUAL share of the row; `min-w` keeps a field from collapsing past its name. */
const CELL = 'flex-1 basis-0 min-w-[6rem]';

export const DriverViolationsPanel = ({
  vehicleCodes,
  driverEmployeeIds,
  typeIds,
  amount,
  page,
  pageSize,
  onVehicleCodesChange,
  onDriverChange,
  onTypeChange,
  onAmountChange,
  onClear,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onDelete,
}: {
  vehicleCodes: string[];
  /** Several drivers at once — a supervisor asks about a crew, not about one person. */
  driverEmployeeIds: string[];
  typeIds: string[];
  /** «قيمة المخالفة» — an exact amount, as it is filed. '' = every amount. */
  amount: string;
  page: number;
  pageSize: number;
  onVehicleCodesChange: (next: string[]) => void;
  onDriverChange: (next: string | null) => void;
  onTypeChange: (next: string[]) => void;
  onAmountChange: (next: string | null) => void;
  /** Clear this half in ONE write — see the company panel for why it is not four setter calls. */
  onClear: () => void;
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
  const hasActiveFilters =
    vehicleCodes.length > 0 || driverEmployeeIds.length > 0 || typeIds.length > 0 || amount !== '';

  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
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
  /** Where each type sits in the catalog — what makes every colour on this board a different one. */
  const typeIndex = useMemo(() => {
    const map = new Map<string, number>();
    types.forEach((type, i) => map.set(type.id, i));
    return map;
  }, [types]);
  /** The filter's vocabulary IS the counters' vocabulary — one catalog, read once. */
  const typeOptions = useMemo(
    () => types.map((type) => ({ value: type.id, label: type.name })),
    [types],
  );

  // ── the counting bar ──────────────────────────────────────────────────────
  // The car is held as an ID, because it is PICKED. It used to be the typed code, resolved
  // through `idOf` on every render — which meant a code no car carries produced `undefined` and
  // a permanently disabled Save, with nothing on screen saying why.
  const [formVehicleId, setFormVehicleId] = useState('');
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

  const missing = incompleteCards(cards);
  const canSave = mayRecord && formVehicleId !== '' && entryComplete(cards) && !record.isPending;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    try {
      await record.mutateAsync(toBatchPayload(formVehicleId, cards));
      // Only on success: the batch is atomic, so a failure leaves the bar exactly as it was and
      // the reader re-tries the same stack rather than working out what got through.
      setCounts({});
      setCards([]);
      setFormVehicleId('');
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
      // `driverEmployeeId`, singular, is the parameter's NAME — it takes a comma-separated list.
      // It used to be sent as `driverEmployeeIds`, which the strict query schema rejected, so every
      // use of this filter answered 400 and emptied the board.
      ...(driverEmployeeIds.length === 0 ? {} : { driverEmployeeId: driverEmployeeIds.join(',') }),
      ...(amount.trim() === '' ? {} : { amount: amount.trim() }),
      ...(typeIds.length === 0 ? {} : { violationTypeId: typeIds.join(',') }),
    }),
    [page, pageSize, vehicleCodes, driverEmployeeIds, typeIds, amount],
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
        formatNumber(
          (meta === undefined ? 0 : (meta.page - 1) * meta.pageSize) + index + 1,
          locale,
        ),
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
      // A CHIP, not text: four kinds of fine in one grey column mean reading every row to see the
      // shape of a day. The name is still written on it — the colour is a hint, never the identity.
      render: (row) => (
        <span
          data-violation-type-chip={row.violationTypeId}
          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${violationTypeColour(row.violationTypeId, { index: typeIndex.get(row.violationTypeId) })}`}
        >
          {typeName.get(row.violationTypeId) ?? '—'}
        </span>
      ),
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
        subtitle:
          vehicleCodes.length === 0 ? t('fleet.violations.allVehicles') : vehicleCodes.join(', '),
        header: exportHeader,
        rows: exportRows(),
        totals: [
          {
            label: t('fleet.violations.lines.drivers'),
            value: formatMoney(pageTotal, 'EGP', locale),
          },
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
      className="flex min-h-0 min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="mb-4 text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
        {t('fleet.violations.driverTitle')}
      </h2>

      <div className="mb-3 flex items-start gap-3">
        {/* Listed LAST so an RTL row draws it on the LEFT — see the company panel for the note. */}
        <div className="order-last flex shrink-0 flex-col gap-1">
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
          className="flex min-w-0 flex-1 items-end gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50"
        >
          <Field label={t('fleet.odometer.columns.vehicle')}>
            {/* PICKED from the registry, exactly as the company half picks it. A typed code is a
                code no car may carry, and this bar files a stack of fines against it in one
                transaction — so a typo was a whole batch refused for a reason the reader could
                only find by re-reading their own typing. */}
            <div className="w-36">
              <VehicleSelect
                value={formVehicleId}
                onChange={setFormVehicleId}
                anyStatus
                fullWidth
                testId="driver-entry"
                ariaLabel={t('fleet.odometer.columns.vehicle')}
              />
            </div>
          </Field>
          {types.map((type) => (
            <Field key={type.id} label={type.name}>
              <Input
                data-driver-count={type.id}
                aria-label={type.name}
                value={String(counts[type.id] ?? 0)}
                onChange={(e) => setCount(type.id, e.target.value)}
                // Its own colour, the same one its rows and its cards carry, so counting «عكس»
                // here and reading «عكس» on the board below are visibly the same subject.
                // Through `tone`, NOT `className`: passed as a class it landed beside the
                // control's own `bg-white` and lost, so every counter rendered plain white while
                // the source said otherwise.
                tone={violationTypeColour(type.id, { index: typeIndex.get(type.id) })}
                className="w-20"
                dir="ltr"
                inputMode="numeric"
              />
            </Field>
          ))}
          {/* NO Save here any more. Counting opens the layer, and the layer is where each fine is
              named and filed — a Save on this bar could only ever be the disabled twin of the one
              beside the cards it depends on, which is precisely the button that told a reader
              nothing about why it would not work. */}
        </div>
      </div>

      {/* ── name what was counted ─────────────────────────────────────────── */}
      <SideLayer
        open={cards.length > 0}
        onClose={() => {
          setCounts({});
          setCards([]);
        }}
        side="right"
        // As wide as the ledger it covers, because the card below needs a whole row for the three
        // things a fine is: the day, the person, and the money.
        width="half"
        // NON-MODAL, which is what makes «five عكس and two حزام» possible at all. This opens the
        // instant the first counter is typed into, and while it was a dialog it covered the very
        // counters the reader still had to use — so a stack of mixed fines could only be entered
        // one KIND at a time. The counters stay live behind it now.
        modal={false}
        // Cards being filled in are unsaved work: a stray click on the board behind used to wipe
        // the lot. Escape and the two buttons are the ways out.
        dismissOnOutsideClick={false}
        title={t('fleet.violations.enteredTitle')}
        description={t('fleet.violations.enteredHint')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCounts({});
                setCards([]);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-driver-save="true"
              disabled={!canSave}
              loading={record.isPending}
              onClick={() => void save()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div data-entered-panel="true">
          {cards.length === 0 ? (
            <p data-entered-empty className="py-4 text-center text-xs text-slate-400">
              {t('fleet.violations.enteredEmpty')}
            </p>
          ) : (
            <>
              {/* NO scroll box of its own. This was `max-h-72 overflow-y-auto`, a 288px window
                  nested inside the drawer's own scroller — and an `overflow` ancestor CLIPS the
                  absolutely-positioned dropdown of the driver picker inside each card, so the
                  list of names opened into a sliver and the control was unusable for the one
                  thing it is there for. The drawer already scrolls; one scrollbar is also the
                  better read. */}
              <ul className="space-y-2">
                {cards.map((card) => (
                  <li
                    key={card.key}
                    data-entry-card={card.key}
                    data-entry-incomplete={missing.includes(card.key) ? 'true' : undefined}
                    // THE CARD WEARS ITS TYPE'S COLOUR — «كل مخالفة بباك جراوند مختلف». A stack of
                    // seven cards of two kinds was seven identical grey boxes told apart only by
                    // reading each heading; the colour is the one its counter above and its row
                    // below already carry, so one fine is visibly one subject all the way through.
                    // An INCOMPLETE card keeps its amber ring on top: «this will not save» has to
                    // outrank «this is a speeding fine».
                    className={cn(
                      'rounded-lg border p-2',
                      violationTypeColour(card.typeId, { index: typeIndex.get(card.typeId) }),
                      missing.includes(card.key) && 'border-amber-500 ring-1 ring-amber-500/60',
                    )}
                  >
                    <div className="mb-1.5 text-xs font-semibold">{cardLabel(card)}</div>
                    {/* THE THREE THINGS A FINE IS, on one row: the day, the person, the money.
                        They used to wrap onto three lines because the layer was 512px wide and the
                        date alone asked for 160 of it. The layer is now the width of the ledger it
                        covers, so the row fits — `min-w-0` on the middle field is what lets the
                        driver's name truncate instead of pushing the money off the end. */}
                    <div className="flex flex-nowrap items-center gap-2">
                      {/* The width is on the WRAPPER. `Input` carries its own `w-full` and `cn`
                          is a plain joiner, so a `w-36` handed to it loses — measured, the date
                          rendered 750px and squeezed the driver beside it to 26. */}
                      <div className="w-36 shrink-0">
                        <Input
                          type="date"
                          data-entry-date={card.key}
                          aria-label={`${cardLabel(card)} · ${t('fleet.violations.fields.date')}`}
                          value={card.date}
                          onChange={(e) => patchCard(card.key, { date: e.target.value })}
                          dir="ltr"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        {/* The REGISTRY, not the payroll: the server files a fine only against a
                            person who HAS a driver profile, so offering anyone else was offering a
                            400 the reader could do nothing about — «بعض الحقول تحتاج إلى مراجعة»
                            about the one field they had filled correctly. */}
                        {/* ONE driver, never several: a fine belongs to a person. `multiple` is
                            off by default, and `fullWidth` is what makes the trigger fill the
                            share of the row it was given instead of shrinking to its own text. */}
                        <RegistryDriverPicker
                          value={card.driverEmployeeId === '' ? [] : [card.driverEmployeeId]}
                          onChange={(next) =>
                            patchCard(card.key, { driverEmployeeId: next[0] ?? '' })
                          }
                          fullWidth
                          className="w-full"
                        />
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          data-entry-amount={card.key}
                          aria-label={`${cardLabel(card)} · ${t('fleet.violations.fields.amount')}`}
                          placeholder={t('fleet.violations.fields.amount')}
                          value={card.amount}
                          onChange={(e) => patchCard(card.key, { amount: e.target.value })}
                          dir="ltr"
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {/* WHY SAVE IS OFF, in words. The button used to sit dead beside an amber border and
                nothing else: a reader who had typed a date and an amount had no way to learn that
                the driver — a field that only fills by PICKING a name from its search — was still
                empty. Naming the incomplete cards is the whole difference between a form that
                refuses and a form that explains. */}
              {missing.length > 0 && (
                <p
                  data-entry-blocked
                  role="status"
                  className="mt-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200"
                >
                  {t('fleet.violations.entryIncomplete', { count: String(missing.length) })}
                </p>
              )}
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
      </SideLayer>

      {/* ── what the board is showing ────────────────────────────────────
          FOUR filters, each with its NAME above it and all four the same width — the same shape
          the drivers registry settled on (`FilterField`). What was here before was four controls
          that each sized themselves: a car picker that grew with the codes ticked into it, a
          driver picker pinned to 11rem, a `<select>` as wide as «مخالفة مرورية» happened to be,
          and a 6rem money box — four heights of question written INSIDE four different widths,
          with a bare number floating after them. Nothing said which of them was set.

          `flex-1 basis-0` is what makes them equal: the share of the row a control gets no longer
          depends on how long its own words are. And with the question written above, each control
          only has to hold an ANSWER — «الكل», a code, a name — which is short. */}
      <FilterBar
        singleRow
        singleRowFrom={1280}
        trailing={
          <>
            {/* CLEARS this half's filters — it called `refetch()` before, which changed nothing a
                reader could see. See the company panel for the full note. Rendered here rather
                than through `FilterBar`'s own `onClear` so the button keeps the hook the tests
                press it by. */}
            {hasActiveFilters && (
              <button
                type="button"
                data-driver-clear="true"
                aria-label={t('common.filters.clear')}
                title={t('common.filters.clear')}
                onClick={onClear}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
              >
                <ResetIcon className="h-4 w-4" />
              </button>
            )}
            {/* HOW MANY the bar just matched — beside the question, not inside the table. */}
            <span
              data-driver-count-badge
              role="status"
              title={t('fleet.violations.matchedCount')}
              className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {formatNumber(meta?.totalItems ?? 0, locale)}
            </span>
          </>
        }
      >
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
        {/* SEVERAL drivers, picked by name or code — the same control the drivers registry uses, so
            an operator who knows one knows this one. It replaced a single-value search box that
            was both narrower than the question and, sending the wrong parameter name, broken. */}
        <FilterField
          label={t('fleet.violations.fields.driver')}
          active={driverEmployeeIds.length > 0}
          className={CELL}
        >
          <RegistryDriverPicker
            value={driverEmployeeIds}
            onChange={(next) => onDriverChange(next.length === 0 ? null : next.join(','))}
            multiple
            placeholder={t('common.filters.all')}
            density={TIGHT}
            fullWidth
            className="w-full"
          />
        </FilterField>
        {/* The NOUN. «اختر نوع المخالفة» is an instruction, and an instruction reads wrong as
            the name of a filter — a bar's labels say WHAT each column asks about, not what to do
            about it. The imperative still belongs inside the control, as its empty row. */}
        <FilterField
          label={t('fleet.violations.fields.type')}
          active={typeIds.length > 0}
          className={CELL}
        >
          {/* SEVERAL kinds at once. A clerk reconciling a stack asks «speeding and seatbelt», and
              a single-value dropdown made them ask twice and add the two answers up by hand. The
              options are the driver side of the live catalog — the same list the counters above
              are built from, so the bar filters by exactly what it can file. */}
          <MultiSelect
            label={t('fleet.violations.fields.type')}
            placeholder={t('common.filters.all')}
            options={typeOptions}
            value={typeIds}
            onChange={onTypeChange}
            showSelectedValues
            chips
            searchThreshold={0}
            density={TIGHT}
            fullWidth
            className="w-full"
          />
        </FilterField>
        <FilterField
          label={t('fleet.violations.fields.amount')}
          active={amount !== ''}
          className={CELL}
        >
          <DebouncedInput
            aria-label={t('fleet.violations.fields.amount')}
            title={t('fleet.violations.fields.amount')}
            value={amount}
            onValueChange={(next) => onAmountChange(next || null)}
            dir="ltr"
            inputMode="decimal"
            density={TIGHT}
          />
        </FilterField>
      </FilterBar>

      {/* The BOARD scrolls, not the page — the filters above it and the totals below it stay put,
          which is what makes this half readable beside the other one. */}
      <div className="min-h-0 flex-1 overflow-auto">
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
      </div>
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
