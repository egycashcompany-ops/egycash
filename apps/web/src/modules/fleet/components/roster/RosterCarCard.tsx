// «تعيين السيارات» on a phone and a tablet — ONE CAR as a card, the touch form of one row of the
// computer's table (the approved P1 card, «انا برشح دول»). No table, no drag needed:
//
//   head    the code (bold, ltr) · the mission (a pill; tap → the mission sheet) · ⋮
//   badges  the row's own badges, same words and tones as the «الحالة» cell
//   crew    «السائق الأول» / «السائق الثاني» as two ≥56px rows: caption, name, code — always
//           three lines, so every seat reads alike — or a dashed «اختيار سائق»; ✕ «إزالة من هذه
//           الخانة» on a filled seat; a seated driver who is OUT today says why on the seat itself
//           (touch has no hover card); the swap «تبديل السائق الأول والثاني» only where both seats
//           hold somebody (stacked on a phone, side by side from 768px)
//   notes   the row's note; a tap edits it
//
// Every gesture is the board model's: a seat tap asks the board to fill it (the picker sheet, or —
// on a landscape tablet — makes it the target; with a driver already chosen, places him), ✕ is
// `clear`, ⇅ is `swap`, ⋮ «تعديل التعيين» is `notes`, ⋮ «إلغاء التعيين» is `clearAll`, the pill is
// `mission`. The rules are the computer's: a car the workshop holds takes nobody (FR-5) — but
// clearing it stays legal — slot 2 waits for slot 1, a past day changes nothing. A workshop car is
// a compact card: there is nothing to do on it.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { type FleetPersonDto, type FleetRosterRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Badge } from '../../../../shared/ui/Badge';
import {
  ChevronIcon,
  CloseIcon,
  LockIcon,
  MoreIcon,
  PlusIcon,
  SwapIcon,
  UserIcon,
} from '../../../../shared/ui/icons';
import { InWorkshopBadge } from '../VehicleStatusBadge';
import { SquarePenIcon, Trash2Icon } from '../row-action-icons';
import { type DutySlot } from '../../lib/daily-roster-board';
import { DRAG_TYPE, SLOT_WORD, type SeatTarget } from '../../lib/roster-board';
import { type TouchLayout } from '../../lib/roster-layout';
import {
  carriesPlan,
  hasCrewGap,
  hasDriver,
  hasOtherCrewGap,
  missionTone,
  UNSAVED_ROW,
} from '../../lib/roster-view';

/** What a card asks the board to do. */
export interface CardHandlers {
  onSlot: (target: SeatTarget) => void;
  onClear: (vehicleId: string, slot: DutySlot) => void;
  onSwap: (vehicleId: string) => void;
  onMission: (row: FleetRosterRowDto) => void;
  onClearAll: (row: FleetRosterRowDto) => void;
  onEditNotes: (row: FleetRosterRowDto) => void;
  onDropDriver: (target: SeatTarget, employeeId: string) => void;
}

/** What every seat needs to know about the day besides its own row. */
export interface SeatFacts {
  expired: ReadonlySet<string>;
  /** employeeId → reason, for the drivers who are OUT today (FR-6). */
  unavailable: ReadonlyMap<string, string>;
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  /** A driver was chosen first: an empty seat is where he lands. */
  armed: boolean;
  /** Who an employee id is (no `fleetDriver.view`, or not landed yet: undefined). */
  person: (employeeId: string) => FleetPersonDto | undefined;
  /** A reason's words — an unknown one as sent. */
  reasonLabel: (reason: string) => string;
}

/** The badges of the «الحالة» cell — same predicates, same words, same tones. */
export const RowBadges = ({
  row,
  inGroup = false,
}: {
  row: FleetRosterRowDto;
  /** Inside «في الورشة (n)» the group already says it — no second «في الورشة» per card. */
  inGroup?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const items: ReactNode[] = [];
  if (row.inMaintenance && !inGroup) items.push(<InWorkshopBadge key="ws" inWorkshop />);
  if (hasDriver(row))
    items.push(
      <Badge key="as" tone="success">
        {t('fleet.roster.assigned')}
      </Badge>,
    );
  if (row.licenceExpired === true)
    items.push(
      <span key="le" data-roster-flag="licenceExpired">
        <Badge tone="danger">{t('fleet.roster.licenceExpired')}</Badge>
      </span>,
    );
  if (hasCrewGap(row))
    items.push(
      <span key="cg" data-roster-flag="crewGap">
        <Badge tone="warning">{t('fleet.roster.crewAbsent')}</Badge>
      </span>,
    );
  if (hasOtherCrewGap(row))
    items.push(
      <span key="cu" data-roster-flag="crewUnavailable">
        <Badge tone="neutral">{t('fleet.roster.crewUnavailable')}</Badge>
      </span>,
    );
  if (row.stalePlan === true)
    items.push(
      <span key="sp" data-roster-flag="stalePlan">
        <Badge tone="warning">{t('fleet.roster.stalePlan')}</Badge>
      </span>,
    );
  if (items.length === 0) return null;
  return <div className="flex flex-wrap items-center gap-1.5">{items}</div>;
};

/** ⋮ — the card's less frequent actions, in a small menu under the button. */
const MoreMenu = ({
  row,
  onEdit,
  onClearAll,
}: {
  row: FleetRosterRowDto;
  /** «تعديل التعيين» — the note (not on a car the workshop holds, as the computer's pen). */
  onEdit: (() => void) | null;
  /** «إلغاء التعيين» — only on a car that carries a plan. */
  onClearAll: (() => void) | null;
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
          {onEdit !== null && (
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
              {t('fleet.roster.editAssignment')}
            </button>
          )}
          {onClearAll !== null && (
            <button
              type="button"
              role="menuitem"
              data-menu-item="clear"
              onClick={() => {
                setOpen(false);
                onClearAll();
              }}
              className={cn(
                item,
                'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/50',
              )}
            >
              <Trash2Icon className="h-[18px] w-[18px]" />
              {t('fleet.roster.clearAssignment')}
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
  children: ReactNode;
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

/** One seat. A button where it can be filled, a plain row where it cannot — never a dead button. */
const SlotRow = ({
  row,
  slot,
  mayPlan,
  unsaved,
  facts,
  targeted,
  handlers,
}: {
  row: FleetRosterRowDto;
  slot: DutySlot;
  mayPlan: boolean;
  unsaved: boolean;
  facts: SeatFacts;
  targeted: boolean;
  handlers: CardHandlers;
}): JSX.Element => {
  const t = useT();
  const [over, setOver] = useState(false);
  const employeeId = row[slot];
  const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null;
  const droppable = mayPlan && !row.inMaintenance && !needsFirst;
  const label = t(SLOT_WORD[slot]);
  const key = `${row.code}:${slot === 'driver1EmployeeId' ? 1 : 2}`;
  const target: SeatTarget = { vehicleId: row.vehicleId, slot };
  const caption = (
    <span className="block text-[11px] font-medium leading-4 text-slate-500 dark:text-slate-400">
      {label}
    </span>
  );

  // A mouse on a landscape tablet (or a 1024–1279px window) still drags a driver onto a seat.
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
      const why = !mayPlan
        ? 'fleet.fixedRoster.noDriver'
        : row.inMaintenance
          ? 'fleet.roster.inWorkshopNoDrop'
          : 'fleet.fixedRoster.needsFirstDriver';
      return (
        <div
          data-slot={key}
          data-slot-state="locked"
          className="flex h-full min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-slate-100/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30"
        >
          <Avatar tone="locked">
            {row.inMaintenance ? (
              <LockIcon className="h-4 w-4" />
            ) : (
              <UserIcon className="h-4 w-4" />
            )}
          </Avatar>
          <span className="min-w-0 flex-1">
            {caption}
            <span className="block text-sm leading-5 text-slate-500 dark:text-slate-400">
              {t(why)}
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

  const person = facts.person(employeeId);
  // The id's tail when the name is out of reach — a seat that is taken must not read as empty.
  const name = person?.fullNameAr ?? employeeId.slice(-8);
  const movedFrom = facts.transferFrom(employeeId, row.vehicleId);
  const outReason = facts.unavailable.get(employeeId);
  // The same face the lists use: caption, name, code — each on its own line, so a long name and a
  // short one make seats of the same height.
  const body = (
    <>
      <Avatar tone="driver">
        <UserIcon className="h-[18px] w-[18px]" />
      </Avatar>
      <span className="min-w-0 flex-1">
        {caption}
        <span className="block text-[15px] font-semibold leading-5 text-slate-900 dark:text-slate-50">
          {name}
        </span>
        <span className="mt-0.5 block font-figures text-xs leading-4 text-slate-500 dark:text-slate-400">
          <bdi dir="ltr">{person?.code ?? ''}</bdi>
        </span>
        {(facts.expired.has(employeeId) || outReason !== undefined) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {facts.expired.has(employeeId) && (
              <span data-driver-licence="expired">
                <Badge tone="danger" size="sm">
                  {t('fleet.roster.licenceExpired')}
                </Badge>
              </span>
            )}
            {outReason !== undefined && (
              <span data-driver-out={outReason}>
                <Badge tone="warning" size="sm">
                  {facts.reasonLabel(outReason)}
                </Badge>
              </span>
            )}
          </span>
        )}
      </span>
    </>
  );
  // The move, said where the eye already is: a strip across the whole seat, under the name.
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
    outReason !== undefined
      ? 'border-amber-400 bg-amber-50/50 dark:border-amber-600/80 dark:bg-amber-950/20'
      : unsaved
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
  const clear = (
    <button
      type="button"
      data-clear-slot={key}
      aria-label={t('fleet.roster.clearSlot')}
      title={t('fleet.roster.clearSlot')}
      onClick={() => handlers.onClear(row.vehicleId, slot)}
      className="flex w-11 shrink-0 items-center justify-center rounded-e-xl text-slate-400 hover:bg-red-50 hover:text-red-600 active:bg-red-100 dark:text-slate-500 dark:hover:bg-red-950/40 dark:hover:text-red-300"
    >
      <CloseIcon className="h-5 w-5" />
    </button>
  );
  // A car the workshop holds takes nobody (FR-5) — the name is not a picker — but clearing a seat
  // stays legal, as on the computer's seat and on the server.
  if (row.inMaintenance) {
    return (
      <div data-slot={key} data-slot-state="filled" className={frame}>
        <div className="flex min-h-14 flex-1 items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pe-1 ps-3">{body}</div>
          {clear}
        </div>
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
        {clear}
      </div>
      {hint}
    </div>
  );
};

export const CarCard = ({
  row,
  layout,
  mayPlan,
  unsaved,
  facts,
  missionName,
  target,
  handlers,
}: {
  row: FleetRosterRowDto;
  layout: TouchLayout;
  mayPlan: boolean;
  unsaved: boolean;
  facts: SeatFacts;
  missionName: (id: string | null) => string;
  target: SeatTarget | null;
  handlers: CardHandlers;
}): JSX.Element => {
  const t = useT();
  const locked = row.inMaintenance;
  const canSwap =
    mayPlan && !locked && row.driver1EmployeeId !== null && row.driver2EmployeeId !== null;
  const showSwap = mayPlan && !locked;
  const missionEditable = mayPlan && !locked;
  const stacked = layout === 'phone';

  const slot = (s: DutySlot): JSX.Element => (
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

  // The swap is offered only where it can act: both seats filled, the car on the road (as the
  // computer renders its action). Elsewhere a tablet keeps the column for alignment, empty.
  const swap = canSwap ? (
    <button
      type="button"
      data-swap-drivers={row.vehicleId}
      aria-label={t('fleet.roster.swapDrivers')}
      title={t('fleet.roster.swapDrivers')}
      onClick={() => handlers.onSwap(row.vehicleId)}
      className={cn(
        'relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full border transition-colors',
        'border-indigo-200 bg-white text-indigo-600 shadow-sm hover:bg-indigo-50 active:bg-indigo-100 dark:border-indigo-800/80 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60',
      )}
    >
      <SwapIcon className={cn('h-5 w-5', stacked && 'rotate-90')} />
    </button>
  ) : (
    <span aria-hidden="true" className="w-11 shrink-0" />
  );

  const mission =
    row.missionTypeId === null
      ? t('fleet.fixedRoster.noMissionType')
      : missionName(row.missionTypeId);
  // Read-only and no mission: the board's `missionName(null)` — a dash, not the dashed «fill me»
  // pill (that look is for what a tap can change).
  const pill =
    !mayPlan && row.missionTypeId === null ? (
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
          locked && 'opacity-70',
        )}
      >
        <span className="truncate">{mission}</span>
        {missionEditable && <ChevronIcon className="h-4 w-4 shrink-0 opacity-70" />}
      </span>
    );

  const menuEdit = mayPlan && !locked ? () => handlers.onEditNotes(row) : null;
  const menuClear = mayPlan && carriesPlan(row) ? () => handlers.onClearAll(row) : null;
  const menu =
    menuEdit !== null || menuClear !== null ? (
      <MoreMenu row={row} onEdit={menuEdit} onClearAll={menuClear} />
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

  // ── a car the WORKSHOP holds: compact — nothing on it can be assigned (FR-5) ────────────────
  if (locked) {
    const seated = (['driver1EmployeeId', 'driver2EmployeeId'] as const).filter(
      (s) => row[s] !== null,
    );
    return (
      <article
        data-car={row.code}
        data-unsaved={unsaved ? 'true' : undefined}
        data-workshop="true"
        className={cn(
          'rounded-2xl border px-3 py-2.5 transition-colors sm:px-4',
          unsaved
            ? cn(UNSAVED_ROW, 'border-amber-300 dark:border-amber-700/70')
            : 'border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-900/40',
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {code}
            <span className="flex min-w-0 items-center">{pill}</span>
            <RowBadges row={row} inGroup />
          </div>
          {menu}
        </div>
        {seated.length === 0 ? (
          <div
            data-workshop-lock={row.code}
            className="mt-1.5 flex items-center gap-2 text-[13px] leading-5 text-slate-500 dark:text-slate-400"
          >
            <LockIcon className="h-4 w-4 shrink-0" />
            {t('fleet.roster.inWorkshopNoDrop')}
          </div>
        ) : (
          <div className={cn('mt-2.5 gap-2', stacked ? 'space-y-2' : 'grid grid-cols-2')}>
            {seated.map((s) => (
              <div key={s}>{slot(s)}</div>
            ))}
          </div>
        )}
      </article>
    );
  }

  const notes =
    row.notes !== null && row.notes.trim() !== '' ? (
      menuEdit !== null ? (
        <button
          type="button"
          data-notes={row.code}
          data-notes-edit="true"
          onClick={menuEdit}
          aria-label={`${row.code} · ${t('fleet.roster.editAssignment')}`}
          className="mt-2.5 flex min-h-11 w-full items-start gap-2 rounded-lg bg-slate-100/80 px-3 py-2 text-start text-[13px] leading-5 text-slate-700 transition-colors hover:bg-slate-200/70 active:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-slate-500 dark:text-slate-400">
              {t('fleet.attendance.fields.notes')}:
            </span>{' '}
            {row.notes}
          </span>
          <SquarePenIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        </button>
      ) : (
        <p
          data-notes={row.code}
          className="mt-2.5 rounded-lg bg-slate-100/80 px-3 py-2 text-[13px] leading-5 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
        >
          <span className="font-semibold text-slate-500 dark:text-slate-400">
            {t('fleet.attendance.fields.notes')}:
          </span>{' '}
          {row.notes}
        </p>
      )
    ) : null;

  return (
    <article
      data-car={row.code}
      data-unsaved={unsaved ? 'true' : undefined}
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
          {missionEditable ? (
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
          {!stacked && <RowBadges row={row} />}
        </div>
        {menu}
      </div>
      {stacked && (
        <div className="mt-2 empty:hidden">
          <RowBadges row={row} />
        </div>
      )}
      {stacked ? (
        <div className="mt-3 flex items-stretch gap-2">
          {/* Each seat in its own box: `h-full` (for side-by-side seats) resolves to auto here. */}
          <div className="min-w-0 flex-1 space-y-2">
            <div>{slot('driver1EmployeeId')}</div>
            <div>{slot('driver2EmployeeId')}</div>
          </div>
          {canSwap && (
            <div className="relative flex w-11 shrink-0 items-center justify-center">
              {/* The bracket: the two seats the button trades, joined. */}
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
            showSwap ? 'grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)]' : 'grid-cols-2',
          )}
        >
          {slot('driver1EmployeeId')}
          {showSwap && swap}
          {slot('driver2EmployeeId')}
        </div>
      )}
      {notes}
    </article>
  );
};
