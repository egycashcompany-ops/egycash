// «مذكرة جديدة» / «تعديل المذكرة» — a custody memo, written beside the paper it prints on.
//
// «لما ادوس عليه اقدر اختار من الاربع صيانة او وقود او كاوتش او غسيل … واقدر احدد من كل واحده ب
// سيلكت»: the kind first (the receipt form's switch, each kind with how many of its receipts wait
// for a memo), then «اسم المذكرة» (optional — the screens' and the PDF file's name, never printed),
// the period and the memo's date, then that kind's custody receipts no memo holds yet, each with
// its round «علامة صح». «عاوز احدد العربيات اسمحلى افلتر ب كود العربيه»: the app's own «كود
// السيارة» filter over the list — the memo is the ticked receipts ON SHOW; a tick the filter hides
// is kept, not counted (`lib/custody-memo-editor.ts`). A fuel line takes «المأمورية» (the roster's
// mission proposed) and «ملاحظات»; a maintenance line «البيان» and «ملاحظات».
//
// Beside the form, his paper of the kind with exactly the lines picked — the licence-expense
// editor's layout. Under the form, kept in view, what is picked and its total, «حفظ المذكرة» and
// «حفظ وطباعة» — the print tab opened first, inside the press, the paper printed from the SAVED
// memo. Nothing is required but a receipt; pressing Save without one names it and marks the list.
//
// A memo the fund has replenished («استعاضة عهدة») opened by its address is read, not written: the
// page says when, the form cannot change, and there is no Save — its paper still shows and prints.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  FLEET_CUSTODY_SOURCES,
  type FleetCustodyMemoCandidateDto,
  type FleetCustodyMemoDto,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySource,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import {
  useCreateCustodyMemo,
  useCustodyMemo,
  useCustodyMemoCandidates,
  useCustodyMemosOutside,
  useCustodyPaperSettings,
  useUpdateCustodyMemo,
} from '../api/fleet-queries';
import { DesignSave } from '../components/DesignDialog';
import { DesignField, LOOK, MONO, SANS, boxTone } from '../components/FuelCardDialog';
import { PATH, ymd } from '../components/FuelCardBoard';
import { CUSTODY_KIND } from '../components/CustodyKinds';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { DriverCell } from '../components/DriverPerson';
import { PaperTray, usePaperFonts } from '../components/CustodyPaperSheets';
import {
  CARD_BOX,
  DESIGN_BACK,
  DesignPageHeader,
  today,
} from '../components/LicenseExpensePaidGroup';
import {
  CodeChip,
  CountChip,
  Day,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  LEFT_ROW,
  MEMO_ICON,
  Money,
  PICKED_ROW,
  PrintButton,
  SectionHead,
  Tick,
} from '../components/custody-memo-parts';
import { memoFileName, memoPaperOf, memoSheets, printPaperAfter } from '../lib/custody-papers';
import { useCustodyCount } from '../lib/custody-words';
import {
  MEMO_MAX_LINES,
  type MemoPeriod,
  type MemoTyped,
  codeOptions,
  defaultMemoKind,
  editPeriodOf,
  headTick,
  memoBody,
  memoKindOf,
  memoRefusalOf,
  memoUpdateBody,
  monthOfDay,
  paperLinesOf,
  periodOf,
  pickedLines,
  pickedTotal,
  tickNewcomers,
  toggleAllShown,
  toggleOne,
  typedOf,
  visibleRows,
} from '../lib/custody-memo-editor';

const BOX = boxTone(LOOK.add);
// A date: `DesignField`'s `datePicker` draws its calendar and keeps both its ends clear.
const DATE_BOX = cn(BOX, MONO);
/**
 * The car box of the licence-expense editor and the transfer form (their `CAR_PICK`, not exported
 * there): the custody screen's «كود السيارة» multi-pick on the design's surface.
 */
const CAR_PICK = cn(
  '[&_button[aria-haspopup]]:!min-h-[3rem] [&_button[aria-haspopup]]:!rounded-xl [&_button[aria-haspopup]]:!border-slate-200 dark:[&_button[aria-haspopup]]:!border-[#2b3b6b] [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#0a1233] [&_button[aria-haspopup]]:!text-[15px] [&_button[aria-haspopup]]:!text-slate-900 dark:[&_button[aria-haspopup]]:!text-white',
  '[&_[role=listbox]]:!rounded-xl [&_[role=listbox]]:!border-slate-200 dark:[&_[role=listbox]]:!border-[#2b3b6b] [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#131d35]',
);
/** A count as the boards write one — Latin digits, grouped. */
const LATIN = new Intl.NumberFormat('en-US');
/** The `<datalist>` the fuel lines' «المأمورية» boxes offer. */
const MISSIONS_LIST = 'custody-memo-missions';
/** No bound at either end — the codes alone narrow what the period already let through. */
const OPEN_PERIOD: MemoPeriod = { from: '', to: '' };

type Kind = FleetCustodySource;

/**
 * The four kinds — the receipt form's switch (its tray, its purple), in the custody screen's order,
 * each with its dot and how many of its receipts wait for a memo. An edit keeps its memo's kind.
 */
const KindSwitch = ({
  value,
  onChange,
  outside,
  only,
}: {
  value: Kind;
  onChange: (kind: Kind) => void;
  outside: readonly FleetCustodyOutsideKindDto[] | undefined;
  /** An edit: the one kind that may be chosen. */
  only: Kind | null;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t('fleet.custody.memoEditor.kindSwitch')}
      data-memo-kinds="true"
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-inner dark:border-[#2b3b6b] dark:bg-[#0a1233]"
    >
      {FLEET_CUSTODY_SOURCES.map((kind) => {
        const on = value === kind;
        const waiting = outside?.find((line) => line.kind === kind)?.count;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={on}
            data-memo-kind={kind}
            disabled={only !== null && only !== kind}
            onClick={() => onChange(kind)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[15px] font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:px-4',
              on
                ? 'bg-brand-600 text-white shadow-md shadow-brand-700/30'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 rounded-full',
                CUSTODY_KIND[kind].dot,
                on && 'ring-2 ring-white/70',
              )}
            />
            {t(`fleet.custody.source.${kind}`)}
            {waiting !== undefined && (
              <span
                data-memo-kind-count={kind}
                className={cn(
                  'min-w-[1.5rem] rounded-full px-1.5 text-center text-[11px] leading-5',
                  MONO,
                  on
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200',
                )}
              >
                {LATIN.format(waiting)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const CustodyMemoEditorPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { picked: pickedPhrase, pickedCount } = useCustodyCount();
  const params = useParams<{ id?: string; kind?: string }>();
  const editingId = params.id ?? '';
  const editing = editingId !== '';
  const saved = useCustodyMemo(editingId);
  const outside = useCustodyMemosOutside();
  // A new memo prints with the set-up's names; an edit with the names it was saved with.
  const settings = useCustodyPaperSettings(!editing);
  const create = useCreateCustodyMemo();
  const update = useUpdateCustodyMemo();

  const routeKind = memoKindOf(params.kind);
  const kind: Kind | null = editing ? (saved.data?.kind ?? null) : routeKind;
  // «مذكرة جديدة» with no kind (or no such kind) in its address: the first kind with receipts
  // waiting, in the custody screen's order — none waiting, صيانة. Replaced, so Back leaves the page.
  useEffect(() => {
    if (editing || routeKind !== null) return;
    if (outside.data === undefined && !outside.isError) return;
    navigate(`/fleet/custody/memos/new/${defaultMemoKind(outside.data)}`, { replace: true });
  }, [editing, routeKind, outside.data, outside.isError]);

  const candidates = useCustodyMemoCandidates(
    editing ? { kind: kind ?? 'maintenance', memoId: editingId } : { kind: kind ?? 'maintenance' },
    kind !== null,
  );
  const receipts = candidates.data?.receipts;

  // Each kind keeps its own draft while the switch moves between them: its name, its period (once
  // touched — until then it follows the waiting receipts), its chosen cars.
  const [names, setNames] = useState<Partial<Record<Kind, string>>>({});
  const [periods, setPeriods] = useState<Partial<Record<Kind, MemoPeriod>>>({});
  const [codes, setCodes] = useState<Partial<Record<Kind, string[]>>>({});
  const [date, setDate] = useState(today());
  // The ticks, by receipt — and which receipts were already seen, so one that turns up later is
  // ticked (new memo) or left alone (edit) without touching what the reader made of the others.
  const [ticks, setTicks] = useState<{ seen: ReadonlySet<string>; ticked: ReadonlySet<string> }>(
    () => ({ seen: new Set(), ticked: new Set() }),
  );
  // What was typed on each line — absent until something is: a line then proposes its own.
  const [typed, setTyped] = useState<Record<string, MemoTyped>>({});

  // An edit fills the form from the memo itself, once, while rendering — so the very first paint
  // is the memo, not an empty form; a refused save (changed elsewhere) fills it again from what
  // the server holds now.
  const [filledFor, setFilledFor] = useState<string | null>(null);
  // The version the form was filled from — NOT the live query's, which realtime refetches: a save
  // carries what the form shows was read, so a memo changed elsewhere meanwhile is a stale 409
  // (and the form fills again) instead of a silent overwrite of the other change.
  const [filledVersion, setFilledVersion] = useState(0);
  const fill = (memo: FleetCustodyMemoDto): void => {
    setFilledFor(memo.id);
    setFilledVersion(memo.version);
    setNames({ [memo.kind]: memo.name });
    setPeriods({ [memo.kind]: editPeriodOf(memo) });
    setCodes({});
    setDate(memo.date);
    setTyped(
      Object.fromEntries(
        memo.lines.map((line) => [
          line.receiptId,
          { mission: line.mission, statement: line.statement, note: line.note },
        ]),
      ),
    );
    setTicks({ seen: new Set(), ticked: new Set(memo.lines.map((line) => line.receiptId)) });
  };
  const memo = saved.data;
  if (memo !== undefined && filledFor !== memo.id) fill(memo);
  const filled = !editing || (memo !== undefined && filledFor === memo.id);

  const rows: readonly FleetCustodyMemoCandidateDto[] = useMemo(() => receipts ?? [], [receipts]);
  // The ticks as they stand: what the reader made of each receipt seen before, and the default
  // for each seen for the first time — every one on a new memo, its own lines on an edit.
  const current = useMemo(
    () =>
      filled && kind !== null
        ? tickNewcomers(rows, ticks.seen, ticks.ticked, editing)
        : { seen: new Set(ticks.seen), ticked: new Set(ticks.ticked) },
    [rows, ticks, editing, filled, kind],
  );
  const ticked = current.ticked;
  // Each line's cells as they stand: typed, or what the line proposes (a fuel receipt's mission).
  const cells = useMemo(() => {
    const out: Record<string, MemoTyped> = { ...typed };
    for (const row of rows) if (!(row.id in out)) out[row.id] = typedOf(row);
    return out;
  }, [typed, rows]);

  const derivedPeriod = useMemo(() => periodOf(rows, today()), [rows]);
  const period: MemoPeriod = (kind === null ? undefined : periods[kind]) ?? derivedPeriod;
  const name = kind === null ? '' : (names[kind] ?? '');
  const chosen = useMemo(() => (kind === null ? [] : (codes[kind] ?? [])), [codes, kind]);
  // The period's rows, then those of the chosen cars: the memo is the ticked rows on show.
  const inPeriod = useMemo(() => visibleRows(rows, period, []), [rows, period.from, period.to]);
  const shown = useMemo(() => visibleRows(inPeriod, OPEN_PERIOD, chosen), [inPeriod, chosen]);
  const filtering = chosen.length > 0;
  const options = useMemo(() => codeOptions(inPeriod), [inPeriod]);
  const picked = useMemo(() => pickedLines(shown, ticked, cells), [shown, ticked, cells]);
  const total = pickedTotal(picked);
  const head = headTick(shown, ticked);

  const replenished = editing && memo !== undefined && memo.replenishment !== null;
  const ready = kind !== null && candidates.data !== undefined && filled;

  const required = useRequiredFields(
    [
      {
        key: 'receipts',
        label: t('fleet.custody.memoEditor.required.receipts'),
        ok: picked.length > 0,
      },
    ],
    kind,
  );

  const capped = (): void => {
    toast.info(t('fleet.custody.memoEditor.capReached', { max: LATIN.format(MEMO_MAX_LINES) }));
  };
  const toggle = (id: string): void => {
    const next = toggleOne(id, shown, ticked);
    if (next.capped) capped();
    setTicks({ seen: current.seen, ticked: next.ticked });
  };
  const toggleAll = (): void => {
    const next = toggleAllShown(shown, ticked);
    if (next.capped) capped();
    setTicks({ seen: current.seen, ticked: next.ticked });
  };
  const type = (row: FleetCustodyMemoCandidateDto, change: Partial<MemoTyped>): void =>
    setTyped((held) => ({ ...held, [row.id]: { ...(held[row.id] ?? typedOf(row)), ...change } }));
  const setPeriod = (change: Partial<MemoPeriod>): void => {
    if (kind === null) return;
    setPeriods((held) => ({ ...held, [kind]: { ...period, ...change } }));
  };
  const switchKind = (next: Kind): void => {
    if (editing || next === kind) return;
    navigate(`/fleet/custody/memos/new/${next}`, { replace: true });
  };

  // The paper: his sheet of the kind with exactly the lines picked, and the names it prints with.
  const fonts = usePaperFonts();
  const signatures =
    kind === null
      ? undefined
      : editing
        ? memo?.signatures
        : (settings.data?.papers[kind] ??
          (settings.isError ? DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES[kind] : undefined));
  const lines = useMemo(() => paperLinesOf(picked), [picked]);
  // Typing in a line's box redraws the paper a beat later, never in the way of the typing.
  const paperLines = useDeferredValue(lines);
  const sheets = useMemo(() => {
    if (kind === null || signatures === undefined) return null;
    // A replenished memo is shown as it was saved; anything else as it is being written.
    if (replenished && memo !== undefined) return memoSheets(memoPaperOf(memo));
    return memoSheets({ kind, lines: paperLines, signatures });
  }, [kind, paperLines, signatures, replenished, memo, fonts]);

  // ── Saving ──────────────────────────────────────────────────────────────────────────────────
  const busy = useRef(false);
  const pending = create.isPending || update.isPending;
  const save = async (): Promise<FleetCustodyMemoDto> => {
    if (kind === null) throw new Error('no kind');
    const draft = { kind, name, date, period, picked };
    return editing
      ? update.mutateAsync({ id: editingId, body: memoUpdateBody(draft, filledVersion) })
      : create.mutateAsync(memoBody(draft));
  };
  const done = (): void => {
    toast.success(t('fleet.custody.memoEditor.savedToast'));
    navigate('/fleet/custody/memos');
  };
  /** A refused save: what refused it, in so many words, and what changed read again. */
  const refused = async (failure: unknown): Promise<void> => {
    const refusal = memoRefusalOf(failure);
    if (refusal === null) {
      toast.error(errorMessage(failure, locale));
      return;
    }
    toast.error(t(`fleet.custody.memoEditor.refused.${refusal}`));
    if (refusal === 'gone') {
      navigate('/fleet/custody/memos');
      return;
    }
    void outside.refetch();
    if (editing && (refusal === 'locked' || refusal === 'stale')) {
      const fresh = await saved.refetch();
      if (fresh.data !== undefined) fill(fresh.data);
    }
    void candidates.refetch();
  };
  const submit = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      await save();
      done();
    } catch (failure) {
      await refused(failure);
    } finally {
      busy.current = false;
    }
  };
  /**
   * «حفظ وطباعة»: the print tab FIRST, inside the press (a tab opened after an await is refused),
   * then the save, then the paper of the SAVED memo — its number and its names — into the tab.
   */
  const submitAndPrint = (): void => {
    if (busy.current) return;
    busy.current = true;
    let stored: FleetCustodyMemoDto | null = null;
    void printPaperAfter(async () => {
      stored = await save();
      return { sheets: memoSheets(memoPaperOf(stored)), title: memoFileName(stored) };
    }, t('fleet.custody.papers.printing'))
      .then(
        (opened) => {
          if (opened) done();
          else toast.error(t('fleet.violations.popupBlocked'));
        },
        async (failure: unknown) => {
          if (stored !== null) {
            // Saved, but the paper could not be written into its tab.
            toast.error(t('fleet.vehicles.print.failed'));
            done();
            return;
          }
          await refused(failure);
        },
      )
      .finally(() => {
        busy.current = false;
      });
  };
  /** A replenished memo prints as it was saved. */
  const printSaved = (): void => {
    if (memo === undefined) return;
    void printPaperAfter(
      () => Promise.resolve({ sheets: memoSheets(memoPaperOf(memo)), title: memoFileName(memo) }),
      t('fleet.custody.papers.printing'),
    ).then(
      (opened) => {
        if (!opened) toast.error(t('fleet.violations.popupBlocked'));
      },
      (failure: unknown) => toast.error(errorMessage(failure, locale)),
    );
  };

  // ── Words ───────────────────────────────────────────────────────────────────────────────────
  const kindWord = kind === null ? '' : t(`fleet.custody.source.${kind}`);
  const no = editing ? memo?.no : candidates.data?.nextNo;
  const typedName = name.replace(/\s+/gu, ' ').trim();
  // «كاوتش أكتوبر 2026 — مذكرة كاوتش رقم 7 — عن الفترة من …»; unnamed, it starts at «مذكرة كاوتش رقم 7».
  const subtitle =
    kind === null
      ? ''
      : [
          typedName === '' ? null : typedName,
          no === undefined
            ? t(`fleet.custody.papers.name.${kind}`)
            : t('fleet.custody.parts.memoFallback', { kind: kindWord, no }),
          period.from === '' || period.to === ''
            ? null
            : t('fleet.custody.memoEditor.period', { from: ymd(period.from), to: ymd(period.to) }),
        ]
          .filter((part): part is string => part !== null)
          .join(' — ');

  const isFuel = kind === 'fuel';
  const isMaintenance = kind === 'maintenance';
  // tick · code · date · driver · amount · [mission · note]
  const columns = 5 + (isFuel ? 2 : 0);

  const mainCells = (row: FleetCustodyMemoCandidateDto): JSX.Element => {
    const line = cells[row.id];
    const code = row.vehicleCode ?? '—';
    return (
      <>
        <td>
          <Tick
            on={ticked.has(row.id)}
            onClick={() => toggle(row.id)}
            label={t('fleet.custody.memoEditor.tickOne', { code })}
            data-memo-tick={row.id}
          />
        </td>
        <td>
          <CodeChip code={code} />
        </td>
        <td>
          <Day day={row.date} />
        </td>
        <td className="hidden sm:table-cell">
          {/* One line, as on the approved sample: the name's own look wraps by default, which
              squeezed it onto three lines beside fuel's «المأمورية» and «ملاحظات». On the
              wrapper, so a name from the old books (which takes no class) stays on one too. */}
          <span className="whitespace-nowrap [&_span]:!max-w-none [&_span]:!whitespace-nowrap">
            <DriverCell employeeId={row.driverEmployeeId} name={row.driverName} look="name" />
          </span>
        </td>
        <td>
          {isFuel ? (
            // Fuel: the litres and the type under the amount, as the receipt holds them.
            <span className="flex flex-col items-center gap-0.5">
              <Money value={row.amount} />
              {(row.litres !== null || row.fuelType !== null) && (
                <span
                  data-memo-litres={row.id}
                  className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400"
                >
                  {[
                    row.litres === null
                      ? null
                      : t('fleet.custody.memoEditor.litres', { litres: row.litres.toFixed(2) }),
                    row.fuelType === null ? null : t(`fleet.receipts.fuelType.${row.fuelType}`),
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                </span>
              )}
            </span>
          ) : (
            <Money value={row.amount} unit="wide" />
          )}
        </td>
        {isFuel && (
          <>
            <td>
              <div className="relative">
                <Input
                  list={MISSIONS_LIST}
                  aria-label={t('fleet.custody.memoEditor.missionOf', { code })}
                  value={line?.mission ?? ''}
                  onChange={(e) => type(row, { mission: e.target.value })}
                  maxLength={120}
                  density="tight"
                  tone={cn(CARD_BOX, '!pe-7 !ps-2 text-center')}
                  data-memo-mission={row.id}
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="pointer-events-none absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </td>
            <td className="hidden sm:table-cell">
              <Input
                aria-label={t('fleet.custody.memoEditor.noteOf', { code })}
                value={line?.note ?? ''}
                onChange={(e) => type(row, { note: e.target.value })}
                placeholder={t('fleet.custody.memoEditor.notePlaceholder')}
                maxLength={300}
                density="tight"
                tone={CARD_BOX}
                data-memo-note={row.id}
              />
            </td>
          </>
        )}
      </>
    );
  };

  const missing = required.isMissing('receipts');
  const receiptsTable = (
    <div
      className={cn(FORM_TABLE_WRAP, missing && 'ring-2 ring-rose-500/60')}
      {...(missing ? { 'data-field-missing': 'true' } : {})}
    >
      <table className={FORM_TABLE} data-memo-receipts={kind ?? ''}>
        <thead className={FORM_THEAD}>
          <tr>
            <th className="w-10 sm:w-12">
              <Tick
                on={head.on}
                partly={head.partly}
                onClick={toggleAll}
                label={t(
                  head.on
                    ? 'fleet.custody.memoEditor.untickAll'
                    : 'fleet.custody.memoEditor.tickAll',
                )}
                data-memo-tick-all="true"
              />
            </th>
            <th>{t('fleet.custody.memoEditor.col.code')}</th>
            <th>{t('fleet.custody.memoEditor.col.date')}</th>
            <th className="hidden sm:table-cell">{t('fleet.custody.memoEditor.col.driver')}</th>
            <th>{t('fleet.custody.memoEditor.col.amount')}</th>
            {isFuel && <th className="w-32">{t('fleet.custody.memoEditor.col.mission')}</th>}
            {isFuel && (
              <th className="hidden w-24 sm:table-cell">
                {t('fleet.custody.memoEditor.col.note')}
              </th>
            )}
          </tr>
        </thead>
        {isMaintenance ? (
          <tbody className={FORM_TBODY.replace('divide-y ', '')}>
            {shown.map((row, index) => {
              const tone = ticked.has(row.id) ? PICKED_ROW : LEFT_ROW;
              const line = cells[row.id];
              const code = row.vehicleCode ?? '—';
              return [
                <tr
                  key={row.id}
                  data-memo-line={row.id}
                  className={cn(
                    tone,
                    index > 0 && 'border-t border-slate-200 dark:border-[#2b3b6b]/70',
                  )}
                >
                  {mainCells(row)}
                </tr>,
                <tr key={`${row.id}:typed`} className={tone}>
                  <td colSpan={columns} className="!pb-3 !pt-0">
                    <div className="grid grid-cols-1 gap-2 ps-0 sm:grid-cols-[1fr_11rem] sm:ps-12">
                      <label className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-start text-xs font-bold text-slate-500 dark:text-slate-400">
                          {t('fleet.custody.memoEditor.col.statement')}
                        </span>
                        <Input
                          aria-label={t('fleet.custody.memoEditor.statementOf', { code })}
                          value={line?.statement ?? ''}
                          onChange={(e) => type(row, { statement: e.target.value })}
                          placeholder={t('fleet.custody.memoEditor.statementPlaceholder')}
                          maxLength={500}
                          density="tight"
                          tone={CARD_BOX}
                          data-memo-statement={row.id}
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-start text-xs font-bold text-slate-500 sm:w-auto dark:text-slate-400">
                          {t('fleet.custody.memoEditor.col.note')}
                        </span>
                        <Input
                          aria-label={t('fleet.custody.memoEditor.noteOf', { code })}
                          value={line?.note ?? ''}
                          onChange={(e) => type(row, { note: e.target.value })}
                          placeholder={t('fleet.custody.memoEditor.notePlaceholder')}
                          maxLength={300}
                          density="tight"
                          tone={CARD_BOX}
                          data-memo-note={row.id}
                        />
                      </label>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        ) : (
          <tbody className={FORM_TBODY}>
            {shown.map((row) => (
              <tr
                key={row.id}
                data-memo-line={row.id}
                className={ticked.has(row.id) ? PICKED_ROW : LEFT_ROW}
              >
                {mainCells(row)}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );

  const loadingBox = (
    <div className="flex min-h-48 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
      {saved.isError || candidates.isError ? (
        <span role="alert" data-memo-editor-error="true">
          {saved.isError
            ? t('fleet.custody.memoEditor.notFound')
            : errorMessage(candidates.error, locale)}
        </span>
      ) : (
        <Spinner className="h-6 w-6" />
      )}
    </div>
  );

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0" data-memo-editor={kind ?? ''}>
      <DesignPageHeader
        icon={MEMO_ICON}
        title={t(
          editing ? 'fleet.custody.memoEditor.editTitle' : 'fleet.custody.memoEditor.newTitle',
        )}
        subtitle={subtitle}
      >
        <Link to="/fleet/custody/memos" className={DESIGN_BACK}>
          {t('fleet.custody.memoEditor.back')}
        </Link>
      </DesignPageHeader>

      <div className="flex flex-col gap-4 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <section
          className={cn(
            SANS,
            'flex flex-col rounded-2xl border text-slate-900 antialiased lg:min-h-0 lg:w-[57%] lg:overflow-hidden dark:text-slate-100',
            'border-slate-200 bg-white dark:border-[#2b3b6b] dark:bg-[#121c3f]/95',
          )}
        >
          <div
            className="space-y-7 p-4 sm:p-6 lg:min-h-0 lg:flex-1 lg:overflow-auto"
            data-memo-form="true"
          >
            <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
            {replenished && memo?.replenishment != null && (
              <div
                role="note"
                data-memo-locked={memo.replenishment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                <span>
                  {t('fleet.custody.memoEditor.locked', { date: ymd(memo.replenishment.date) })}
                </span>
                <Link
                  to={`/fleet/custody/log?open=${encodeURIComponent(memo.replenishment.id)}`}
                  className="whitespace-nowrap text-xs font-bold underline underline-offset-4"
                >
                  {t('fleet.custody.parts.status.open')}
                </Link>
              </div>
            )}
            {!ready || kind === null ? (
              loadingBox
            ) : (
              // A replenished memo is shown as it was saved, every box and tick at rest.
              <fieldset disabled={replenished} className="min-w-0 space-y-7">
                <section className="space-y-4">
                  <SectionHead
                    title={t('fleet.custody.memoEditor.section')}
                    icon={PATH.calendar}
                    end={
                      no === undefined ? undefined : (
                        <CountChip>
                          <span data-memo-no={no}>
                            {t('fleet.custody.memoEditor.noChip', { no })}
                          </span>
                        </CountChip>
                      )
                    }
                  />
                  <KindSwitch
                    value={kind}
                    onChange={switchKind}
                    outside={outside.data}
                    only={editing ? kind : null}
                  />
                  <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3 sm:gap-5">
                    <div className="sm:col-span-3">
                      <DesignField
                        label={t('fleet.custody.memoEditor.name')}
                        hint={t('fleet.custody.memoEditor.nameHint')}
                      >
                        <Input
                          aria-label={t('fleet.custody.memoEditor.name')}
                          value={name}
                          onChange={(e) =>
                            setNames((held) => ({ ...held, [kind]: e.target.value }))
                          }
                          placeholder={t('fleet.custody.memoEditor.namePlaceholder', {
                            example: `${kindWord} ${monthOfDay(period.to === '' ? today() : period.to, locale)}`,
                          })}
                          maxLength={120}
                          tone={BOX}
                          data-memo-name="true"
                        />
                      </DesignField>
                    </div>
                    <DesignField label={t('fleet.custody.memoEditor.from')} datePicker>
                      <Input
                        type="date"
                        dir="ltr"
                        aria-label={t('fleet.custody.memoEditor.from')}
                        value={period.from}
                        onChange={(e) => setPeriod({ from: e.target.value })}
                        tone={DATE_BOX}
                        data-memo-from="true"
                      />
                    </DesignField>
                    <DesignField label={t('fleet.custody.memoEditor.to')} datePicker>
                      <Input
                        type="date"
                        dir="ltr"
                        aria-label={t('fleet.custody.memoEditor.to')}
                        value={period.to}
                        onChange={(e) => setPeriod({ to: e.target.value })}
                        tone={DATE_BOX}
                        data-memo-to="true"
                      />
                    </DesignField>
                    <DesignField label={t('fleet.custody.memoEditor.date')} datePicker>
                      <Input
                        type="date"
                        dir="ltr"
                        aria-label={t('fleet.custody.memoEditor.date')}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        tone={DATE_BOX}
                        data-memo-date="true"
                      />
                    </DesignField>
                  </div>
                </section>

                <section className="space-y-3" data-memo-receipts-section="true">
                  <SectionHead
                    title={t('fleet.custody.memoEditor.receipts.title', { kind: kindWord })}
                    icon={MEMO_ICON}
                    end={
                      <CountChip>
                        <span data-memo-shown={shown.length}>
                          {filtering
                            ? t('fleet.custody.memoEditor.receipts.shownOf', {
                                shown: LATIN.format(shown.length),
                                total: LATIN.format(inPeriod.length),
                              })
                            : pickedCount(inPeriod.length)}
                        </span>
                      </CountChip>
                    }
                  />
                  {/* «عاوز احدد العربيات اسمحلى افلتر ب كود العربيه» — the custody screen's «كود
                      السيارة» filter, offering the cars this list holds; the cars it keeps are the
                      memo's. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="w-full sm:max-w-sm" data-memo-code-filter="true">
                      <FilterWithIcon
                        icon={FILTER_ICON.car}
                        tone="text-emerald-600 dark:text-emerald-400"
                        className={CAR_PICK}
                      >
                        <VehicleCodeFilter
                          fullWidth
                          options={options}
                          value={chosen}
                          onChange={(next) => setCodes((held) => ({ ...held, [kind]: next }))}
                        />
                      </FilterWithIcon>
                    </div>
                    {filtering && (
                      <p
                        className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400"
                        data-memo-filter-note="true"
                      >
                        {t('fleet.custody.memoEditor.receipts.filterNote')}
                      </p>
                    )}
                  </div>
                  {candidates.data?.truncated === true && (
                    <p
                      role="note"
                      data-memo-truncated="true"
                      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                    >
                      {t('fleet.custody.memoEditor.receipts.truncated', {
                        count: LATIN.format(MEMO_MAX_LINES),
                      })}
                    </p>
                  )}
                  {receiptsTable}
                  {shown.length === 0 && (
                    <p
                      data-memo-empty={inPeriod.length === 0 ? 'period' : 'cars'}
                      className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:text-slate-400"
                    >
                      {t(
                        inPeriod.length === 0
                          ? 'fleet.custody.memoEditor.emptyPeriod'
                          : 'fleet.custody.memoEditor.emptyCars',
                        { kind: kindWord },
                      )}
                    </p>
                  )}
                  {isFuel && (
                    <datalist id={MISSIONS_LIST}>
                      {(candidates.data?.missionOptions ?? []).map((mission) => (
                        <option key={mission} value={mission} />
                      ))}
                    </datalist>
                  )}
                </section>
              </fieldset>
            )}
          </div>

          {/* The memo's figure and its two saves — kept in view while the receipts scroll. */}
          <footer
            data-memo-footer="true"
            className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:px-6 lg:static dark:border-[#2b3b6b] dark:bg-[#0f1838]/95"
          >
            <p
              data-memo-selected={picked.length}
              className="text-[15px] font-bold text-slate-800 dark:text-slate-100"
            >
              {picked.length === 0 ? (
                pickedPhrase(0)
              ) : (
                <>
                  {t('fleet.custody.count.picked.lead')}{' '}
                  <span className="text-emerald-700 dark:text-emerald-300">
                    {pickedCount(picked.length)}
                  </span>
                  {' — '}
                  {t('fleet.custody.memoEditor.total')}{' '}
                  <Money value={total} big className="text-slate-900 dark:text-white" small />
                </>
              )}
            </p>
            <div className="flex w-full items-center gap-2 sm:w-auto sm:gap-3 [&>*]:flex-1 [&>*]:justify-center sm:[&>*]:flex-none">
              {replenished ? (
                <PrintButton
                  label={t('fleet.custody.papers.printMemo')}
                  onClick={printSaved}
                  data-memo-print-saved="true"
                />
              ) : (
                <>
                  <DesignSave
                    label={t('fleet.custody.memoEditor.save')}
                    busy={pending}
                    onClick={required.guard(() => submit())}
                    data-memo-save="true"
                  />
                  <PrintButton
                    label={t('fleet.custody.memoEditor.savePrint')}
                    busy={pending}
                    onClick={required.guard(() => submitAndPrint())}
                    data-memo-save-print="true"
                  />
                </>
              )}
            </div>
          </footer>
        </section>

        <section
          className="space-y-3 rounded-xl bg-slate-200 p-3 sm:p-4 lg:min-h-0 lg:flex-1 lg:overflow-auto dark:bg-slate-800"
          data-memo-preview="true"
        >
          <p className="mx-auto flex max-w-[640px] items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span>{t('fleet.custody.memoEditor.preview')}</span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              A4
            </span>
          </p>
          {sheets === null ? (
            <div className="flex min-h-48 items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (
            <PaperTray sheets={sheets} name={`memo-${kind ?? ''}`} bare />
          )}
        </section>
      </div>
    </div>
  );
};
