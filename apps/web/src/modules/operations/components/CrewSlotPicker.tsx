// «لوحة التشغيلة» — the list a slot opens (Round 22 E).
//
// THE OWNER: «وعاوز مكان عند العربيه زى الحركة كدا لما ادوس عليه يجيب قايمة الناس اللى اختار منهم».
// Fleet's «الحركة» board: an empty seat says «+ اختيار سائق»; pressing it opens the drivers to pick
// from, searchable, under the seat (`DriverSlotPicker`) — and on a phone the same list rises as a
// bottom sheet (`RosterBottomSheet`). This is that, for a crew slot:
//   · the head says which slot of which row is being filled;
//   · ROUND 23 — ONLY WHO FITS THE SLOT («ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد
//     اخصائى»): «قائد الطاقم» the captains, «أخصائي 1/2» the specialists, and in both the
//     captain-specialists at the end. The two pool tabs it had are gone — the other pool held only
//     people the slot refuses — and a strip says who is offered, in that order, and how many are
//     free («متاح N»). Why the blue ones are folded in rather than a tab: `crew-picker.ts`;
//   · a search by name or code (folded: «احمد» finds «أحمد»), on the keyboard from the start;
//   · the people as Fleet's list draws drivers — a round mark in the ROLE'S colour (green, blue,
//     red), the name, the code and the requirement icons under it, and at the end what he is now:
//     «متاح», where he sits («249 · أخصائي 1» — picking him moves him), or «غائب» / «إجازة», listed
//     last and closed (`slotPickList` says why each is where it is).
// Picking runs the drop's own rule and step (`resolveDrop`, then `placeMember` — the page's), and the
// list closes. It closes too on Escape (back on the slot), a press outside, or its ✕.
//
// THE KEYBOARD AND A SCREEN READER: the search is a combobox over a listbox; the arrows walk the
// options that can be picked (the closed ones are skipped, and said as unavailable), Enter picks,
// Escape closes. Each part of the list is a group named by its heading.
//
// A COMPUTER draws it under the slot (over it when there is more room above), in a layer over the
// page — the table scrolls, and a list inside a cell is cut by its edge — kept in place while
// anything under it scrolls. A PHONE gets Fleet's bottom sheet.
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { CloseIcon, UserIcon } from '../../../shared/ui/icons';
import { floatingSpot } from '../../../shared/ui/MultiSelect';
import { useAppSelector } from '../../../store';
import { NUM } from '../../fleet/components/FuelCardBoard';
import { BottomSheet } from '../../fleet/components/roster/RosterBottomSheet';
import { crewRoleOf, flagsOf, type CrewRole, type CrewSlot, type PlanRow } from '../lib/crew-plan';
import {
  PICK_SECTIONS,
  nextPickable,
  slotPickList,
  slotPool,
  slotRoles,
  type PickOption,
  type PickSection,
} from '../lib/crew-picker';
import { AWAY_BADGE, ROLE_DOT } from './CrewPlanChip';
import { CrewFlagMarks } from './crew-plan-icons';
import { scopedKey, useCrewPlanScope } from './crew-plan-scope';

/** The list's width and its tallest on a computer — a name, its code and its badge on one line. */
const PICKER_WIDTH = 352;
const PICKER_TALL = 440;

/** The person's round mark, in the role's colour — Fleet's drivers list draws a green one. */
const ROLE_MARK: Record<CrewRole, string> = {
  captain: 'bg-emerald-600 dark:bg-emerald-600',
  dual: 'bg-sky-600 dark:bg-sky-600',
  specialist: 'bg-rose-600 dark:bg-rose-600',
};

const SECTION_BADGE: Record<Exclude<PickSection, 'away'>, string> = {
  free: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  seated:
    'bg-sky-50 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30',
};

/** Where the list goes on a computer: under the slot, or over it when there is more room above. */
interface Spot {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export const usePickerSpot = (
  anchor: RefObject<HTMLElement | null>,
  enabled: boolean,
): Spot | null => {
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const place = (): void => {
      const element = anchor.current;
      if (element === null || !element.isConnected) return;
      const rect = element.getBoundingClientRect();
      const width = Math.min(PICKER_WIDTH, window.innerWidth - 16);
      // Along the text from the slot's start edge, never past either side (the shared rule).
      const { left } = floatingSpot(rect, width, {
        width: window.innerWidth,
        height: window.innerHeight,
        rtl: getComputedStyle(element).direction === 'rtl',
      });
      const roomBelow = window.innerHeight - rect.bottom - 12;
      const roomAbove = rect.top - 12;
      const below = roomBelow >= 320 || roomBelow >= roomAbove;
      const maxHeight = Math.max(200, Math.min(PICKER_TALL, below ? roomBelow : roomAbove));
      setSpot(
        below
          ? { left, width, maxHeight, top: rect.bottom + 4 }
          : { left, width, maxHeight, bottom: window.innerHeight - rect.top + 4 },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, enabled]);
  return spot;
};

/** What the page hands the picker. */
export interface SlotPickerProps {
  /** The slot being filled. The page mounts the picker per slot (a `key`), so it starts afresh. */
  target: { key: string; slot: CrewSlot };
  slotName: string;
  rowName: string;
  /** The slot on the page — the list is placed under it. */
  anchor: RefObject<HTMLElement | null>;
  /** What opened it — a press there is not «outside». */
  trigger: RefObject<HTMLElement | null>;
  /** A phone: Fleet's bottom sheet instead of a list under the slot. */
  sheet: boolean;
  members: readonly OperationsCrewMemberDto[];
  rows: readonly PlanRow[];
  /** The roster has arrived — until then an empty list means «not known yet». */
  ready: boolean;
  /** Where somebody sits, in words («249 · أخصائي 1»), or null. */
  seatLabel: (employeeId: string) => string | null;
  onPick: (employeeId: string) => void;
  /** `back`: put the focus back on the slot (Escape, the ✕) — not after a press elsewhere. */
  onClose: (back: boolean) => void;
}

/**
 * Everything the picker draws, built once for both of its homes — the computer's panel under the
 * slot and the phone's bottom sheet, which place the same parts differently. Exported for the
 * specs: the web suite runs in node, with no page to draw the panel over.
 */
export const useSlotPickerParts = ({
  target,
  slotName,
  rowName,
  sheet,
  members,
  rows,
  ready,
  seatLabel,
  onPick,
  onClose,
}: Omit<SlotPickerProps, 'anchor' | 'trigger'>): {
  head: JSX.Element;
  offers: JSX.Element;
  searchBox: JSX.Element;
  list: JSX.Element;
  title: string;
  panel: RefObject<HTMLDivElement>;
  onPanelKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  close: (back: boolean) => void;
} => {
  const t = useT();
  // «في التشغيلة — اختياره ينقله إلى هنا» on the board; «في الطاقم الثابت — …» on its screen.
  const scope = useCrewPlanScope();
  const locale = useAppSelector((state) => state.locale.locale);
  const id = useId();
  const [search, setSearch] = useState('');
  /** The option the arrows are on, by who it is — a list that changes under it keeps it. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const { options, free } = slotPickList(members, rows, target, search);
  const indexOf = new Map(options.map((one, index) => [one, index]));
  const found = options.findIndex((option) => option.member.employeeId === activeId);
  const active =
    found >= 0 && options[found]?.pickable === true ? found : nextPickable(options, -1, 1);
  const optionId = (employeeId: string): string => `${id}-o-${employeeId}`;
  const activeOption = active >= 0 ? options[active] : undefined;

  // On a computer the search takes the keyboard at once; a phone keeps its keyboard down until
  // the search is pressed — it would cover the list.
  useEffect(() => {
    if (sheet) return undefined;
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [sheet]);

  const activeKey = activeOption?.member.employeeId ?? null;
  useEffect(() => {
    if (activeKey !== null) {
      document.getElementById(`${id}-o-${activeKey}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeKey, id]);

  const pick = (option: PickOption | undefined): void => {
    if (option === undefined || !option.pickable) return;
    onPick(option.member.employeeId);
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextPickable(options, active, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) setActiveId(options[next]?.member.employeeId ?? null);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(activeOption);
    }
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    // The list's Escape alone: the page's own Escape (dropping a picked-up chip) must not fire.
    event.preventDefault();
    event.stopPropagation();
    close.current(true);
  };

  // Who this slot's list offers, in its order — the slot's own role, then the captain-specialists
  // («يكونوا فى الاخر») — and how many of them are free. Said, so the planner reading a specialist's
  // list knows no captain-only is missing from it by mistake.
  const roles = slotRoles(target.slot);
  const offers = (
    <div
      data-picker-offers={target.slot === 'captain' ? 'captain' : 'specialist'}
      className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-slate-100 px-2 py-1 text-[11.5px] font-bold text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"
    >
      <span className="text-slate-500 dark:text-slate-400">
        {t('operations.crewPlan.picker.offers')}
      </span>
      {roles.map((role, at) => (
        <Fragment key={role}>
          {at > 0 && (
            <span className="text-slate-400 dark:text-slate-500">
              {t('operations.crewPlan.picker.then')}
            </span>
          )}
          <span className="inline-flex items-center gap-1" data-picker-offers-role={role}>
            <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', ROLE_DOT[role])} />
            <span className="text-slate-800 dark:text-slate-100">
              {t(`operations.crewPlan.role.${role}`)}
            </span>
            {role === 'dual' && (
              <span className="text-slate-500 dark:text-slate-400">
                {t('operations.crewPlan.picker.dualsLast')}
              </span>
            )}
          </span>
        </Fragment>
      ))}
      {ready && (
        <span className="ms-auto shrink-0 rounded-full bg-white px-1.5 text-[11px] font-black text-slate-700 ring-1 ring-slate-900/5 dark:bg-slate-700 dark:text-slate-200 dark:ring-white/10">
          {t('operations.crewPlan.pools.free', { count: formatNumber(free, locale) })}
        </span>
      )}
    </div>
  );

  const searchBox = (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeKey === null ? undefined : optionId(activeKey)}
        aria-label={`${slotName} — ${t('operations.crewPlan.pools.search')}`}
        autoComplete="off"
        placeholder={t('operations.crewPlan.pools.search')}
        value={search}
        data-picker-search="true"
        onChange={(event) => {
          setSearch(event.target.value);
          setActiveId(null);
        }}
        onKeyDown={onSearchKey}
        // 16px words on a phone: smaller, and the phone zooms the page in as the search is pressed.
        className="h-9 w-full rounded-lg border border-slate-300 bg-white pe-2 ps-8 text-base font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25 sm:h-8 sm:text-[12.5px] dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-100"
      />
    </div>
  );

  const option = (one: PickOption): JSX.Element => {
    const { member } = one;
    const on = indexOf.get(one) === active;
    const seat = one.section === 'seated' ? seatLabel(member.employeeId) : null;
    const badge =
      one.away !== null ? (
        <span
          className={cn('rounded px-1.5 text-[11px] font-black leading-5', AWAY_BADGE[one.away])}
        >
          {t(`operations.crewPlan.away.${one.away}`)}
        </span>
      ) : one.section === 'seated' ? (
        <span
          className={cn(
            NUM,
            'max-w-[9.5rem] truncate rounded px-1.5 text-[11px] font-black leading-5',
            SECTION_BADGE.seated,
          )}
        >
          {seat ?? '—'}
        </span>
      ) : (
        <span className={cn('rounded px-1.5 text-[11px] font-black leading-5', SECTION_BADGE.free)}>
          {t('operations.crewPlan.picker.free')}
        </span>
      );
    return (
      <div
        key={member.employeeId}
        id={optionId(member.employeeId)}
        role="option"
        aria-selected={on}
        aria-disabled={one.pickable ? undefined : true}
        data-pick-option={member.employeeId}
        data-pick-section={one.section}
        data-pick-active={on ? 'true' : undefined}
        onMouseEnter={() => {
          if (one.pickable) setActiveId(member.employeeId);
        }}
        // The search keeps the keyboard: a press on an option is a pick, not a move of the focus.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => pick(one)}
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors',
          one.pickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
          on && 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/40 dark:bg-brand-500/15',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white',
            ROLE_MARK[crewRoleOf(member.requirements)],
            !one.pickable && 'saturate-50',
          )}
        >
          <UserIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold leading-5 text-slate-900 dark:text-slate-50">
            {member.fullNameAr}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
            <bdi dir="ltr" className={NUM}>
              {member.code}
            </bdi>
            <CrewFlagMarks flags={flagsOf(member)} size="xs" />
          </span>
        </span>
        <span className="shrink-0">{badge}</span>
      </div>
    );
  };

  const narrowed = search.trim() !== '';
  const list = (
    <div
      id={`${id}-list`}
      role="listbox"
      aria-label={`${slotName} — ${rowName}`}
      data-picker-list={target.slot === 'captain' ? 'captain' : 'specialist'}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overscroll-contain',
        sheet ? 'px-3 py-2' : 'p-1.5',
      )}
    >
      {ready && options.length === 0 && (
        <p className="px-2 py-6 text-center text-[12.5px] font-bold text-slate-500 dark:text-slate-400">
          {narrowed
            ? t('operations.crewPlan.pools.noMatch')
            : t(`operations.crewPlan.pools.empty.${slotPool(target.slot)}`)}
        </p>
      )}
      {PICK_SECTIONS.map((section) => {
        const part = options.filter((one) => one.section === section);
        if (part.length === 0) return null;
        return (
          <div
            key={section}
            role="group"
            aria-labelledby={`${id}-${section}`}
            data-pick-group={section}
          >
            <div
              id={`${id}-${section}`}
              className={cn(
                'flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-black',
                section === 'away'
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              <span className="min-w-0 truncate">
                {t(scopedKey(scope, `operations.crewPlan.picker.section.${section}`))}
              </span>
              <span className={cn(NUM, 'shrink-0 opacity-80')}>
                {formatNumber(part.length, locale)}
              </span>
            </div>
            {part.map(option)}
          </div>
        );
      })}
    </div>
  );

  const title = t('operations.crewPlan.picker.title', { slot: slotName });
  /** The computer's head — the phone's sheet draws its own from `title`. */
  const head = (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-black leading-5 text-slate-900 dark:text-white">
          {title}
        </p>
        <p className="truncate text-[11.5px] font-bold leading-4 text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.picker.row', { row: rowName })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => close.current(true)}
        aria-label={t('common.close')}
        className="-me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );

  return {
    head,
    offers,
    searchBox,
    list,
    title,
    panel,
    onPanelKey,
    close: (back) => close.current(back),
  };
};

export const CrewSlotPicker = (props: SlotPickerProps): JSX.Element | null => {
  const { target, rowName, anchor, trigger, sheet } = props;
  const t = useT();
  const parts = useSlotPickerParts(props);
  const { panel, close } = parts;
  const closeRef = useRef(close);
  closeRef.current = close;
  const spot = usePickerSpot(anchor, !sheet);

  // A press anywhere but the list and what opened it closes it (the bottom sheet has its scrim).
  useEffect(() => {
    if (sheet) return undefined;
    const away = (event: PointerEvent): void => {
      const at = event.target as Node;
      if (panel.current?.contains(at) || trigger.current?.contains(at)) return;
      closeRef.current(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [panel, sheet, trigger]);

  if (sheet) {
    return (
      <BottomSheet
        name="crew-slot-picker"
        tall
        open
        onClose={() => close(true)}
        title={parts.title}
        subtitle={t('operations.crewPlan.picker.row', { row: rowName })}
        toolbar={
          <div className="space-y-2.5" ref={panel}>
            {parts.offers}
            {parts.searchBox}
          </div>
        }
      >
        {parts.list}
      </BottomSheet>
    );
  }
  if (spot === null) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={`${parts.title} — ${rowName}`}
      data-slot-picker={`${target.key}|${target.slot}`}
      onKeyDown={parts.onPanelKey}
      style={{
        position: 'fixed',
        left: spot.left,
        width: spot.width,
        maxHeight: spot.maxHeight,
        ...(spot.top === undefined ? { bottom: spot.bottom } : { top: spot.top }),
      }}
      className="z-[75] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 animate-menu-in dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/60"
    >
      <div className="shrink-0 space-y-2 border-b border-slate-200 px-2.5 pb-2.5 pt-2 dark:border-slate-800">
        {parts.head}
        {parts.offers}
        {parts.searchBox}
      </div>
      {parts.list}
    </div>,
    document.body,
  );
};
