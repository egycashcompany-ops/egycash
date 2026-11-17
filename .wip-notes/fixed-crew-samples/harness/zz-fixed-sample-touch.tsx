// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» on a phone and a tablet, in the design of the merged «تعيين السيارات» touch board
// (RosterTouchBoard): the same three layouts picked by width (phone < 768 · portrait 768–1023 ·
// landscape 1024–1279, and «short» under 500px tall), the car-code search, the sticky filter row,
// the cards, the bottom sheets, the three shapes of the unsaved bar.
//
// The screen's OWN header on top (owner Q2 ج, 2026-11-17): the REAL PageHeader, «الطقم الثابت» with
// «الحركة › الطقم الثابت», as FixedRosterPage draws it at every width, with no Excel action. It is the
// ONE title: the board's own h1 is gone, and the Excel button stays where the daily touch board keeps
// it — at the end edge of the board's first row (beside the car search now that the h1 is gone).
//
// What makes it the STANDING board (gap map §3): no day stepper anywhere; the workshop never locks a
// car — its card stays in its code place, full and editable (no folded «في الورشة (n)» group); the
// card's ⋮ says «تعديل» and «إفراغ الطقم» (immediate, seats only); the picker's title is «تعديل ·
// 171» and its list is ONE pool (no «غير المتاحين» tab, no «متاح» badge), then «معيّنون على سيارات
// أخرى (n)» — a tap MOVES that driver (the move strip appears on the seat).
//
// REAL, imported as they are: BottomSheet, CarSearch, CounterChips, FilterButton, ResetChip,
// DriversButton, ExcelButton, FiltersSheet, ConfirmSheet, EditsBar, DriverSearch, CodeList,
// unbrokenName, the layout hook. COPIED: the car card and its seat (CC, without the workshop lock and
// with the fixed words), the mission and note sheets (zz-fixed-sample-parts).
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { splitVehicleCodeList, type FleetFixedCrewRowDto, type Locale } from '@ecms/contracts';
import { useT } from './platform/localization/useT';
import { PageHeader } from './platform/layout/PageContainer';
import { useAppSelector } from './store';
import { cn } from './shared/lib/cn';
import { errorMessage } from './shared/lib/errors';
import { toggleValue, writeList } from './shared/lib/list-param';
import { ChevronIcon, CloseIcon, MoreIcon, PlusIcon, SwapIcon, UserIcon } from './shared/ui/icons';
import { ErrorState } from './shared/ui/states/ErrorState';
import { LoadingState } from './shared/ui/states/LoadingState';
import { toast } from './shared/ui/toast/toast-store';
import { SquarePenIcon, Trash2Icon } from './modules/fleet/components/row-action-icons';
import { matchesVehicleCode } from './modules/fleet/lib/vehicle-code-match';
import { type CrewSlot } from './modules/fleet/lib/fixed-roster-board';
import { DRAG_TYPE, SLOT_WORD, type SeatTarget } from './modules/fleet/lib/roster-board';
import { type TouchLayout } from './modules/fleet/lib/roster-layout';
import { hasDriver, missionTone, UNSAVED_ROW } from './modules/fleet/lib/roster-view';
import { BottomSheet } from './modules/fleet/components/roster/RosterBottomSheet';
import { DriverSearch } from './modules/fleet/components/roster/roster-drivers';
import {
  CodeList,
  EditsBar,
  num,
  unbrokenName,
} from './modules/fleet/components/roster/roster-parts';
import {
  CarSearch,
  ConfirmSheet,
  CounterChips,
  DriversButton,
  ExcelButton,
  FilterButton,
  FiltersSheet,
  ResetChip,
  type TouchCounter,
} from './modules/fleet/components/roster/roster-touch-parts';
import { fixedFiltersHiding, type FixedModel, type FixedQuery } from './zz-fixed-sample-model';
import {
  DriversHead,
  FixedBadges,
  FixedDriverList,
  FixedMissionSheet,
  FixedNotesSheet,
} from './zz-fixed-sample-parts';

const carSelector = (code: string): string => `[data-car="${CSS.escape(code)}"]`;

// ── the card (RosterCarCard, without the workshop lock, with the fixed words) ───────────────────

interface CardHandlers {
  onSlot: (target: SeatTarget) => void;
  onClear: (vehicleId: string, slot: CrewSlot) => void;
  onSwap: (vehicleId: string) => void;
  onMission: (row: FleetFixedCrewRowDto) => void;
  onClearCrew: (row: FleetFixedCrewRowDto) => void;
  onEditNotes: (row: FleetFixedCrewRowDto) => void;
  onDropDriver: (target: SeatTarget, employeeId: string) => void;
}

interface CardFacts {
  m: FixedModel;
  armed: boolean;
}

/** ⋮ — «تعديل» (the note sheet) and the red «إفراغ الطقم» (seats only, no confirm). */
const MoreMenu = ({
  row,
  onEdit,
  onClearCrew,
}: {
  row: FleetFixedCrewRowDto;
  onEdit: () => void;
  onClearCrew: (() => void) | null;
}): JSX.Element => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const item =
    'flex min-h-12 w-full items-center gap-3 px-4 text-start text-sm font-medium transition-colors';
  return (
    <div ref={box} className="relative -me-1.5 -mt-1 shrink-0">
      <button
        type="button"
        data-card-menu={row.code}
        aria-label={t('common.menu')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <MoreIcon className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 w-60 animate-drop-in overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <button
            type="button"
            role="menuitem"
            data-menu-item="edit"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className={cn(
              item,
              'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800',
            )}
          >
            <SquarePenIcon className="h-[18px] w-[18px] text-brand-600 dark:text-brand-300" />
            {t('common.edit')}
          </button>
          {onClearCrew !== null && (
            <button
              type="button"
              role="menuitem"
              data-menu-item="clear-crew"
              onClick={() => {
                setOpen(false);
                onClearCrew();
              }}
              className={cn(
                item,
                'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/50',
              )}
            >
              <Trash2Icon className="h-[18px] w-[18px]" />
              {t('fleet.fixedRoster.clearCrew')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const Avatar = ({
  tone,
  children,
}: {
  tone: 'driver' | 'empty' | 'locked';
  children: JSX.Element;
}): JSX.Element => (
  <span
    className={cn(
      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
      tone === 'driver' && 'bg-green-700 text-white dark:bg-green-600',
      tone === 'empty' &&
        'border-[1.5px] border-dashed border-brand-400 text-brand-600 dark:border-brand-500 dark:text-brand-300',
      tone === 'locked' && 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
    )}
  >
    {children}
  </span>
);

const SlotRow = ({
  row,
  slot,
  mayPlan,
  unsaved,
  facts,
  targeted,
  handlers,
}: {
  row: FleetFixedCrewRowDto;
  slot: CrewSlot;
  mayPlan: boolean;
  unsaved: boolean;
  facts: CardFacts;
  targeted: boolean;
  handlers: CardHandlers;
}): JSX.Element => {
  const t = useT();
  const { m } = facts;
  const [over, setOver] = useState(false);
  const employeeId = row[slot];
  const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null;
  // NO workshop lock: a standing crew is kept and changed in the workshop too.
  const droppable = mayPlan && !needsFirst;
  const label = t(SLOT_WORD[slot]);
  const key = `${row.code}:${slot === 'driver1EmployeeId' ? 1 : 2}`;
  const target: SeatTarget = { vehicleId: row.vehicleId, slot };
  const caption = (
    <span className="block text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
      {label}
    </span>
  );
  const dropProps = droppable
    ? {
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          const id = event.dataTransfer.getData(DRAG_TYPE);
          if (id !== '') handlers.onDropDriver(target, id);
        },
      }
    : {};
  const ring = targeted
    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/70 ring-offset-2 ring-offset-white dark:border-brand-400 dark:bg-brand-950/60 dark:ring-brand-400/70 dark:ring-offset-slate-900'
    : over
      ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/60'
      : '';

  if (employeeId === null) {
    if (!droppable) {
      return (
        <div
          data-slot={key}
          data-slot-state="locked"
          className="flex h-full min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-slate-100/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30"
        >
          <Avatar tone="locked">
            <UserIcon className="h-4 w-4" />
          </Avatar>
          <span className="min-w-0 flex-1">
            {caption}
            <span className="block text-sm leading-5 text-slate-500 dark:text-slate-400">
              {t(!mayPlan ? 'fleet.fixedRoster.noDriver' : 'fleet.fixedRoster.needsFirstDriver')}
            </span>
          </span>
        </div>
      );
    }
    return (
      <button
        type="button"
        data-slot={key}
        data-slot-state="empty"
        aria-label={`${row.code} · ${label} · ${t('fleet.roster.pickDriver')}`}
        onClick={() => handlers.onSlot(target)}
        {...dropProps}
        className={cn(
          'flex h-full min-h-14 w-full items-center gap-3 rounded-xl border-[1.5px] border-dashed px-3 py-2 text-start transition-colors',
          facts.armed
            ? 'border-brand-400 bg-brand-50/60 hover:bg-brand-50 active:bg-brand-100 dark:border-brand-500 dark:bg-brand-950/30'
            : 'border-slate-300 bg-white hover:border-brand-400 hover:bg-brand-50/40 active:bg-brand-50 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:border-brand-500 dark:hover:bg-brand-950/30',
          ring,
        )}
      >
        <Avatar tone="empty">
          <PlusIcon className="h-4 w-4" />
        </Avatar>
        <span className="min-w-0 flex-1">
          {caption}
          <span className="block text-[15px] font-semibold leading-5 text-brand-700 dark:text-brand-300">
            {t('fleet.roster.pickDriver')}
          </span>
        </span>
      </button>
    );
  }

  const person = m.person(employeeId);
  const name = person?.fullNameAr ?? employeeId.slice(-8);
  const movedFrom = m.transferFrom(employeeId, row.vehicleId);
  // Owner Q1 ب: no flag under a standing member's name (no amber frame, no «الملف موقوف» /
  // «ليس على وظيفة سائق» / «رخصة منتهية») — those are the daily board's.
  const body = (
    <>
      <Avatar tone="driver">
        <UserIcon className="h-[18px] w-[18px]" />
      </Avatar>
      <span className="min-w-0 flex-1">
        {caption}
        <span className="block text-[15px] font-semibold leading-5 text-slate-900 dark:text-slate-50">
          {unbrokenName(name)}
        </span>
        <span className="mt-0.5 block font-figures text-xs leading-4 text-slate-500 dark:text-slate-400">
          <bdi dir="ltr">{person?.code ?? ''}</bdi>
        </span>
      </span>
    </>
  );
  const hint =
    movedFrom === null ? null : (
      <span
        data-transfer-hint={movedFrom}
        className="flex items-center gap-1.5 rounded-b-xl border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold leading-4 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200"
      >
        <SwapIcon className="h-3.5 w-3.5 shrink-0" />
        {t('fleet.roster.transferHint', { code: movedFrom })}
      </span>
    );
  const frame = cn(
    'flex h-full min-h-14 flex-col rounded-xl border transition-colors',
    unsaved
      ? 'border-amber-200/80 bg-white dark:border-amber-800/50 dark:bg-slate-900/70'
      : 'border-slate-200/80 bg-slate-50 dark:border-slate-700/70 dark:bg-slate-800/50',
    ring,
  );
  if (!mayPlan) {
    return (
      <div data-slot={key} data-slot-state="filled" className={frame}>
        <div className="flex min-h-14 flex-1 items-center gap-3 px-3 py-2">{body}</div>
        {hint}
      </div>
    );
  }
  return (
    <div data-slot={key} data-slot-state="filled" className={frame} {...dropProps}>
      <div className="flex min-h-14 flex-1 items-stretch">
        <button
          type="button"
          aria-label={`${row.code} · ${label} · ${name}`}
          onClick={() => handlers.onSlot(target)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, employeeId);
            event.dataTransfer.effectAllowed = 'move';
          }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-s-xl py-2 pe-1 ps-3 text-start active:bg-slate-100 dark:active:bg-slate-800"
        >
          {body}
        </button>
        <button
          type="button"
          data-clear-slot={key}
          aria-label={t('fleet.fixedRoster.removeDriver')}
          title={t('fleet.fixedRoster.removeDriver')}
          onClick={() => handlers.onClear(row.vehicleId, slot)}
          className="flex w-11 shrink-0 items-center justify-center rounded-e-xl text-slate-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 dark:text-slate-500 dark:hover:bg-red-950/40 dark:hover:text-red-300"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
      {hint}
    </div>
  );
};

const FixedCarCard = ({
  row,
  layout,
  mayPlan,
  unsaved,
  facts,
  target,
  handlers,
}: {
  row: FleetFixedCrewRowDto;
  layout: TouchLayout;
  mayPlan: boolean;
  unsaved: boolean;
  facts: CardFacts;
  target: SeatTarget | null;
  handlers: CardHandlers;
}): JSX.Element => {
  const t = useT();
  const { m } = facts;
  const canSwap = mayPlan && row.driver1EmployeeId !== null && row.driver2EmployeeId !== null;
  const stacked = layout === 'phone';
  const slot = (s: CrewSlot): JSX.Element => (
    <SlotRow
      row={row}
      slot={s}
      mayPlan={mayPlan}
      unsaved={unsaved}
      facts={facts}
      targeted={target !== null && target.vehicleId === row.vehicleId && target.slot === s}
      handlers={handlers}
    />
  );
  const swap = canSwap ? (
    <button
      type="button"
      data-swap-drivers={row.code}
      aria-label={t('fleet.roster.swapDrivers')}
      title={t('fleet.roster.swapDrivers')}
      onClick={() => handlers.onSwap(row.vehicleId)}
      className="relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full border border-indigo-200 bg-white text-indigo-600 shadow-sm transition-colors hover:bg-indigo-50 active:bg-indigo-100 dark:border-indigo-800/80 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
    >
      <SwapIcon className={cn('h-5 w-5', stacked && 'rotate-90')} />
    </button>
  ) : (
    <span aria-hidden="true" className="w-11 shrink-0" />
  );
  const known = row.missionTypeId !== null && m.missionName(row.missionTypeId) !== '—';
  const mission =
    row.missionTypeId === null
      ? t('fleet.fixedRoster.noMissionType')
      : m.missionName(row.missionTypeId);
  const pill =
    !mayPlan && !known ? (
      <span data-mission-none="true" className="text-sm text-slate-400 dark:text-slate-500">
        —
      </span>
    ) : (
      <span
        className={cn(
          'inline-flex h-8 max-w-full items-center gap-1 rounded-full px-3 text-[13px] font-semibold',
          row.missionTypeId !== null
            ? missionTone(row.missionTypeId)
            : 'border border-dashed border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400',
        )}
      >
        <span className="truncate">{mission}</span>
        {mayPlan && <ChevronIcon className="h-4 w-4 shrink-0 opacity-70" />}
      </span>
    );
  const menu = mayPlan ? (
    <MoreMenu
      row={row}
      onEdit={() => handlers.onEditNotes(row)}
      onClearCrew={hasDriver(row) ? () => handlers.onClearCrew(row) : null}
    />
  ) : null;
  const code = (
    <span className="flex items-center gap-1.5">
      <bdi
        dir="ltr"
        className="font-figures text-[22px] font-extrabold leading-7 tracking-tight text-slate-900 dark:text-slate-50"
      >
        {row.code}
      </bdi>
      {unsaved && (
        <span
          data-unsaved-dot="true"
          title={t('fleet.roster.unsaved')}
          aria-label={t('fleet.roster.unsaved')}
          className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-900"
        />
      )}
    </span>
  );
  const notesText = (
    <>
      <span className="font-semibold text-slate-500 dark:text-slate-400">
        {t('fleet.attendance.fields.notes')}:
      </span>{' '}
      {row.notes}
    </>
  );
  const hasNotes = row.notes !== null && row.notes.trim() !== '';
  const notes = hasNotes ? (
    mayPlan ? (
      <button
        type="button"
        data-notes={row.code}
        data-notes-edit="true"
        onClick={() => handlers.onEditNotes(row)}
        aria-label={`${row.code} · ${t('common.edit')}`}
        className="mt-2.5 flex min-h-11 w-full items-start gap-2 rounded-lg bg-slate-100/80 px-3 py-2 text-start text-[13px] leading-5 text-slate-700 transition-colors hover:bg-slate-200/70 active:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className="min-w-0 flex-1">{notesText}</span>
        <SquarePenIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      </button>
    ) : (
      <p
        data-notes={row.code}
        className="mt-2.5 rounded-lg bg-slate-100/80 px-3 py-2 text-[13px] leading-5 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
      >
        {notesText}
      </p>
    )
  ) : null;

  return (
    <article
      data-car={row.code}
      data-unsaved={unsaved ? 'true' : undefined}
      data-workshop={row.inMaintenance ? 'true' : undefined}
      className={cn(
        'scroll-mt-24 rounded-2xl border p-3 shadow-sm transition-colors sm:p-4',
        unsaved
          ? cn(UNSAVED_ROW, 'border-amber-300 dark:border-amber-700/70')
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {code}
          {mayPlan ? (
            <button
              type="button"
              data-mission={row.code}
              aria-label={`${row.code} · ${t('fleet.roster.fields.mission')}: ${mission}`}
              onClick={() => handlers.onMission(row)}
              className="-my-1.5 flex min-h-11 min-w-0 items-center"
            >
              {pill}
            </button>
          ) : (
            <span className="flex min-h-8 min-w-0 items-center">{pill}</span>
          )}
          {!stacked && <FixedBadges row={row} />}
        </div>
        {menu}
      </div>
      {stacked && (
        <div className="mt-2">
          <FixedBadges row={row} />
        </div>
      )}
      {stacked ? (
        <div className="mt-3 flex items-stretch gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <div>{slot('driver1EmployeeId')}</div>
            <div>{slot('driver2EmployeeId')}</div>
          </div>
          {canSwap && (
            <div className="relative flex w-11 shrink-0 items-center justify-center">
              <span
                aria-hidden="true"
                className="absolute inset-y-7 -start-2 end-1/2 rounded-e-lg border-y border-e border-slate-300 dark:border-slate-700"
              />
              {swap}
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn(
            'mt-3 grid items-stretch gap-2',
            mayPlan ? 'grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)]' : 'grid-cols-2',
          )}
        >
          {slot('driver1EmployeeId')}
          {mayPlan && swap}
          {slot('driver2EmployeeId')}
        </div>
      )}
      {notes}
    </article>
  );
};

// ── the board ───────────────────────────────────────────────────────────────────────────────────

export const FixedTouchBoard = ({
  m,
  query,
  resetFilters,
  layout,
  short,
}: {
  m: FixedModel;
  query: FixedQuery;
  resetFilters: () => void;
  layout: TouchLayout;
  short: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { mayPlan, missions, view, patch } = query;

  // The car search — this board's own state, ANDed with the URL's filters.
  const [carTerm, setCarTerm] = useState('');
  const searching = splitVehicleCodeList(carTerm).length > 0;
  const drawn = useMemo(
    () => m.visible.filter((row) => matchesVehicleCode(row.code, carTerm)),
    [m.visible, carTerm],
  );
  const termFinds = !searching || m.draft.some((row) => matchesVehicleCode(row.code, carTerm));
  const filtered = m.filtered || searching;

  // A pressed state chip lets go on a second tap (the daily touch rule).
  const counters: TouchCounter[] = m.counters.map((counter) => ({
    key: counter.key,
    label: counter.label,
    value: counter.value,
    tone: counter.tone,
    active: counter.active,
    apply: () =>
      patch(
        counter.active && typeof counter.apply.view === 'string' ? { view: null } : counter.apply,
      ),
  }));

  const [picker, setPicker] = useState<SeatTarget | null>(null);
  const [term, setTerm] = useState('');
  const [missionFor, setMissionFor] = useState<FleetFixedCrewRowDto | null>(null);
  const [notesFor, setNotesFor] = useState<FleetFixedCrewRowDto | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [target, setTarget] = useState<SeatTarget | null>(null);
  const [pendingDriver, setPendingDriver] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const rowOf = (vehicleId: string): FleetFixedCrewRowDto | undefined =>
    m.draft.find((row) => row.vehicleId === vehicleId);

  const missionsKey = missions.join(',');
  const counterCount = m.counters.length;
  useEffect(() => {
    document
      .querySelector('[data-counter][data-active]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view, missionsKey, layout, counterCount]);
  useEffect(() => {
    if (target === null || layout !== 'landscape') return;
    document
      .querySelector(carSelector(m.codeOf(target.vehicleId)))
      ?.scrollIntoView({ block: 'nearest' });
  }, [target, layout]);

  const stickyMode = short ? 'none' : layout === 'phone' ? 'filters' : 'header';

  const openFill = (next: SeatTarget): void => {
    if (pendingDriver !== null) {
      m.actions.assign(next, pendingDriver);
      setPendingDriver(null);
      return;
    }
    if (layout === 'landscape') {
      setTarget((current) =>
        current !== null && current.vehicleId === next.vehicleId && current.slot === next.slot
          ? null
          : next,
      );
      return;
    }
    setTerm('');
    setPicker(next);
  };
  const handlers: CardHandlers = {
    onSlot: openFill,
    onClear: (vehicleId, slot) => {
      m.actions.clear(vehicleId, slot);
      if (target !== null && target.vehicleId === vehicleId) setTarget(null);
    },
    onSwap: (vehicleId) => m.actions.swap(vehicleId),
    onMission: (row) => setMissionFor(row),
    onClearCrew: (row) => m.actions.clearCrew(row.vehicleId),
    onEditNotes: (row) => setNotesFor(row),
    onDropDriver: (dropTarget, employeeId) => {
      m.actions.assign(dropTarget, employeeId);
      setTarget(null);
    },
  };

  const exportSheet = (): void => {
    try {
      m.actions.exportSheet(drawn);
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };
  const save = (): void => {
    if (m.saving || !m.dirty) return;
    void m.actions.save().then((stored) => {
      if (!stored) return;
      setTarget(null);
      setPendingDriver(null);
    });
  };
  const discard = (): void => {
    if (m.changed.length > 1) setAskDiscard(true);
    else m.actions.discard();
  };
  const showCar = (code: string): void => {
    const row = m.draft.find((candidate) => candidate.code === code);
    if (!matchesVehicleCode(code, carTerm)) setCarTerm('');
    if (row !== undefined && !m.visible.includes(row)) {
      patch(fixedFiltersHiding(row, { search: query.search, missions, view }));
    }
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        document.querySelector(carSelector(code))?.scrollIntoView({ block: 'center' }),
      ),
    );
  };

  const fillTarget = layout === 'landscape' ? target : picker;
  const options = m.optionsFor(term, fillTarget);
  const occupantOf = (seat: SeatTarget | null): string | null =>
    seat === null ? null : (rowOf(seat.vehicleId)?.[seat.slot] ?? null);
  const lists = (
    onPick: ((employeeId: string) => void) | null,
    extra: {
      onIdlePick?: (employeeId: string) => void;
      draggable?: boolean;
      occupant?: { employeeId: string; onClear: () => void } | null;
    } = {},
  ): JSX.Element | null =>
    m.board === undefined ? null : (
      <FixedDriverList
        options={options}
        person={m.person}
        hasDrivers={m.pool.length > 0}
        searched={term.trim() !== ''}
        onPick={onPick}
        onIdlePick={extra.onIdlePick}
        pendingId={pendingDriver}
        occupant={extra.occupant ?? null}
        draggable={extra.draggable ?? false}
      />
    );

  const facts: CardFacts = { m, armed: mayPlan && pendingDriver !== null };
  const cards = (rows: readonly FleetFixedCrewRowDto[], cardLayout: TouchLayout): JSX.Element[] =>
    rows.map((row) => (
      <FixedCarCard
        key={row.vehicleId}
        row={row}
        layout={cardLayout}
        mayPlan={mayPlan}
        unsaved={m.unsavedIds.has(row.vehicleId)}
        facts={facts}
        target={layout === 'landscape' ? target : picker}
        handlers={handlers}
      />
    ));

  const editedCodes = m.changed.map((row) => m.codeOf(row.vehicleId));
  const filterCount = m.codes.length + missions.length + (view !== null ? 1 : 0);
  const chipRow = (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scroll-px-1 px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-counters="true"
    >
      <CounterChips counters={counters} />
    </div>
  );
  const openPool = (): void => {
    setTerm('');
    setPoolOpen(true);
  };
  const editsBar = (shape: 'phone' | 'strip' | 'floating'): JSX.Element => (
    <EditsBar
      codes={editedCodes}
      edited={m.dirty}
      undoable={m.undoDepth > 0}
      saving={m.saving}
      onUndo={m.actions.undo}
      onDiscard={discard}
      onSave={save}
      onCode={showCar}
      shape={shape}
    />
  );
  const emptyLine =
    drawn.length === 0 && m.draft.length > 0 ? (
      <p
        role="status"
        data-empty={termFinds ? 'filters' : 'code'}
        className="py-12 text-center text-sm text-slate-500"
      >
        {termFinds ? t('common.noResults') : t('fleet.odometer.vehicleNotFound')}
      </p>
    ) : drawn.length === 0 ? (
      <p role="status" data-empty="board" className="py-12 text-center text-sm text-slate-500">
        {t('fleet.fixedRoster.noVehicles')}
      </p>
    ) : null;
  // The workshop's cars stay in their code place, full cards — no folded group (gap map FT13).
  const carsArea = (cardLayout: TouchLayout, roadClass: string): JSX.Element =>
    m.status.error !== undefined ? (
      <ErrorState error={m.status.error} onRetry={m.status.retry} />
    ) : m.status.loading ? (
      <LoadingState />
    ) : (
      <>
        <div className={roadClass}>{cards(drawn, cardLayout)}</div>
        {emptyLine}
      </>
    );
  const changeCarTerm = (value: string): void => {
    setCarTerm(value);
    if (layout === 'landscape') document.querySelector('[data-cars-column]')?.scrollTo({ top: 0 });
    else if (layout === 'portrait') document.querySelector('main')?.scrollTo({ top: 0 });
  };
  const carSearch = (className?: string): JSX.Element => (
    <CarSearch value={carTerm} onChange={changeCarTerm} className={className} />
  );
  const resetAll = (): void => {
    setCarTerm('');
    resetFilters();
  };
  const pendingBanner =
    mayPlan && pendingDriver !== null ? (
      <div
        data-pending-driver={m.person(pendingDriver)?.code}
        className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-emerald-600"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
        <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
          {t('fleet.roster.driverNow', { name: m.driverName(pendingDriver) })}
        </span>
        <button
          type="button"
          onClick={() => setPendingDriver(null)}
          aria-label={t('common.cancel')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/15"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
    ) : null;

  const pickerOccupant = occupantOf(picker);
  // Q2 ج: the old header, the REAL component, exactly as FixedRosterPage.tsx renders it — minus its
  // Excel action (the board keeps its own Excel button: one per width).
  const header = (
    <PageHeader
      title={t('fleet.nav.fixedRoster')}
      breadcrumbs={[
        { label: t('fleet.module.title'), to: '/fleet' },
        { label: t('fleet.nav.fixedRoster') },
      ]}
    />
  );
  const sheets = (
    <>
      <BottomSheet
        name="picker"
        tall
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={`${t('common.edit')} · ${picker === null ? '' : m.codeOf(picker.vehicleId)}`}
        subtitle={
          picker === null
            ? undefined
            : pickerOccupant === null
              ? t(SLOT_WORD[picker.slot])
              : `${t(SLOT_WORD[picker.slot])} · ${m.driverName(pickerOccupant)}`
        }
        toolbar={<DriverSearch value={term} onChange={setTerm} />}
      >
        {picker !== null &&
          lists(
            (employeeId) => {
              m.actions.assign(picker, employeeId);
              setPicker(null);
            },
            {
              occupant:
                pickerOccupant === null
                  ? null
                  : {
                      employeeId: pickerOccupant,
                      onClear: () => {
                        m.actions.clear(picker.vehicleId, picker.slot);
                        setPicker(null);
                      },
                    },
            },
          )}
      </BottomSheet>
      <BottomSheet
        name="pool"
        tall
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        // The count the computer's heading and the button carry — no date line on this board.
        title={`${t('fleet.fixedRoster.driversTitle')} (${num(m.pool.length)})`}
        toolbar={
          <div className="space-y-2.5">
            {mayPlan && (
              <p
                data-pool-hint="true"
                className="text-[13px] leading-5 text-slate-500 dark:text-slate-400"
              >
                {t('fleet.roster.poolHint')}
              </p>
            )}
            <DriverSearch value={term} onChange={setTerm} />
          </div>
        }
      >
        {lists(
          null,
          mayPlan
            ? {
                onIdlePick: (employeeId) => {
                  setPendingDriver(employeeId);
                  setPoolOpen(false);
                },
              }
            : {},
        )}
      </BottomSheet>
      <FixedMissionSheet
        row={missionFor}
        missions={m.missionOptions}
        missionTypes={m.missionTypes}
        onClose={() => setMissionFor(null)}
        onPick={(id) => {
          if (missionFor !== null) m.actions.mission(missionFor.vehicleId, id);
          setMissionFor(null);
        }}
      />
      <FixedNotesSheet
        row={notesFor}
        onClose={() => setNotesFor(null)}
        onSave={(notes) => {
          if (notesFor !== null) m.actions.notes(notesFor.vehicleId, notes);
          setNotesFor(null);
        }}
      />
      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        codes={m.draft.map((row) => row.code)}
        pickedCodes={m.codes}
        onToggleCode={(code) => patch({ q: writeList(toggleValue(m.codes, code)) })}
        missions={m.missionOptions}
        pickedMissions={missions}
        onToggleMission={(id) => patch({ mission: writeList(toggleValue(missions, id)) })}
        onAllMissions={() => patch({ mission: null })}
        onReset={resetAll}
        results={drawn.length}
        filtered={filtered}
      />
      <ConfirmSheet
        name="discard"
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title={t('fleet.roster.discardAll')}
        confirmLabel={t('fleet.roster.discardAll')}
        backLabel={t('common.close')}
        onConfirm={() => {
          m.actions.discard();
          setAskDiscard(false);
        }}
      >
        {t('fleet.roster.discardBody')}{' '}
        <CodeList codes={editedCodes} className="font-semibold text-slate-900 dark:text-slate-50" />
      </ConfirmSheet>
    </>
  );

  // ── TABLET LANDSCAPE: the split view ─────────────────────────────────────────────────────────
  if (layout === 'landscape') {
    const targetRow = target === null ? null : (rowOf(target.vehicleId) ?? null);
    const targetOccupant = occupantOf(target);
    return (
      <div data-roster-touch="landscape" className="flex min-h-0 flex-1 flex-col px-6 pb-4 pt-5">
        <div className="shrink-0">{header}</div>
        <div className="flex shrink-0 items-center gap-3">
          {carSearch('w-[20rem] min-w-0 shrink')}
          <span className="min-w-0 flex-1" />
          <ExcelButton onExport={exportSheet} />
        </div>
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} />
          {filtered && <ResetChip onReset={resetAll} />}
          {chipRow}
        </div>
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
          <div
            data-cars-column="true"
            className="min-h-0 overflow-y-auto overscroll-contain pb-3 pe-1"
          >
            {carsArea('landscape', 'space-y-3')}
          </div>
          <aside
            data-drivers-panel="true"
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="shrink-0 space-y-2.5 border-b border-slate-200 p-3 dark:border-slate-800">
              {mayPlan &&
                (target !== null && targetRow !== null ? (
                  <div
                    data-target-banner="true"
                    className="flex min-h-12 items-center gap-2 rounded-xl bg-brand-600 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-brand-600"
                  >
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
                      {t('fleet.roster.targetNow', {
                        code: targetRow.code,
                        slot: t(SLOT_WORD[target.slot]),
                      })}
                      {targetOccupant !== null && <> · {m.driverName(targetOccupant)}</>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTarget(null)}
                      aria-label={t('common.cancel')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/15"
                    >
                      <CloseIcon className="h-5 w-5" />
                    </button>
                  </div>
                ) : pendingBanner !== null ? (
                  pendingBanner
                ) : (
                  <div
                    data-target-hint="true"
                    className="flex min-h-12 items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
                  >
                    {t('fleet.roster.pickSlotHint')}
                  </div>
                ))}
              <DriversHead count={m.pool.length} />
              <DriverSearch value={term} onChange={setTerm} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {lists(
                mayPlan && target !== null
                  ? (employeeId) => {
                      m.actions.assign(target, employeeId);
                      setTarget(null);
                    }
                  : null,
                {
                  draggable: mayPlan,
                  ...(mayPlan && target === null
                    ? {
                        onIdlePick: (employeeId: string) =>
                          setPendingDriver((current) =>
                            current === employeeId ? null : employeeId,
                          ),
                      }
                    : {}),
                },
              )}
            </div>
          </aside>
        </div>
        {mayPlan && m.dirty && <div className="mt-3 shrink-0">{editsBar('floating')}</div>}
        {sheets}
      </div>
    );
  }

  // ── PHONE and TABLET PORTRAIT: one column of cards ───────────────────────────────────────────
  const phone = layout === 'phone';
  // The daily's title row lost its h1 to the header above and its day stepper to the standing board,
  // so the car search moves up into it: the search, then the Excel button at the row's end edge — the
  // daily's place for it.
  const topBlock = (
    <div className="flex items-center gap-2">
      {carSearch('min-w-0 flex-1')}
      <ExcelButton onExport={exportSheet} />
    </div>
  );
  const filterRow = (
    <div className="flex items-center gap-2">
      <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} compact={phone} />
      {filtered && <ResetChip onReset={resetAll} compact={phone} />}
      {chipRow}
      <DriversButton count={m.pool.length} onOpen={openPool} compact={phone} />
    </div>
  );
  return (
    <div data-roster-touch={layout} className={cn('flex flex-1 flex-col', phone ? 'px-4' : 'px-6')}>
      {/* The header scrolls away with the cards; on a phone so do the search and Excel under it. */}
      <div className={phone ? 'pt-5' : 'pt-6'}>{header}</div>
      {phone && topBlock}
      <div
        data-touch-header="true"
        data-sticky={stickyMode}
        className={cn(
          'z-20 border-b border-slate-200/80 bg-slate-50 pb-2 dark:border-slate-800 dark:bg-slate-950',
          stickyMode !== 'none' && 'sticky top-0',
          phone ? 'pt-2' : 'pt-3',
          // Portrait: the header's own mb-6 is the gap under it (24px, as on every other width and
          // on today's page); -mt-3 takes back the pt-3 there. It keeps the pt-3 once stuck (top-0).
          !phone && '-mt-3',
          phone ? '-mx-4 px-4' : '-mx-6 px-6',
        )}
      >
        {!phone && <div className="mb-2">{topBlock}</div>}
        {filterRow}
        {pendingBanner !== null && <div className="mt-2">{pendingBanner}</div>}
      </div>
      {carsArea(layout, 'space-y-3 pt-3')}
      <div className="h-5 shrink-0" />
      <div
        data-touch-bottom="true"
        className={cn(
          'pointer-events-none sticky bottom-0 z-20 mt-auto',
          phone ? '-mx-4' : '-mx-6',
        )}
      >
        {mayPlan && m.dirty ? (
          editsBar(phone ? 'phone' : 'strip')
        ) : (
          <div className="h-[env(safe-area-inset-bottom)]" />
        )}
      </div>
      {sheets}
    </div>
  );
};
