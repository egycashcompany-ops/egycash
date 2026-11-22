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
//   · BETWEEN THEM, how the ticked items go: «تبديل المحدد ⇄» (both cards' ticks cross at once), or
//     «نقل المحدد» one way (only the sending card's);
//   · UNDER THEM, the two cards AFTER the change, side by side, before anything is touched: what
//     arrives («من 213»), the value a moved field replaces (struck), what goes, and what a board rule
//     keeps where it is — with the rule's reason (away that day, a slot his role does not fit, no room
//     left, an archived type). `lib/crew-swap.ts` decides all of it; this file only draws it;
//   · «تطبيق» hands the ticks to the page, which applies them to the DRAFT as ONE step of «تراجع»;
//     nothing is written until «حفظ».
//
// THE KEYBOARD: every box is a real checkbox named by what it moves and where («نقل أحمد علي — قائد
// الطاقم — إلى 213»); the three ways are a radio group (the arrows move in it); Tab stays inside the
// window and Escape closes it, the focus going back to the row's «⇄».
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  type Locale,
  type OperationsCrewMemberDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { foldIncludes } from '../../../shared/lib/fold';
import { formatNumber } from '../../../shared/lib/format';
import { custodyTrapFocus } from '../../fleet/components/custody-dashboard-parts';
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
  SWAP_MODES,
  fieldItem,
  livePicks,
  otherSide,
  personItem,
  planSwap,
  quickPick,
  sendsFrom,
  type SwapField,
  type SwapMode,
  type SwapPicks,
  type SwapRefusal,
  type SwapResult,
  type SwapRules,
  type SwapSide,
} from '../lib/crew-swap';
import { AWAY_BADGE, ROLE_DOT } from './CrewPlanChip';
import { PLAN_ICON } from './crew-plan-icons';
import { SHIFT_TYPE_TONE, ShiftTypeDot, shiftTypeName } from './shift-type-look';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab kept inside the window (the vault reports' trap, `custodyTrapFocus`), the first box to fill
 * focused, and the focus handed back to what opened it. Hooked on an element INSIDE the panel: the
 * window is the board's `DesignDialog`, and its panel is the nearest `[role="dialog"]`.
 */
const useFocusTrap = (inside: RefObject<HTMLElement>, first: () => HTMLElement | null): void => {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = (): HTMLElement | null =>
      inside.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    const stops = (): HTMLElement[] =>
      Array.from(panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    requestAnimationFrame(() => (first() ?? stops()[0])?.focus({ preventScroll: true }));
    let back = false;
    const trap = (active: Element | null, preventDefault?: () => void): void => {
      const box = panel();
      const list = stops();
      const head = list[0];
      const tail = list[list.length - 1];
      if (box === null || head === undefined || tail === undefined) return;
      const target = custodyTrapFocus<Element>({
        back,
        active,
        first: head,
        last: tail,
        inside: active !== null && box.contains(active),
      });
      if (!(target instanceof HTMLElement)) return;
      preventDefault?.();
      target.focus();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      // Only the window on top keeps the focus — a dialog opened over it keeps its own.
      const roots = document.querySelectorAll('[data-dialog-root]');
      if (roots[roots.length - 1]?.contains(panel()) !== true) return;
      back = event.shiftKey;
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => event.preventDefault());
    };
    const onFocusIn = (event: FocusEvent): void => {
      const roots = document.querySelectorAll('[data-dialog-root]');
      if (roots[roots.length - 1]?.contains(panel()) !== true) return;
      if (event.target instanceof Node && panel()?.contains(event.target) === false) {
        trap(event.target instanceof Element ? event.target : null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      if (opener?.isConnected === true) opener.focus({ preventScroll: true });
    };
    // Once for the window's life: who opened it, and where Tab goes round.
  }, []);
};

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
  onApply: (bKey: string, picks: SwapPicks, mode: SwapMode) => void;
  onClose: () => void;
  /** Opened on two rows already (both chosen on the board), ticks and way included. */
  initial?: { bKey: string; picks?: SwapPicks; mode?: SwapMode };
}

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
  const [picks, setPicks] = useState<SwapPicks>(initial?.picks ?? { a: [], b: [] });
  const [mode, setMode] = useState<SwapMode>(initial?.mode ?? 'swap');
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
  // The second row went meanwhile (another desk's save, «تراجع» outside): pick again.
  if (bKey !== null && b === undefined) {
    setBKey(null);
    setChoosing(true);
  }

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
  const live = b === undefined ? { a: picks.a, b: [] } : livePicks(a, b, picks);
  const result: SwapResult | null = b === undefined ? null : planSwap(a, b, live, mode, rules);
  const name = { a: rowName(a), b: b === undefined ? '—' : rowName(b) };
  const crossing = result?.moved.length ?? 0;
  const keptBack = result?.refused.length ?? 0;

  const choose = (key: string): void => {
    setBKey(key);
    setChoosing(false);
    setPicks((current) => ({ a: current.a, b: [] }));
    setSearch('');
    requestAnimationFrame(() =>
      inside.current
        ?.querySelector<HTMLElement>('[data-swap-change]')
        ?.focus({ preventScroll: true }),
    );
  };
  const toggle = (side: SwapSide, id: string): void =>
    setPicks((current) => {
      const list = current[side];
      const next = list.includes(id) ? list.filter((one) => one !== id) : [...list, id];
      return { ...current, [side]: next };
    });
  const pickAll = (side: SwapSide, row: PlanRow, pick: (typeof QUICK_PICKS)[number]): void =>
    setPicks((current) => ({ ...current, [side]: quickPick(row, pick) }));

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
      const colour = value as CrewRowColour;
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn('h-3 w-3 shrink-0 rounded', SHIFT_TYPE_TONE[colour].dot)}
          />
          <span className="truncate font-bold">{colourName(colour)}</span>
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
        ? colourName(value as CrewRowColour)
        : value;
  const reasonText = (reason: SwapRefusal, toRow: string): string =>
    t(`operations.crewPlan.swap.reason.${reason}`, { row: toRow });

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

  // ── A card BEFORE: everything its row holds, each with its box ─────────────────────────────
  // Dense, so both cards and the preview under them fit a 1440×900 screen: a label column, one
  // line a person, the fields two to a line (the notes a line of their own).
  const pickCard = (side: SwapSide, row: PlanRow): JSX.Element => {
    const ticks = side === 'a' ? live.a : live.b;
    const sending = sendsFrom(mode, side);
    const to = name[otherSide(side)];
    const box = (id: string, label: string, content: ReactNode): JSX.Element => {
      const on = ticks.includes(id);
      return (
        <label
          key={id}
          data-swap-item={id}
          data-swap-ticked={on ? 'true' : undefined}
          className={cn(
            'flex min-h-[1.75rem] min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[12.5px] transition',
            sending ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            on && sending
              ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-400/70 dark:bg-brand-500/20 dark:ring-brand-400/50'
              : 'hover:bg-slate-100 dark:hover:bg-white/5',
          )}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={!sending}
            aria-label={t('operations.crewPlan.swap.item', { item: label, to })}
            onChange={() => toggle(side, id)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
          />
          {content}
        </label>
      );
    };
    const fieldBox = (field: SwapField): JSX.Element => {
      const value = row[field];
      return value === null ? (
        <Empty />
      ) : (
        box(
          fieldItem(field),
          `${fieldLabel(field)}: ${fieldText(field, value)}`,
          <span className="flex min-w-0 flex-1 items-center text-slate-900 dark:text-white">
            {fieldValue(field, value)}
          </span>,
        )
      );
    };
    return (
      <section
        aria-labelledby={`${titleId}-${side}`}
        data-swap-card={side}
        data-swap-row={row.key}
        className={cn(CARD, 'flex flex-col gap-2')}
      >
        <CardHead
          id={`${titleId}-${side}`}
          order={t(`operations.crewPlan.swap.${side === 'a' ? 'first' : 'second'}`)}
          name={name[side]}
          row={row}
          drivers={t('operations.crewPlan.swap.drivers', {
            names: row.drivers.map((driver) => driver.fullNameAr ?? '—').join('، '),
          })}
          tools={
            <>
              {!sending && (
                <span
                  className={cn(TAG, TAG_QUIET, 'px-1.5')}
                  title={t('operations.crewPlan.swap.receivingHint')}
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
                    disabled={!sending}
                    onClick={() => pickAll(side, row, pick)}
                    className={QUIET_BUTTON}
                  >
                    {t(`operations.crewPlan.swap.quick.${pick}`)}
                  </button>
                ))}
              </span>
              {side === 'b' && (
                <button
                  type="button"
                  data-swap-change="true"
                  onClick={() => {
                    setChoosing(true);
                    requestAnimationFrame(() => searchBox.current?.focus({ preventScroll: true }));
                  }}
                  aria-label={t('operations.crewPlan.swap.changeLabel')}
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
      </section>
    );
  };

  // ── A card AFTER: what the row will hold, what arrives, what it loses, what stays ──────────
  const previewCard = (
    side: SwapSide,
    before: PlanRow,
    row: PlanRow,
    outcome: SwapResult,
  ): JSX.Element => {
    const other = otherSide(side);
    const from = name[other];
    const arrived = new Set(
      outcome.moved.filter((move) => move.from === other).map((move) => move.item),
    );
    const kept = new Map(
      outcome.refused.filter((one) => one.from === side).map((one) => [one.item, one.reason]),
    );
    const replaced = new Map(
      outcome.replaced.filter((one) => one.on === side).map((one) => [one.field, one.was]),
    );
    const leaving = outcome.moved
      .filter((move) => move.from === side)
      .map((move) =>
        move.item.startsWith('person:')
          ? member(move.item.slice('person:'.length)).fullNameAr
          : fieldLabel(move.item.slice('field:'.length) as SwapField),
      );
    const keptTag = (id: string): ReactNode => {
      const reason = kept.get(id);
      if (reason === undefined) return null;
      return (
        <span
          className={cn(TAG, TAG_KEPT, 'max-w-full whitespace-normal py-0.5')}
          data-swap-kept={id}
        >
          {t('operations.crewPlan.swap.kept')} — {reasonText(reason, from)}
        </span>
      );
    };
    const fromTag = (id: string): ReactNode =>
      arrived.has(id) ? (
        <span className={cn(TAG, TAG_FROM)} data-swap-arrived={id}>
          {t('operations.crewPlan.swap.from', { row: from })}
        </span>
      ) : null;
    const mark = (id: string): string =>
      cn(
        'flex min-h-[1.5rem] min-w-0 flex-wrap items-center gap-1 rounded-md px-1.5 py-px text-[12.5px] text-slate-900 dark:text-white',
        arrived.has(id) &&
          'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/60 dark:bg-emerald-500/15',
        kept.has(id) && 'ring-1 ring-inset ring-rose-400/70',
      );
    return (
      <section
        aria-labelledby={`${titleId}-after-${side}`}
        data-swap-preview={side}
        className={cn(CARD, 'flex flex-col gap-2')}
      >
        <CardHead
          id={`${titleId}-after-${side}`}
          order={`${t(`operations.crewPlan.swap.${side === 'a' ? 'first' : 'second'}`)} · ${t('operations.crewPlan.swap.after')}`}
          name={name[side]}
          row={row}
          drivers={null}
          tools={null}
        />
        <div className={SLOT_GRID}>
          {CREW_SLOTS.map((slot) => (
            <Labelled key={slot} label={t(`operations.crewPlan.columns.${slot}`)}>
              {row.slots[slot].length === 0 ? (
                <Empty />
              ) : (
                row.slots[slot].map((employeeId) => {
                  const id = personItem(employeeId);
                  return (
                    <div key={id} className={mark(id)}>
                      {personLine(employeeId, slot)}
                      {fromTag(id)}
                      {keptTag(id)}
                    </div>
                  );
                })
              )}
            </Labelled>
          ))}
        </div>
        <div className={FIELD_GRID}>
          {/* What the row holds after — and a field it no longer holds, «—»; one empty before and
              after says nothing and is left out. */}
          {SWAP_FIELDS.filter((field) => row[field] !== null || before[field] !== null).map(
            (field) => {
              const id = fieldItem(field);
              const value = row[field];
              const was = replaced.get(field);
              return (
                <Labelled key={field} label={fieldLabel(field)} wide={field === 'notes'}>
                  <div className={mark(id)}>
                    {value === null ? <Empty bare /> : fieldValue(field, value)}
                    {fromTag(id)}
                    {was !== undefined && (
                      <span
                        className="text-[11px] font-semibold text-slate-500 dark:text-slate-400"
                        data-swap-replaced={field}
                      >
                        {t('operations.crewPlan.swap.was')}{' '}
                        <s className="decoration-rose-500 decoration-2" dir="auto">
                          {fieldText(field, was)}
                        </s>
                      </span>
                    )}
                    {keptTag(id)}
                  </div>
                </Labelled>
              );
            },
          )}
        </div>
        {leaving.length > 0 && (
          <p
            className="rounded-lg bg-slate-200/60 px-2 py-1 text-[11.5px] font-bold text-slate-600 dark:bg-white/5 dark:text-slate-300"
            data-swap-leaving={side}
          >
            {t('operations.crewPlan.swap.left', { row: from, items: leaving.join('، ') })}
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

  // ── The three ways, between the cards ───────────────────────────────────────────────────────
  const stepMode = (by: number): void => {
    const at = SWAP_MODES.indexOf(mode);
    const next = SWAP_MODES[(at + by + SWAP_MODES.length) % SWAP_MODES.length] as SwapMode;
    setMode(next);
    modeButtons.current[next]?.focus();
  };
  const modes = (
    <div
      role="radiogroup"
      aria-label={t('operations.crewPlan.swap.mode.group')}
      data-swap-modes="true"
      onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          stepMode(1);
        } else if (['ArrowUp', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          stepMode(-1);
        }
      }}
      className="flex flex-row flex-wrap items-stretch justify-center gap-2 lg:w-36 lg:flex-col lg:justify-center"
    >
      {SWAP_MODES.map((one) => {
        const on = mode === one;
        return (
          <button
            key={one}
            ref={(node) => {
              modeButtons.current[one] = node;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-swap-mode={one}
            disabled={b === undefined}
            title={t(`operations.crewPlan.swap.mode.${one}Hint`, { a: name.a, b: name.b })}
            onClick={() => setMode(one)}
            className={cn(
              'flex min-w-[7.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-[12.5px] font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-50 lg:flex-none',
              on
                ? 'border-brand-500 bg-brand-500 text-white shadow-[0_6px_18px_-6px_rgba(91,76,255,0.7)]'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:text-slate-200 dark:hover:text-brand-200',
            )}
          >
            <span className="whitespace-nowrap">{t(`operations.crewPlan.swap.mode.${one}`)}</span>
            <span
              className={cn(
                'text-[10.5px] font-bold',
                on ? 'text-white/85' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {t(`operations.crewPlan.swap.mode.${one}Short`, { a: name.a, b: name.b })}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <DesignDialog
      open
      onClose={onClose}
      title={t('operations.crewPlan.swap.title')}
      subtitle={t('operations.crewPlan.swap.subtitle')}
      icon={PLAN_ICON.swap}
      width="6xl"
      dense
      panelProps={{ 'data-crew-swap': aKey }}
      footer={
        <>
          <DesignSave
            data-swap-apply={String(crossing)}
            disabled={result === null || crossing === 0}
            onClick={() => {
              if (bKey === null || result === null || crossing === 0) return;
              onApply(bKey, live, mode);
            }}
            label={t('operations.crewPlan.swap.apply')}
          />
          <DesignCancel onClick={onClose} />
          <span
            className="min-w-0 flex-1 text-end text-[12.5px] font-bold text-slate-600 dark:text-slate-300"
            role="status"
            data-swap-summary="true"
          >
            {result === null
              ? t('operations.crewPlan.swap.pickSecondFirst')
              : crossing === 0 && keptBack === 0
                ? t('operations.crewPlan.swap.nothing')
                : t('operations.crewPlan.swap.summary', {
                    moved: formatNumber(crossing, locale),
                    kept: formatNumber(keptBack, locale),
                  })}
          </span>
        </>
      }
    >
      <div ref={inside} className="flex flex-col gap-3" data-swap-body="true">
        {/* BEFORE — the two cards side by side, the first on the start side (the right in Arabic),
            how the ticks go between them. */}
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {pickCard('a', a)}
          <div className="lg:self-center">{modes}</div>
          {choosing || b === undefined ? chooser : pickCard('b', b)}
        </div>

        {/* AFTER — the same two cards as «تطبيق» would leave them. */}
        {result !== null && b !== undefined && (
          <section aria-labelledby={`${titleId}-preview`} data-swap-after="true">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
              <h3
                id={`${titleId}-preview`}
                className="flex items-center gap-1.5 text-[14px] font-black text-slate-900 dark:text-white"
              >
                <BoardIcon
                  d={PLAN_ICON.swap}
                  className="h-4 w-4 text-brand-600 dark:text-brand-300"
                />
                {t('operations.crewPlan.swap.preview')}
              </h3>
              <span className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                {t('operations.crewPlan.swap.previewHint')}
              </span>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {previewCard('a', a, result.a, result)}
              {previewCard('b', b, result.b, result)}
            </div>
          </section>
        )}
      </div>
    </DesignDialog>
  );
};

/** A card's head, on one line: the van (a truck, or «بدون سيارة»), which card, its tools. */
const CardHead = ({
  id,
  order,
  name,
  row,
  drivers,
  tools,
}: {
  id: string;
  order: string;
  name: string;
  row: PlanRow;
  /** The drivers — Fleet's, they stay with the van — under the line; null on the preview. */
  drivers: string | null;
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
  'rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-black text-slate-700 transition hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#2b3b6b] dark:bg-[#121c3f] dark:text-slate-200 dark:hover:text-brand-200';

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
    <span className={cn(GROUP_LABEL, 'pt-1.5')}>{label}</span>
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
