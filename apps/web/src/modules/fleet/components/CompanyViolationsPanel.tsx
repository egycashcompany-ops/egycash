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
import { type FleetViolationRollupDto, type Locale } from '@ecms/contracts';
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
  useMoveViolations,
  useRecordVehicleViolation,
  useSetRollupCollected,
  useViolationRollup,
} from '../api/fleet-queries';
import { VIOLATION_DRAG_TYPE, canReceive, readDraggedIds } from '../lib/violation-drag';
import { CatalogSelect } from './CatalogSelect';
import { VehicleCodeCombobox } from './VehicleCodeCombobox';
import { VehicleCodeFilter } from './VehicleCodeFilter';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
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
  years,
  vehicleCodes,
  settled,
  entryVehicleId,
  onEntryVehicleChange,
  onMoved,
  onYearsChange,
  onSettledChange,
  onVehicleCodesChange,
  onClear,
  onInspect,
}: {
  /**
   * The years being looked at. EMPTY = every year: the board is read as a history, so no year is
   * a real answer — and SEVERAL is an ordinary question, «٢٠٢٥ جنب ٢٠٢٦», which one year at a
   * time made into two readings of the board («اى فلتر ف الحركه زياده عن اتنين ... multi
   * selection»).
   */
  years: readonly string[];
  vehicleCodes: string[];
  /** '' = both, 'true' = fully settled, 'false' = anything still outstanding. */
  settled: string;
  /**
   * THE CAR BOTH ENTRY BARS ARE FILING AGAINST — one pick, both halves.
   *
   * «لما احدد كود عربيه يتحدد فى التانيه تلقائى». A clerk works a car at a time: the company's
   * statement and that car's drivers' fines are the same sitting, and picking 150 twice — once on
   * each side of the screen — was two chances to pick two different cars and file half a sitting
   * against the wrong one.
   *
   * It is the entry bars' car and ONLY theirs. The two boards keep their own filters, on purpose:
   * they are read side by side precisely so they can disagree.
   */
  entryVehicleId: string;
  onEntryVehicleChange: (next: string) => void;
  /**
   * Fines were carried onto a group here. The drivers' half owns the ticks that named them, and a
   * selection that survived the move would still be pointing at rows the reader has finished with.
   */
  onMoved: () => void;
  onSettledChange: (next: string | null) => void;
  onYearsChange: (next: string[]) => void;
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
  const hasActiveFilters = years.length > 0 || vehicleCodes.length > 0 || settled !== '';

  const thisYear = new Date().getFullYear();
  /** The years this screen OFFERS — the filter's options and the form's, not what is chosen. */
  const offeredYears = useMemo(
    () => Array.from({ length: YEAR_SPAN }, (_, i) => thisYear - i),
    [thisYear],
  );

  /*
   * EVERY CAR THE PICKER HOLDS, not the one the endpoint used to take.
   *
   * The rollup accepted a single `vehicleId`, so this resolved a lone picked code and sent
   * NOTHING the moment a second was picked: the chips read «١٥٠، ١٥١ +٢» while the table answered
   * for the whole fleet. A filter that silently stops filtering is worse than one that refuses,
   * because the reader has no way to tell the two apart.
   *
   * The codes travel as codes and are resolved server-side, as on every other board — which is
   * also what keeps a (code, year) from the old book, on a car the registry never had, reachable
   * by the code the book wrote.
   */
  const codesKey = vehicleCodes.join(',');
  const askedCodes = useMemo(
    () => (vehicleCodes.length === 0 ? undefined : vehicleCodes),
    [codesKey],
  );

  const yearNumbers = useMemo(() => years.map((y) => Number(y)), [years.join(',')]);
  const rollup = useViolationRollup(
    yearNumbers.length === 0 ? undefined : yearNumbers,
    askedCodes,
  );
  // «الحالة», applied IN HAND. The rollup arrives whole — that is what lets this half count its
  // own groups — so narrowing it here asks the server nothing extra and keeps the totals below
  // agreeing with the rows above, which a server-side page could not promise.
  //
  // A group is SETTLED when every row in it is ticked. «Some of them» is not settled: a year with
  // one fine outstanding is a year somebody still has to chase.
  const allRows = rollup.data ?? [];
  const rows =
    settled === ''
      ? allRows
      : allRows.filter((row) => {
          // `rowCount === 0` is a year whose only fines were the DRIVERS' — there is nothing here
          // for the company to collect, so it is neither outstanding nor settled and belongs to
          // neither half of this filter. It is still shown when «الكل» is chosen.
          if (row.rowCount === 0) return false;
          const done = row.collectedCount === row.rowCount;
          return settled === 'true' ? done : !done;
        });

  // ── the entry bar ─────────────────────────────────────────────────────────
  const [formYear, setFormYear] = useState(String(thisYear));
  // The car is now held as an ID, because it is PICKED rather than typed — there is no longer a
  // code to resolve, and so no longer a way to have typed one that resolves to nothing. It is
  // held by the PAGE, because the drivers' bar files against the same car — see the prop.
  const formVehicleId = entryVehicleId;
  const setFormVehicleId = onEntryVehicleChange;
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

  // What the export and the print sheet SAY they cover. Several years read as «٢٠٢٤، ٢٠٢٥» —
  // the same words the trigger shows — so a printed sheet names exactly the filter it was made
  // under rather than the first year of it.
  const scope = `${years.length === 0 ? t('fleet.violations.allYears') : years.join('، ')}${
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

  /*
   * FINES DROPPED ON A GROUP — «أخدهم دراج وأحطهم دروب على العربية نفسها».
   *
   * What moves is which statement the fines are COUNTED on; their dates, their drivers, their
   * amounts and whether the money is in are all left as they are, and they go on showing in the
   * drivers' board on the day they happened. That is «يتنقلوا بس مش هيحصل عليهم حاجه».
   *
   * `dragging` is the group under the pointer, held so the board can show WHERE a drop would land.
   * It is counted rather than set/cleared, because `dragleave` fires every time the pointer
   * crosses between the four rows inside a group and a naive clear would blink the highlight off
   * mid-hover.
   */
  const [over, setOver] = useState<string | null>(null);
  const move = useMoveViolations();
  const mayMove = can('fleetViolation.edit');
  const keyOfGroup = (row: FleetViolationRollupDto): string =>
    `${row.vehicleId ?? `code:${row.code}`}:${row.year}`;

  const drop = async (row: FleetViolationRollupDto, raw: string): Promise<void> => {
    setOver(null);
    const ids = readDraggedIds(raw);
    if (ids.length === 0 || row.vehicleId === null) return;
    try {
      const { moved } = await move.mutateAsync({
        ids,
        vehicleId: row.vehicleId,
        filedYear: row.year,
      });
      toast.success(
        t('fleet.violations.movedToYear', {
          count: formatNumber(moved, locale),
          code: row.code,
          year: String(row.year),
        }),
      );
      onMoved();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const collectGroup = useSetRollupCollected();
  /** A group is settled only when EVERY row in it is, so the tick asks for the state it is not in. */
  const toggleYear = async (row: FleetViolationRollupDto): Promise<void> => {
    // A group from the old book on a car the registry never had has no vehicle to tick by; it is
    // read-only on the board, as its rows are.
    if (row.vehicleId === null) return;
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
        {/* ONE LINE FROM `md` UP, AND IT NEVER SCROLLS SIDEWAYS. Two earlier shapes were both
            wrong and both were tried: `overflow-x-auto` hid «العدد» and the total behind a
            scrollbar inside a form, and `flex-wrap` + `[&>*]:shrink-0` broke the statement over
            five lines in a half-width panel — a statement row reads as one sentence and the owner
            asked for it back on one line, with no sideways scroll.

            So the fields SHARE the width instead of claiming it. Each is `flex-… basis-0`,
            weighted by how much text it has to show (a violation type is the longest, «العدد» the
            shortest), over a `min-w-[…]` floor so compression stops while the value is still
            readable. `density="tight"` buys back 8px of side gutter per control and `gap-1.5`
            another 14px across the row, which is most of the margin this row has.

            The floors are sized for the WORST case, which is 1536 — the width at which the screen
            splits into two ledgers, giving this one the narrowest bar it ever gets (~510px of
            content). The floors and gaps come to ~491px there, so the row fits with a little to
            spare and every wider screen hands out slack through the weights.

            Below `md` it WRAPS instead. Eight controls cannot be one legible line on a phone, and
            of the two ways to not fit, a second line is visible and a scrolled-away field is not.

            The floor is the load-bearing part and is stated ONCE per field: a flex child defaults
            to `min-width:auto` and refuses to shrink below its content, which is exactly how this
            row overflowed its panel before. A single `min-w-[…]` both lifts that default and sets
            where compression stops — pairing it with `min-w-0` would put two `min-width` rules on
            one element and leave which of them wins to Tailwind's emission order (`cn` is a plain
            joiner, so both would ship). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 md:flex-nowrap dark:border-slate-700 dark:bg-slate-800/50">
          <Field
            label={t('fleet.violations.fields.year')}
            // «كبر السنه حاجه بسيطه بحيث تكون ءد الاربع ارقام» — and the floor here is MEASURED,
            // not chosen. «2026» is 35.6px of text in this face, the tight select's own padding
            // takes 32px and its borders 2px, so the box needs 69.6px before the digits stop
            // fighting the chevron. At the old 3.5rem floor it had 56px, leaving 24px of room for
            // 35.6px of digits — which is what the owner photographed. 4.5rem is the smallest
            // round floor above what the measurement asks for.
            className="flex-[1] basis-0 min-w-[4.5rem]"
          >
            {/* The width is on the WRAPPER, not the control: `cn` is a plain joiner, so a width
                handed to `Select` sits beside its own `w-full` and loses — measured, the year
                rendered 86px wide however large a class it was given. The wrapper now fills the
                share the field was given rather than naming a fixed size. */}
            <div className="w-full">
              <Select
                aria-label={t('fleet.violations.fields.year')}
                data-company-form="year"
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
                density="tight"
              >
                {offeredYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field
            label={t('fleet.odometer.columns.vehicle')}
            required
            // «كبر كود العربيه شويه».
            className="flex-[1.3] basis-0 min-w-[4.25rem]"
          >
            {/* PICKED, not typed. A typed code that matches no car left `formVehicleId` undefined,
                which disabled Save with nothing on screen to say why — the commonest way this form
                refused to file a statement anybody had filled in correctly. One car at a time,
                because a statement row belongs to one car. */}
            <div className="w-full">
              <VehicleCodeCombobox
                value={formVehicleId}
                onChange={setFormVehicleId}
                anyStatus
                density="tight"
                testId="company-entry"
                ariaLabel={t('fleet.odometer.columns.vehicle')}
              />
            </div>
          </Field>
          {/* The NOUN above, the imperative inside. `Field` already renders its label and a
              required marker, so labelling it «اختر نوع المخالفة» printed the same sentence twice,
              stacked — once as the field's name and once as the empty row of its own select. */}
          <Field
            label={t('fleet.violations.fields.type')}
            required
            // The floor came down again, and for the same reason it came down the first time:
            // the year's measured floor had to come from somewhere, and at 1536 every choice in
            // this select is already truncated — so what changes is how much of a sentence is
            // cut, not whether a value can be read. Its SHARE is untouched, so at any width with
            // slack to hand out this is still the widest field on the row.
            className="flex-[2] basis-0 min-w-[4.25rem]"
          >
            {/* company side ONLY — the server refuses a driver type here, so offering one would
                be offering a 422 the reader can do nothing about.

                `requireChoice` makes the placeholder a DISABLED row: it still says what the
                control is for while it is empty, but it can no longer be chosen back, so «no
                type» stops being one of the answers on a field that has no such answer. */}
            <div className="w-full">
              <CatalogSelect
                kind="violationType"
                violationSide="company"
                value={formType}
                onChange={setFormType}
                ariaLabel={t('fleet.violations.pickType')}
                allLabel={t('fleet.violations.pickType')}
                requireChoice
                density="tight"
                className="w-full"
              />
            </div>
          </Field>
          <Field
            label={t('fleet.violations.fields.unitValue')}
            // «وهتقلل شويه صغيره من قيمة الوحدة و العدد». A typed MONEY figure — «1250.50» is
            // seven characters — so it keeps most of what it was given last round and hands a
            // little of it back to the year and the code.
            className="flex-[1.38] basis-0 min-w-[3.5rem]"
          >
            <div className="w-full">
              <Input
                data-company-form="value"
                aria-label={t('fleet.violations.fields.unitValue')}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                dir="ltr"
                inputMode="decimal"
                density="tight"
              />
            </div>
          </Field>
          <span className="shrink-0 pb-2 text-sm font-medium text-slate-400">×</span>
          <Field
            label={t('fleet.violations.fields.count')}
            // «و العدد». Typed too, and still well clear of the 42px it used to compress to.
            className="flex-[1.12] basis-0 min-w-[3rem]"
          >
            <div className="w-full">
              <Input
                data-company-form="count"
                aria-label={t('fleet.violations.fields.count')}
                value={formCount}
                onChange={(e) => setFormCount(e.target.value)}
                dir="ltr"
                inputMode="numeric"
                density="tight"
              />
            </div>
          </Field>
          {/* What this line will cost, before it is filed. The server owns the real arithmetic
              (count × unitValue) and this only mirrors it, so it shows a figure ONLY when both
              halves are valid — a total computed from a half-typed number is a wrong number, and a
              wrong number beside a Save button is worse than none. */}
          <Field
            label={t('fleet.violations.fields.amount')}
            // THE WIDEST SHARE AND THE HIGHEST FLOOR, because this is the one cell that must never
            // lie. It was `flex-[1.1]` over a 4rem floor with `truncate`, and at the 2xl split a
            // real figure — 112,500.00 — needed 140px in a 62px box, so the board silently showed
            // a cut-off number beside a Save button. A truncated amount is not a smaller amount;
            // it is a different one.
            className="flex-[1.6] basis-0 min-w-[5.5rem]"
          >
            <output
              data-company-form-total
              title={
                isMoney && isCount
                  ? formatMoney(Number(formValue) * Number(formCount), 'EGP', locale)
                  : undefined
              }
              className={[
                'block w-full truncate rounded-md border px-2 py-1.5 text-center text-sm font-semibold tabular-nums',
                isMoney && isCount
                  ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200'
                  : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900',
              ].join(' ')}
            >
              {/* The figure alone: every amount on this screen is EGP and the cell is labelled
                  «المبلغ», so the currency word was spending a third of a cell that had none to
                  spare. The full formatted figure stays on `title` for the reader who wants it. */}
              {isMoney && isCount
                ? formatNumber(Number(formValue) * Number(formCount), locale)
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
              className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-sm font-medium tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {formatNumber(rows.length, locale)}
            </span>
          </>
        }
      >
        <FilterField
          label={t('fleet.violations.fields.year')}
          active={years.length > 0}
          className={CELL}
          density={TIGHT}
        >
          {/* SEVERAL years at once. Comparing two years is the commonest thing asked of this
              ledger, and a one-answer dropdown made the comparison something the reader held in
              their head between two loads. */}
          <MultiSelect
            label={t('fleet.violations.fields.year')}
            placeholder={t('common.filters.all')}
            options={offeredYears.map((y) => ({ value: String(y), label: String(y) }))}
            value={years}
            onChange={onYearsChange}
            showSelectedValues
            chips
            searchThreshold={0}
            density={TIGHT}
            fullWidth
            className="w-full"
          />
        </FilterField>
        <FilterField
          label={t('fleet.violations.columns.settledState')}
          active={settled !== ''}
          className={CELL}
          density={TIGHT}
        >
          <Select
            aria-label={t('fleet.violations.columns.settledState')}
            data-company-settled
            value={settled}
            onChange={(e) => onSettledChange(e.target.value || null)}
            density={TIGHT}
          >
            <option value="">{t('common.filters.all')}</option>
            <option value="true">{t('fleet.violations.settled')}</option>
            <option value="false">{t('fleet.violations.outstanding')}</option>
          </Select>
        </FilterField>
        <FilterField
          label={t('fleet.vehicles.fields.code')}
          active={vehicleCodes.length > 0}
          className={CELL}
          density={TIGHT}
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
              {/* A sticky head is drawn OVER the rows, so it has to be opaque. `bg-slate-800/60`
                  let them through it — «راس الجدول بايظ المفروض ميكونش شفاف». */}
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className={head}>{t('fleet.violations.fields.year')}</th>
                  <th className={head}>{t('fleet.odometer.columns.vehicle')}</th>
                  <th className={head}>{t('fleet.violations.columns.totals')}</th>
                  <th className={head}>{t('fleet.violations.columns.totalCount')}</th>
                  <th className={head}>{t('fleet.violations.fields.amount')}</th>
                  <th className={head}>{t('fleet.violations.edit')}</th>
                </tr>
              </thead>
              {rows.map((row) => (
                // One tbody per (vehicle, year): the group is the unit, and the browser keeps its
                // four lines together when the board is printed or scrolled.
                <tbody
                  key={`${row.vehicleId ?? `code:${row.code}`}:${row.year}`}
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
                  // WHERE THE DRAGGED FINES WOULD LAND. The guard is in the code and not only in
                  // the styling: withholding `preventDefault` on dragover is what actually refuses
                  // a drop, and a group from the old book — no car in the registry, so no id any
                  // write accepts — must refuse rather than promise a 422.
                  onDragOver={
                    canReceive(row, mayMove)
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setOver(keyOfGroup(row));
                        }
                      : undefined
                  }
                  onDragLeave={
                    canReceive(row, mayMove)
                      ? (e) => {
                          // Only when the pointer has left the GROUP, not when it crosses between
                          // the four rows inside it.
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                            setOver((at) => (at === keyOfGroup(row) ? null : at));
                          }
                        }
                      : undefined
                  }
                  onDrop={
                    canReceive(row, mayMove)
                      ? (e) => {
                          e.preventDefault();
                          void drop(row, e.dataTransfer.getData(VIOLATION_DRAG_TYPE));
                        }
                      : undefined
                  }
                  data-rollup-droppable={canReceive(row, mayMove) ? 'true' : undefined}
                  className={cn(
                    'border-t border-slate-200 dark:border-slate-800',
                    row.rowCount > 0 &&
                      row.collectedCount === row.rowCount &&
                      'bg-emerald-50 dark:bg-emerald-950/40',
                    over === keyOfGroup(row) &&
                      'outline outline-2 -outline-offset-2 outline-brand-500',
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
