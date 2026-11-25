// «تبديل بين سيارتين» on «لوحة التشغيلة» (Round 32 C) — the owner: «انا عاوز بقى اقدر اعمل اسوابنج بين
// عربيتين واقدر احدد هنقل ايه بالظبط للعربيه التانيه … ف ممكن تعملى سامبل كل عربيه بالبيانات على كارد
// جمب بعض الاتنين».
//
// THE WINDOW, opened from a row's «⇄» (today and later days only — a past day's record has no acts):
//   · the TWO VANS ON TWO CARDS SIDE BY SIDE — the row it was opened from first (on the right in
//     Arabic), the second picked from the board's other rows, rows without a van included. Each card
//     lists everything its row holds — «قائد الطاقم», «أخصائي 1», «أخصائي 2» person by person, then
//     «الاتجاه», «التوقيت», «النوع», «لون الصف», «ملاحظات» — each with its own box to tick, and
//     «الكل» · «الطاقم فقط» · «لا شيء» to tick a card at once;
//   · BETWEEN THEM, three ARROWS (Round 34 A) that ACT (Round 34 D — «أنا يعتبر محدد اللي في النص …
//     لو أنا اخترت شمال أو يمين مثلا يفضل موجود لحد ما الداتا تتنقل ثانية أو ثانيتين ويقوم جاي
//     متشال»): a press MOVES the ticked items at once — one way from the sending card (only its
//     ticks), or both ways for the swap — and the arrow stays filled in its colour while they land,
//     then rests. No way stays «selected». The two cards are a WORKING COPY: what arrived carries
//     «من 213» until «تطبيق»; a value a move replaced is named beside the one that took its place;
//     what a board rule keeps back (away that day, a slot his role does not fit, no room left, an
//     archived type — `lib/crew-swap.ts` decides all of it) flashes rose on its card, and the
//     notice under the arrows names it and why. Several presses follow one another; «تراجع عن آخر
//     نقل» takes them back one at a time, down to the opening state (`lib/crew-swap-window.ts`);
//   · «تطبيق» hands the window's presses to the page, which replays them on the DRAFT as ONE step of
//     the board's «تراجع» (judged again there by the board as it is then); nothing is written until
//     «حفظ». The footer says so while the moves change something («تنتقل التغييرات إلى اللوحة عند
//     «تطبيق»»), and «إلغاء», ✕ and Escape then ASK first — «تطبيق», «تجاهل التغييرات» or «متابعة
//     التعديل» (Round 34 D critic: they dropped every move without a word); with nothing changed they
//     close.
//
// THE KEYBOARD: every box is a real checkbox named by what it moves and where («نقل أحمد علي — قائد
// الطاقم — إلى 213»); the three arrows are a toolbar (one in the Tab order, the arrow keys moving
// among them, Enter and Space pressing; each named by what it does — «نقل المحدد من 150 إلى 213» —
// and, when it cannot act, why); Tab stays inside the window and Escape closes it, the focus going
// back to the row's «⇄».
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  type Locale,
  type OperationsCrewMemberDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { foldIncludes } from '../../../shared/lib/fold';
import { formatNumber } from '../../../shared/lib/format';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  CREW_SLOTS,
  rowPeople,
  wrongSlotOf,
  type CrewRowColour,
  type CrewSlot,
  type PlanRow,
} from '../lib/crew-plan';
import {
  QUICK_PICKS,
  SWAP_FIELDS,
  fieldItem,
  livePicks,
  otherSide,
  personItem,
  replaySwap,
  shipmentsLeftBehind,
  swapArrivals,
  swapChanged,
  swapOperation,
  swapReplacedValues,
  swapSlotChanges,
  type SwapField,
  type SwapMode,
  type SwapRefusal,
  type SwapRules,
  type SwapSide,
  type SwapStep,
} from '../lib/crew-swap';
import {
  SWAP_WINDOW_START,
  createSwapWindow,
  swapArrowWhy,
  swapCloseStep,
  swapReceiving,
  swapWindowCounts,
  type SwapWindow,
  type SwapWindowState,
} from '../lib/crew-swap-window';
import { NO_ROW_COLOUR } from '../lib/type-colours';
import { AWAY_BADGE, ROLE_DOT } from './CrewPlanChip';
import { PLAN_ICON } from './crew-plan-icons';
import { SwapArrows } from './crew-swap-arrows';
import { NO_COLOUR_TONE, SHIFT_TYPE_TONE, ShiftTypeDot, shiftTypeName } from './shift-type-look';
import { SHIPMENT_PATH } from './shipment-icons';
import { useFocusTrap } from './use-focus-trap';

/** The card's frame — the board's own surfaces, dark and light. */
const CARD =
  'min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80';
const GROUP_LABEL = 'text-[11px] font-black text-slate-500 dark:text-slate-400';
const TAG = 'inline-flex shrink-0 items-center rounded px-1 text-[10.5px] font-black leading-4';
const TAG_FROM =
  'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/40';
const TAG_KEPT =
  'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/40';
const TAG_QUIET = 'bg-slate-200/70 text-slate-600 dark:bg-white/10 dark:text-slate-300';

export interface CrewSwapDialogProps {
  /** The row the window was opened from — the first card. */
  aKey: string;
  /** The board's draft. */
  rows: readonly PlanRow[];
  /** A row's name: its van's code, or «بدون سيارة (n)». */
  rowName: (row: PlanRow) => string;
  member: (employeeId: string) => OperationsCrewMemberDto;
  rules: SwapRules;
  shiftTypes: readonly OperationsShiftTypeDto[];
  colourName: (colour: CrewRowColour) => string;
  locale: Locale;
  /**
   * «تطبيق» (Round 34 D): the second row and the window's presses, in order — the page replays them
   * on its draft as ONE operation (`applySwapStepsToDraft`), judged by the board as it is then.
   */
  onApply: (bKey: string, steps: readonly SwapStep[]) => void;
  /**
   * The window closes with nothing handed over: «إلغاء», ✕ or Escape with nothing changed, or
   * «تجاهل التغييرات» on the question they ask when the moves change something.
   */
  onClose: () => void;
  /** Opened on two rows already (both chosen on the board) — with the window's state, if any. */
  initial?: { bKey: string } & Partial<SwapWindowState>;
}

const NOTHING: ReadonlySet<string> = new Set();

export const CrewSwapDialog = ({
  aKey,
  rows,
  rowName,
  member,
  rules,
  shiftTypes,
  colourName,
  locale,
  onApply,
  onClose,
  initial,
}: CrewSwapDialogProps): JSX.Element | null => {
  const t = useT();
  const titleId = useId();
  const [bKey, setBKey] = useState<string | null>(initial?.bKey ?? null);
  const [choosing, setChoosing] = useState(initial === undefined);
  const [search, setSearch] = useState('');
  // The ticks, the presses so far, what the last one did, the arrow held, the close question — and
  // the press and its hold's clock with them (`createSwapWindow`): the pressed arrow goes back to
  // rest by itself, `SWAP_HOLD_MS` after the press; the window closing (its last watcher gone)
  // stops the clock.
  const store = useRef<SwapWindow | null>(null);
  if (store.current === null)
    store.current = createSwapWindow({
      picks: initial?.picks ?? SWAP_WINDOW_START.picks,
      steps: initial?.steps ?? SWAP_WINDOW_START.steps,
      last: initial?.last ?? null,
      held: initial?.held ?? null,
      closing: initial?.closing ?? false,
    });
  const swap = store.current;
  const win = useSyncExternalStore(swap.subscribe, swap.getState, swap.getState);
  // The arrow in the Tab order — the toolbar's roving stop; the middle one to begin with.
  const [focusWay, setFocusWay] = useState<SwapMode>('swap');
  const inside = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const modeButtons = useRef<Partial<Record<SwapMode, HTMLButtonElement | null>>>({});
  // The search for the second van when it is still to pick, else the first box to tick.
  useFocusTrap(
    inside,
    () =>
      searchBox.current ??
      inside.current?.querySelector<HTMLElement>('input[type="checkbox"]:not([disabled])') ??
      null,
  );

  const a = rows.find((row) => row.key === aKey);
  const b = bKey === null ? undefined : rows.find((row) => row.key === bKey);
  // The second row went meanwhile (another desk's save, «تراجع» outside): pick again — the moves
  // made with it go with it. (Until then the window has no second card: nothing to press or apply.)
  const secondGone = bKey !== null && b === undefined;
  useEffect(() => {
    if (!secondGone) return;
    setBKey(null);
    setChoosing(true);
    swap.send({ type: 'second' });
  }, [secondGone, swap]);

  const others = useMemo(() => rows.filter((row) => row.key !== aKey), [rows, aKey]);
  const listed = others.filter((row) =>
    foldIncludes(
      [
        rowName(row),
        row.direction ?? '',
        ...rowPeople(row).flatMap((id) => [member(id).fullNameAr, member(id).code ?? '']),
      ].join(' '),
      search,
    ),
  );

  if (a === undefined) return null;
  // THE WORKING COPY: the presses replayed over the two rows as the board has them now.
  const opening = b === undefined ? null : { a, b };
  const replay = opening === null ? null : replaySwap(opening.a, opening.b, win.steps, rules);
  const work = replay === null ? null : { a: replay.a, b: replay.b };
  const live = work === null ? { a: win.picks.a, b: [] } : livePicks(work.a, work.b, win.picks);
  const arrivals = opening !== null && work !== null ? swapArrivals(opening, work) : null;
  const seats = opening !== null && work !== null ? swapSlotChanges(opening, work) : null;
  const replaced = opening !== null && work !== null ? swapReplacedValues(opening, work) : [];
  const changed = opening !== null && work !== null && swapChanged(opening, work);
  const counts = swapWindowCounts(opening, work, win);
  const name = {
    a: rowName(a),
    b: b === undefined ? t('operations.crewPlan.swap.secondVan') : rowName(b),
  };
  // The press now playing: what it moved and what a rule kept back, for the cards' marks.
  const playing = win.held !== null ? win.last : null;

  const choose = (key: string): void => {
    setBKey(key);
    setChoosing(false);
    swap.send({ type: 'second' });
    setSearch('');
    requestAnimationFrame(() =>
      inside.current
        ?.querySelector<HTMLElement>('[data-swap-change]')
        ?.focus({ preventScroll: true }),
    );
  };

  const typeOf = (id: string): OperationsShiftTypeDto | undefined =>
    shiftTypes.find((type) => type.id === id);
  const fieldLabel = (field: SwapField): string =>
    field === 'rowColour'
      ? t('operations.crewPlan.swap.colour')
      : t(
          `operations.crewPlan.columns.${
            field === 'plannedTime' ? 'time' : field === 'shiftTypeId' ? 'type' : field
          }`,
        );
  /** A row colour by name — a palette colour's, or «بدون لون» (Round 34 C). */
  const rowColourText = (value: string): string =>
    value === NO_ROW_COLOUR
      ? t('operations.crewPlan.colour.none')
      : colourName(value as CrewRowColour);
  /** A field's value as the card shows it. */
  const fieldValue = (field: SwapField, value: string): ReactNode => {
    if (field === 'plannedTime') return <span className={cn(NUM, 'font-black')}>{value}</span>;
    if (field === 'shiftTypeId') {
      const type = typeOf(value);
      if (type === undefined) return '—';
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <ShiftTypeDot colour={type.colour} size="sm" />
          <span className="truncate font-bold">{shiftTypeName(type, locale)}</span>
          {!type.isActive && (
            <span className={cn(TAG, TAG_QUIET)}>{t('operations.crewPlan.swap.archived')}</span>
          )}
        </span>
      );
    }
    if (field === 'rowColour') {
      // Round 34 C — «بدون لون» is a value of its own: it moves as any colour does, and is drawn as
      // the neutral swatch (`NO_COLOUR_TONE`), never as the type's.
      const none = value === NO_ROW_COLOUR;
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5" data-swap-colour={value}>
          <span
            aria-hidden
            className={cn(
              'h-3 w-3 shrink-0 rounded',
              none ? NO_COLOUR_TONE.dot : SHIFT_TYPE_TONE[value as CrewRowColour].dot,
            )}
          />
          <span className="truncate font-bold">{rowColourText(value)}</span>
        </span>
      );
    }
    return (
      <span className="min-w-0 truncate font-bold" title={value} dir="auto">
        {value}
      </span>
    );
  };
  /** A plain-text value, for a struck «بدلًا من» and the screen reader's names. */
  const fieldText = (field: SwapField, value: string): string =>
    field === 'shiftTypeId'
      ? ((): string => {
          const type = typeOf(value);
          return type === undefined ? '—' : shiftTypeName(type, locale);
        })()
      : field === 'rowColour'
        ? rowColourText(value)
        : value;
  const reasonText = (reason: SwapRefusal, toRow: string): string =>
    t(`operations.crewPlan.swap.reason.${reason}`, { row: toRow });
  /** An item as the notice names it: the person, or the field and its value. */
  const itemName = (side: SwapSide, item: string): string => {
    if (item.startsWith('person:')) return member(item.slice('person:'.length)).fullNameAr;
    const field = item.slice('field:'.length) as SwapField;
    const value = (work === null ? a : work[side])[field];
    return value === null ? fieldLabel(field) : `${fieldLabel(field)}: ${fieldText(field, value)}`;
  };

  /** One person: the role's dot, the name, the code — and why he is marked, when he is. */
  const personLine = (employeeId: string, slot: CrewSlot): ReactNode => {
    const who = member(employeeId);
    const role = rules.roleOf(employeeId);
    const away = rules.awayOf(employeeId);
    const misfit = role === null ? null : wrongSlotOf(role, slot);
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          aria-hidden
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ROLE_DOT[role ?? 'specialist'])}
        />
        <span className="min-w-0 truncate font-bold text-slate-900 dark:text-white" dir="auto">
          {who.fullNameAr}
        </span>
        {who.code !== null && (
          <span className={cn(NUM, 'shrink-0 text-[11px] text-slate-500 dark:text-slate-400')}>
            {who.code}
          </span>
        )}
        {away !== null && (
          <span className={cn(TAG, AWAY_BADGE[away])}>{t(`operations.crewPlan.away.${away}`)}</span>
        )}
        {misfit !== null && (
          <span className={cn(TAG, TAG_QUIET)}>
            {t(`operations.crewPlan.wrongSlot.badge.${misfit}`)}
          </span>
        )}
      </span>
    );
  };

  // ── A card: what its row holds NOW in the window, each item with its box ──────────────────
  // Dense, so both cards fit a 1440×900 screen: a label column, one line a person, the fields two
  // to a line (the notes a line of their own). What arrived carries «من 213»; while a press plays,
  // what it brings settles in and what a rule kept back flashes rose.
  const pickCard = (side: SwapSide, row: PlanRow): JSX.Element => {
    const other = otherSide(side);
    const from = name[other];
    const arrived = arrivals?.[side] ?? NOTHING;
    const landing = new Set(
      playing?.moved.filter((move) => move.from === other).map((move) => move.item) ?? [],
    );
    const flashing = new Set(
      playing?.refused.filter((one) => one.from === side).map((one) => one.item) ?? [],
    );
    const was = new Map(
      replaced.filter((one) => one.on === side).map((one) => [one.field, one.was]),
    );
    // Back on his own row but in the other slot (his own was full): «من أخصائي 1».
    const reseated = new Map(
      [...(seats?.[side] ?? new Map<string, CrewSlot>())].map(([employeeId, slot]) => [
        personItem(employeeId),
        slot,
      ]),
    );
    const receiving = swapReceiving(win.held, side);
    const behind = opening === null ? 0 : shipmentsLeftBehind(opening[side], row);
    const box = (id: string, label: string, content: ReactNode, tail?: ReactNode): JSX.Element => {
      const on = live[side].includes(id);
      const seat = reseated.get(id);
      const came = arrived.has(id) || seat !== undefined;
      return (
        <label
          key={id}
          data-swap-item={id}
          data-swap-ticked={on ? 'true' : undefined}
          className={cn(
            'flex min-h-[1.75rem] min-w-0 cursor-pointer flex-wrap items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[12.5px] transition',
            on
              ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-400/70 dark:bg-brand-500/20 dark:ring-brand-400/50'
              : came
                ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/60 dark:bg-emerald-500/15'
                : 'hover:bg-slate-100 dark:hover:bg-white/5',
            landing.has(id) && 'motion-safe:animate-swap-arrive',
            flashing.has(id) &&
              'bg-rose-500/15 ring-1 ring-inset ring-rose-400/80 motion-safe:animate-swap-flash dark:bg-rose-500/20',
          )}
        >
          <input
            type="checkbox"
            checked={on}
            aria-label={t('operations.crewPlan.swap.item', { item: label, to: from })}
            onChange={() => swap.send({ type: 'tick', side, id })}
            className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600"
          />
          {content}
          {arrived.has(id) && (
            <span className={cn(TAG, TAG_FROM)} data-swap-arrived={id}>
              {t('operations.crewPlan.swap.from', { row: from })}
            </span>
          )}
          {seat !== undefined && (
            <span className={cn(TAG, TAG_FROM)} data-swap-reseated={id}>
              {t('operations.crewPlan.swap.fromSlot', {
                slot: t(`operations.crewPlan.columns.${seat}`),
              })}
            </span>
          )}
          {tail}
          {flashing.has(id) && (
            <span className={cn(TAG, TAG_KEPT)} data-swap-kept={id}>
              {t('operations.crewPlan.swap.kept')}
            </span>
          )}
        </label>
      );
    };
    const fieldBox = (field: SwapField): JSX.Element => {
      const value = row[field];
      const lost = was.get(field);
      // A value a move put out of both rows, said where it was: «بدلًا من 09:00».
      const lostTag =
        lost === undefined ? undefined : (
          <span
            className="text-[11px] font-semibold text-slate-500 dark:text-slate-400"
            data-swap-replaced={field}
          >
            {t('operations.crewPlan.swap.was')}{' '}
            <s className="decoration-rose-500 decoration-2" dir="auto">
              {fieldText(field, lost)}
            </s>
          </span>
        );
      return value === null ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Empty />
          {lostTag}
        </span>
      ) : (
        box(
          fieldItem(field),
          `${fieldLabel(field)}: ${fieldText(field, value)}`,
          <span
            className={cn(
              'flex items-center text-slate-900 dark:text-white',
              // Round 34 verifier — a time never shortens (no ellipsis): it keeps its width, so
              // «من 213» and «بدلًا من …» wrap to the next line instead of being drawn under it.
              // A value that shortens with an ellipsis gives way to them.
              field === 'plannedTime' ? 'flex-none' : 'min-w-0 flex-1',
            )}
          >
            {fieldValue(field, value)}
          </span>,
          lostTag,
        )
      );
    };
    return (
      <section
        aria-labelledby={`${titleId}-${side}`}
        data-swap-card={side}
        data-swap-row={row.key}
        data-swap-receiving={receiving ? 'true' : undefined}
        className={cn(
          CARD,
          'flex flex-col gap-2 transition-shadow',
          receiving &&
            (win.held === 'swap'
              ? 'ring-2 ring-orange-500/55 dark:ring-orange-400/50'
              : 'ring-2 ring-sky-500/55 dark:ring-sky-400/50'),
        )}
      >
        <CardHead
          id={`${titleId}-${side}`}
          order={t(`operations.crewPlan.swap.${side === 'a' ? 'first' : 'second'}`)}
          name={name[side]}
          row={row}
          drivers={t('operations.crewPlan.swap.drivers', {
            names: row.drivers.map((driver) => driver.fullNameAr ?? '—').join('، '),
          })}
          shipments={
            (row.shipments ?? 0) > 0
              ? t('operations.crewPlan.swap.shipments', {
                  count: formatNumber(row.shipments ?? 0, locale),
                })
              : null
          }
          tools={
            <>
              {receiving && (
                <span
                  className={cn(
                    TAG,
                    'px-1.5',
                    win.held === 'swap'
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200'
                      : 'bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
                  )}
                  data-swap-receiving-tag={side}
                >
                  {t('operations.crewPlan.swap.receiving')}
                </span>
              )}
              <span
                role="group"
                aria-label={t('operations.crewPlan.swap.quickLabel', { row: name[side] })}
                className="flex items-center gap-1"
              >
                {QUICK_PICKS.map((pick) => (
                  <button
                    key={pick}
                    type="button"
                    data-swap-quick={`${side}:${pick}`}
                    onClick={() => swap.send({ type: 'quick', side, row, pick })}
                    className={QUIET_BUTTON}
                  >
                    {t(`operations.crewPlan.swap.quick.${pick}`)}
                  </button>
                ))}
              </span>
              {side === 'b' && (
                // Round 34 D — another second van would leave the moves made with this one
                // nowhere: «تطبيق» them or take them back first. Off, it still says why to the
                // keyboard and the screen reader (`aria-disabled`, Round 34 D critic).
                <button
                  type="button"
                  data-swap-change="true"
                  aria-disabled={win.steps.length > 0 ? true : undefined}
                  title={
                    win.steps.length > 0 ? t('operations.crewPlan.swap.changeLocked') : undefined
                  }
                  onClick={() => {
                    if (win.steps.length > 0) return;
                    setChoosing(true);
                    requestAnimationFrame(() => searchBox.current?.focus({ preventScroll: true }));
                  }}
                  aria-label={
                    win.steps.length > 0
                      ? `${t('operations.crewPlan.swap.changeLabel')} — ${t('operations.crewPlan.swap.changeLocked')}`
                      : t('operations.crewPlan.swap.changeLabel')
                  }
                  className={cn(
                    QUIET_BUTTON,
                    'border-brand-300 text-brand-700 dark:text-brand-200',
                  )}
                >
                  {t('operations.crewPlan.swap.change')}
                </button>
              )}
            </>
          }
        />
        <div className={SLOT_GRID}>
          {CREW_SLOTS.map((slot) => (
            <Labelled key={slot} label={t(`operations.crewPlan.columns.${slot}`)}>
              {row.slots[slot].length === 0 ? (
                <Empty />
              ) : (
                row.slots[slot].map((employeeId) =>
                  box(
                    personItem(employeeId),
                    `${member(employeeId).fullNameAr} — ${t(`operations.crewPlan.columns.${slot}`)}`,
                    personLine(employeeId, slot),
                  ),
                )
              )}
            </Labelled>
          ))}
        </div>
        <div className={FIELD_GRID}>
          {SWAP_FIELDS.map((field) => (
            <Labelled key={field} label={fieldLabel(field)} wide={field === 'notes'}>
              {fieldBox(field)}
            </Labelled>
          ))}
        </div>
        {/* Round 32 critic — the محصنات ride the row: said once its captains or its direction have
            changed under them (they were placed for the crew and the direction it had). */}
        {behind > 0 && (
          <p
            role="note"
            className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] font-bold text-amber-900 ring-1 ring-inset ring-amber-300 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30"
            data-swap-shipments-stay={side}
          >
            <BoardIcon d={PATH.warn} className="mt-px h-3.5 w-3.5 shrink-0" />
            {t('operations.crewPlan.swap.shipmentsStay', {
              row: name[side],
              count: formatNumber(behind, locale),
            })}
          </p>
        )}
      </section>
    );
  };

  // ── The second van, picked from the board's other rows ──────────────────────────────────────
  const chooser = (
    <section
      data-swap-chooser="true"
      aria-labelledby={`${titleId}-choose`}
      className={cn(CARD, 'flex min-h-[18rem] flex-col gap-2')}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={`${titleId}-choose`}
          className="text-[13px] font-black text-slate-900 dark:text-white"
        >
          {t('operations.crewPlan.swap.pickSecond')}
        </h3>
        {b !== undefined && (
          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="text-[11.5px] font-black text-brand-700 hover:underline dark:text-brand-200"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
      <p className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
        {t('operations.crewPlan.swap.pickSecondHint')}
      </p>
      <input
        ref={searchBox}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={t('operations.crewPlan.swap.search')}
        placeholder={t('operations.crewPlan.swap.search')}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:text-white"
      />
      <ul
        className="flex max-h-[16rem] min-h-0 flex-1 flex-col gap-1 overflow-y-auto pe-1"
        aria-label={t('operations.crewPlan.swap.pickSecond')}
      >
        {listed.length === 0 && (
          <li className="px-2 py-3 text-center text-[12px] font-bold text-slate-500 dark:text-slate-400">
            {t('operations.crewPlan.swap.noMatch')}
          </li>
        )}
        {listed.map((row) => {
          const captain = row.slots.captain[0];
          const people = rowPeople(row).length;
          return (
            <li key={row.key}>
              <button
                type="button"
                data-swap-choose={row.key}
                aria-pressed={row.key === bKey}
                onClick={() => choose(row.key)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-start text-[12.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  row.key === bKey
                    ? 'border-brand-400 bg-brand-500/10'
                    : 'border-slate-200 bg-white hover:border-brand-300 dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:hover:border-brand-500/60',
                )}
              >
                <BoardIcon
                  d={row.vehicleId === null ? PLAN_ICON.noVan : PATH.truck}
                  className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
                />
                <span
                  className={cn(NUM, 'shrink-0 font-black text-slate-900 dark:text-white')}
                  dir="auto"
                >
                  {rowName(row)}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-600 dark:text-slate-300">
                  {captain === undefined
                    ? t('operations.crewPlan.swap.noCaptain')
                    : member(captain).fullNameAr}
                  {row.direction === null ? '' : ` · ${row.direction}`}
                </span>
                <span className={cn(TAG, TAG_QUIET, NUM)}>
                  {t('operations.crewPlan.swap.people', { count: formatNumber(people, locale) })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  // ── The three arrows, between the cards ─────────────────────────────────────────────────────
  // Each named by what it does, with both vans — before the second is chosen, «السيارة الثانية»
  // stands for it (Round 34 critic: they read «نقل المحدد من 150 إلى —»); and, when it cannot act,
  // why: no second van yet, a move still playing, nothing ticked where it sends from.
  const rowsNow = work !== null && !choosing ? work : null;
  const wayName = (one: SwapMode): string =>
    t(`operations.crewPlan.swap.mode.${one}`, { a: name.a, b: name.b });
  const whyOf = (one: SwapMode): string | null => {
    const why = swapArrowWhy(win, one, rowsNow);
    if (why === null) return null;
    if (why === 'pickSecond') return t('operations.crewPlan.swap.pickSecondFirst');
    if (why === 'playing') return t('operations.crewPlan.swap.why.playing');
    return one === 'swap'
      ? t('operations.crewPlan.swap.why.nothingEither')
      : t('operations.crewPlan.swap.why.nothingOn', { row: name[one === 'aToB' ? 'a' : 'b'] });
  };
  const press = (one: SwapMode): void => {
    if (rowsNow === null || opening === null) return;
    // The move at once, and the arrow held while it lands (`createSwapWindow`).
    swap.press({ mode: one, rows: rowsNow, home: opening, rules });
  };
  const arrows = (
    // The arrows (`crew-swap-arrows.tsx`): the keys move the focus in the reading direction.
    <SwapArrows
      rtl={locale === 'ar'}
      label={t('operations.crewPlan.swap.mode.group')}
      nameOf={wayName}
      whyOf={whyOf}
      held={win.held}
      focusWay={focusWay}
      onFocusWay={(one, by) => {
        setFocusWay(one);
        if (by === 'key') modeButtons.current[one]?.focus();
      }}
      onPress={press}
      buttonRef={(one, node) => {
        modeButtons.current[one] = node;
      }}
    />
  );

  // ── Under the arrows: what the last press could not move, and why ───────────────────────────
  const notice =
    win.last !== null && win.last.refused.length > 0 ? (
      <div
        role="status"
        data-swap-notice="true"
        className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-bold text-rose-900 ring-1 ring-inset ring-rose-300 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/40"
      >
        <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
        <ul className="flex min-w-0 flex-col gap-0.5">
          {win.last.refused.map((one) => (
            <li key={`${one.from}:${one.item}`} data-swap-notice-item={one.item} dir="auto">
              {t('operations.crewPlan.swap.keptLine', {
                item: itemName(one.from, one.item),
                reason: reasonText(one.reason, name[otherSide(one.from)]),
              })}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  // ── The footer: «تطبيق», «إلغاء», «تراجع عن آخر نقل», what the presses came to ───────────────
  const lastStep = win.steps[win.steps.length - 1];
  const lastWhat =
    lastStep === undefined ? null : swapOperation(lastStep.mode, { a: name.a, b: name.b });
  const countVars = {
    moved: formatNumber(counts.moved, locale),
    replaced: formatNumber(counts.replaced, locale),
    kept: formatNumber(counts.kept, locale),
  };
  const summary =
    opening === null
      ? t('operations.crewPlan.swap.pickSecondFirst')
      : win.steps.length === 0 && win.last === null
        ? t('operations.crewPlan.swap.nothing')
        : t(
            counts.replaced > 0
              ? 'operations.crewPlan.swap.summaryReplaced'
              : 'operations.crewPlan.swap.summary',
            countVars,
          );
  const apply = (): void => {
    if (bKey === null || !changed) return;
    onApply(bKey, win.steps);
  };
  // ✕, Escape and «إلغاء»: close with nothing changed; ask first when the moves change something;
  // on the question, back to the window (`swapCloseStep`).
  const panel = (): HTMLElement | null =>
    inside.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
  const requestClose = (): void => {
    const step = swapCloseStep(win, changed);
    if (step === 'close') {
      onClose();
      return;
    }
    swap.send({ type: step });
    requestAnimationFrame(() =>
      panel()
        ?.querySelector<HTMLElement>(
          step === 'ask' ? '[data-swap-close="apply"]' : '[data-swap-apply]',
        )
        ?.focus({ preventScroll: true }),
    );
  };

  return (
    <DesignDialog
      open
      onClose={requestClose}
      title={t('operations.crewPlan.swap.title')}
      subtitle={t('operations.crewPlan.swap.subtitle')}
      icon={PLAN_ICON.swap}
      width="6xl"
      dense
      panelProps={{ 'data-crew-swap': aKey }}
      footer={
        win.closing ? (
          <SwapCloseAsk
            question={t('operations.crewPlan.swap.closeAsk')}
            applyLabel={t('operations.crewPlan.swap.apply')}
            discardLabel={t('operations.crewPlan.swap.closeDiscard')}
            stayLabel={t('operations.crewPlan.swap.closeStay')}
            onApply={apply}
            onDiscard={onClose}
            onStay={requestClose}
          />
        ) : (
          <SwapFooter
            applyLabel={t('operations.crewPlan.swap.apply')}
            applyWhy={
              opening === null
                ? t('operations.crewPlan.swap.pickSecondFirst')
                : changed
                  ? null
                  : t('operations.crewPlan.swap.nothingChanged')
            }
            moved={counts.moved}
            onApply={apply}
            onCancel={requestClose}
            undoLabel={t('operations.crewPlan.swap.undoLast')}
            undoName={
              lastWhat === null
                ? t('operations.crewPlan.swap.undoNone')
                : t('operations.crewPlan.swap.undoLastTitle', {
                    what: t(`operations.crewPlan.undo.kind.${lastWhat.kind}`, { ...lastWhat.vars }),
                  })
            }
            steps={win.steps.length}
            onUndo={swap.undo}
            summary={summary}
            hint={changed ? t('operations.crewPlan.swap.applyHint') : null}
          />
        )
      }
    >
      <div ref={inside} className="flex flex-col gap-3" data-swap-body="true">
        {/* The two cards side by side, the first on the start side (the right in Arabic), the
            arrows between them; the cards are the working copy — every press shows on them. */}
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {pickCard('a', work?.a ?? a)}
          <div className="lg:self-center">{arrows}</div>
          {choosing || work === null ? chooser : pickCard('b', work.b)}
        </div>
        {notice}
      </div>
    </DesignDialog>
  );
};

/**
 * The window's footer — no hooks of its own, so what each button does is its own handler, which a
 * suite can call: «تطبيق» hands the presses on (off while nothing has changed, and saying so);
 * «إلغاء» asks the window to close (it asks first when the moves change something); «تراجع عن آخر
 * نقل» takes the last press back (off with none); the summary «نُقل … — بقي …», and while the moves
 * change something the line that says where they go: «تنتقل التغييرات إلى اللوحة عند «تطبيق»».
 * A button that is off stays reachable and says why (`aria-disabled`, its reason in its name —
 * Round 34 D critic: a native `disabled` hid it from the keyboard and the screen reader), and the
 * undo's spoken name begins with the words it shows (WCAG 2.5.3).
 */
export const SwapFooter = ({
  applyLabel,
  applyWhy,
  moved,
  onApply,
  onCancel,
  undoLabel,
  undoName,
  steps,
  onUndo,
  summary,
  hint,
}: {
  applyLabel: string;
  /** Why «تطبيق» is off — or null when it applies. */
  applyWhy: string | null;
  /** What differs from the opening: every item on a card it did not open on, or in another slot. */
  moved: number;
  onApply: () => void;
  onCancel: () => void;
  undoLabel: string;
  /** What the undo takes back, or that there is nothing to — its tooltip, after its label in its name. */
  undoName: string;
  /** The presses so far — the undo is off with none. */
  steps: number;
  onUndo: () => void;
  summary: string;
  /** While the moves change something: where they go, and when. */
  hint: string | null;
}): JSX.Element => (
  // One line from `sm`; on a phone the count and the line about the board take a line of their own
  // under the buttons (Round 34 D critic — squeezed beside them they broke a word to a line).
  <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <DesignSave
      data-swap-apply={String(moved)}
      {...(applyWhy === null ? {} : { why: applyWhy })}
      onClick={onApply}
      label={applyLabel}
    />
    <DesignCancel onClick={onCancel} />
    <button
      type="button"
      data-swap-undo={String(steps)}
      aria-disabled={steps === 0 ? true : undefined}
      title={undoName}
      aria-label={`${undoLabel} — ${undoName}`}
      onClick={() => {
        if (steps > 0) onUndo();
      }}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-white dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-200 dark:hover:bg-slate-700/80 dark:aria-disabled:hover:bg-[#1a2550]"
    >
      <BoardIcon d={SHIPMENT_PATH.undo} className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{undoLabel}</span>
    </button>
    <span className="flex min-w-0 basis-full flex-col items-start gap-0.5 text-start sm:flex-1 sm:basis-0 sm:items-end sm:text-end">
      <span
        className="text-[11.5px] font-bold leading-tight text-slate-600 sm:text-[12.5px] dark:text-slate-300"
        role="status"
        data-swap-summary="true"
      >
        {summary}
      </span>
      {hint !== null && (
        <span
          className="text-[11px] font-semibold leading-tight text-slate-500 sm:text-[11.5px] dark:text-slate-400"
          data-swap-apply-hint="true"
        >
          {hint}
        </span>
      )}
    </span>
  </div>
);

/**
 * The question ✕, Escape and «إلغاء» ask while the moves change something (Round 34 D critic —
 * they dropped every move without a word): «تطبيق» hands them on, «تجاهل التغييرات» closes with
 * nothing handed over, «متابعة التعديل» (and ✕ / Escape again) goes back to the window. In the
 * footer's place, in the window itself; no hooks of its own, so a suite calls its handlers.
 */
export const SwapCloseAsk = ({
  question,
  applyLabel,
  discardLabel,
  stayLabel,
  onApply,
  onDiscard,
  onStay,
}: {
  question: string;
  applyLabel: string;
  discardLabel: string;
  stayLabel: string;
  onApply: () => void;
  onDiscard: () => void;
  onStay: () => void;
}): JSX.Element => (
  <div
    className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
    data-swap-close-ask="true"
  >
    <p
      role="alert"
      className="flex min-w-0 basis-full items-start gap-2 text-[13px] font-bold text-amber-900 lg:basis-auto lg:flex-1 dark:text-amber-200"
    >
      <BoardIcon d={PATH.warn} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{question}</span>
    </p>
    <DesignSave data-swap-close="apply" onClick={onApply} label={applyLabel} />
    <button
      type="button"
      data-swap-close="discard"
      onClick={onDiscard}
      className="h-10 shrink-0 rounded-xl border border-rose-300 bg-white px-4 text-[14px] font-bold text-rose-700 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 dark:border-rose-400/40 dark:bg-[#1a2550] dark:text-rose-200 dark:hover:bg-rose-500/10"
    >
      {discardLabel}
    </button>
    <button
      type="button"
      data-swap-close="stay"
      onClick={onStay}
      className="h-10 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-[14px] font-bold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-200 dark:hover:bg-slate-700/80"
    >
      {stayLabel}
    </button>
  </div>
);

/** A card's head, on one line: the van (a truck, or «بدون سيارة»), which card, its tools. */
const CardHead = ({
  id,
  order,
  name,
  row,
  drivers,
  shipments,
  tools,
}: {
  id: string;
  order: string;
  name: string;
  row: PlanRow;
  /** The drivers — Fleet's, they stay with the van — under the line; null for none. */
  drivers: string | null;
  /** Round 32 critic — «محصنات: ٦», the shipments riding the row (they stay); null for none. */
  shipments: string | null;
  tools: ReactNode;
}): JSX.Element => (
  <header className="flex min-w-0 flex-col gap-0.5 border-b border-slate-200 pb-2 dark:border-[#2b3b6b]/70">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-300/60 bg-brand-500/10 text-brand-700 dark:border-brand-500/40 dark:text-brand-200">
        <BoardIcon d={row.vehicleId === null ? PLAN_ICON.noVan : PATH.truck} className="h-4 w-4" />
      </span>
      <h3
        id={id}
        className={cn(
          NUM,
          'min-w-0 truncate text-[17px] font-black text-slate-900 dark:text-white',
        )}
        dir="auto"
      >
        {name}
      </h3>
      <span className="shrink-0 text-[10.5px] font-black text-slate-500 dark:text-slate-400">
        {order}
      </span>
      {shipments !== null && (
        <span
          className={cn(
            TAG,
            'gap-1 bg-amber-100 px-1.5 text-amber-900 ring-1 ring-inset ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30',
          )}
          data-swap-shipments="true"
        >
          {shipments}
        </span>
      )}
      {tools !== null && (
        <span className="ms-auto flex flex-wrap items-center justify-end gap-1">{tools}</span>
      )}
    </div>
    {drivers !== null && row.drivers.length > 0 && (
      <p className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {drivers}
      </p>
    )}
  </header>
);

/** The people: a label column, then one line a person. */
const SLOT_GRID = 'grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1';
/** The fields: two to a line where the card has the room, the notes a line of their own. */
const FIELD_GRID = cn(
  'grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 border-t border-slate-200 pt-2 dark:border-[#2b3b6b]/70',
  'sm:grid-cols-[4.75rem_minmax(0,1fr)_3.75rem_minmax(0,1fr)]',
);
const QUIET_BUTTON =
  'rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-black text-slate-700 transition hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:text-slate-200 dark:hover:text-brand-200';

/** A label and what it names, as two cells of the card's grid (`wide` — the rest of the line). */
const Labelled = ({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element => (
  <>
    {/* A wide one starts its own line (Round 32 critic): after an odd count of fields its label
        fell in the third column and its value wrapped under the first label. */}
    <span className={cn(GROUP_LABEL, 'pt-1.5', wide && 'sm:col-start-1')}>{label}</span>
    <div className={cn('flex min-w-0 flex-col gap-1', wide && 'sm:col-span-3')}>{children}</div>
  </>
);

const Empty = ({ bare = false }: { bare?: boolean }): JSX.Element => (
  <span
    className={cn('text-[12px] font-bold text-slate-400 dark:text-slate-500', !bare && 'px-2 py-1')}
  >
    —
  </span>
);
