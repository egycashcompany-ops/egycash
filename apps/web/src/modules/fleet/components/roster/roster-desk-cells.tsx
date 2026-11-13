// «تعيين السيارات» on a computer: the table's cells that are not one-liners — «شاشه الكبيوتر
// اعملها زى باقى شاشات الحركة الجديده ك ui».
//
//   StatusCell  the «الحالة» badges — same predicates, words and tones — each badge on ONE line
//               («الدواير بتتقسم 5 سطور»), stacked when there are several.
//   SeatCell    a seat as a compact form of the approved touch seat: the green person mark, the
//               name, the employee code under it; an AMBER frame and the reason badge when the
//               driver has a problem today (out, or licence expired); the move promised in ONE
//               place («سيُنقل من السيارة 247 عند الحفظ»). A drop target exactly where the board
//               always had one (`data-drop-zone`, same rules), the «+ اختيار سائق» picker on an
//               empty seat, the slot bin on a filled one. A car the workshop holds says so ONCE:
//               «في الورشة — غير قابلة للتعيين» in the first seat, «—» in the second.
//
// DECLARED AT MODULE LEVEL. A component written inside the board is a new element TYPE on every
// render, so React would unmount the cell instead of updating it — which destroys the node a drag
// in flight belongs to and makes the browser cancel it.
//
// Every seat is `<div><div data-drop-zone …>…</div></div>`: one zone element per seat, whatever the
// seat holds, so a seat is read the same way in every state.
import { type DragEvent } from 'react';
import { type FleetPersonDto, type FleetRosterRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Badge } from '../../../../shared/ui/Badge';
import { SwapIcon, TrashIcon, UserIcon } from '../../../../shared/ui/icons';
import { DriverSlotPicker } from '../DriverSlotPicker';
import { NUM } from '../FuelCardBoard';
import { useDriverHoverCard } from '../DriverHoverCard';
import { type DriverSearchRecord } from '../../lib/driver-search';
import { type DutySlot } from '../../lib/daily-roster-board';
import { hasCrewGap, hasDriver, hasOtherCrewGap } from '../../lib/roster-view';
import { DRAG_TYPE, SLOT_WORD } from '../../lib/roster-board';

export const DASH = <span className="text-slate-400 dark:text-slate-500">—</span>;

/** The «الحالة» cell's badges, one line each. */
export const StatusCell = ({ row }: { row: FleetRosterRowDto }): JSX.Element => {
  const t = useT();
  const any =
    row.inMaintenance ||
    hasDriver(row) ||
    row.licenceExpired === true ||
    hasCrewGap(row) ||
    hasOtherCrewGap(row) ||
    row.stalePlan === true;
  if (!any) return DASH;
  return (
    <span
      data-status-cell="true"
      className="mx-auto flex w-max flex-col items-center gap-1 [&_span]:whitespace-nowrap"
    >
      {/* The workshop badge is always said: the row's rose tint is never the only carrier. */}
      {row.inMaintenance && (
        <Badge tone="info" size="sm">
          {t('fleet.vehicles.inWorkshop')}
        </Badge>
      )}
      {/* `hasDriver`, not `carriesPlan`: a mission with nobody on it is not an assignment. */}
      {hasDriver(row) && (
        <Badge tone="success" size="sm">
          {t('fleet.roster.assigned')}
        </Badge>
      )}
      {/* The day's rules, each the server's mark on this row (R-03, R-06). */}
      {row.licenceExpired === true && (
        <span data-roster-flag="licenceExpired">
          <Badge tone="danger" size="sm">
            {t('fleet.roster.licenceExpired')}
          </Badge>
        </span>
      )}
      {hasCrewGap(row) && (
        <span data-roster-flag="crewGap">
          <Badge tone="warning" size="sm">
            {t('fleet.roster.crewAbsent')}
          </Badge>
        </span>
      )}
      {hasOtherCrewGap(row) && (
        <span data-roster-flag="crewUnavailable">
          <Badge tone="neutral" size="sm">
            {t('fleet.roster.crewUnavailable')}
          </Badge>
        </span>
      )}
      {row.stalePlan === true && (
        <span data-roster-flag="stalePlan">
          <Badge tone="warning" size="sm">
            {t('fleet.roster.stalePlan')}
          </Badge>
        </span>
      )}
    </span>
  );
};

/** What every seat needs to know about the day besides its own row (the board model's answers). */
export interface SeatFacts {
  expired: ReadonlySet<string>;
  /** employeeId → reason, for the drivers who are OUT today (FR-6). */
  unavailable: ReadonlyMap<string, string>;
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  person: (employeeId: string) => FleetPersonDto | undefined;
  reasonLabel: (reason: string) => string;
}

/** Letters a seat's one line holds at the table's 12.5px (a four-part name has about 21). */
const LONG_NAME = 24;

const SEAT_BOX = 'mx-auto w-full min-w-[11rem] max-w-[15rem] rounded-lg border transition-colors';
const DROP_ON =
  'border-brand-500 bg-brand-50 ring-2 ring-brand-500/40 dark:border-brand-400 dark:bg-brand-950 dark:ring-brand-400/40';

/** The person in a seat: the approved touch face at a table's size, with the driver card. */
const SeatPerson = ({
  employeeId,
  person,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  problem,
}: {
  employeeId: string;
  person: FleetPersonDto | undefined;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  problem: JSX.Element | null;
}): JSX.Element => {
  // Not focusable: the seat's Tab stops are its bin and the row's buttons, as on the board before.
  const hover = useDriverHoverCard(person === undefined ? [] : [person], { focusable: false });
  const longName = (person?.fullNameAr ?? '').length > LONG_NAME;
  return (
    <>
      <span
        data-driver-chip={employeeId}
        {...hover.triggerProps}
        draggable={draggable}
        // The driver card closes on a drag start too (its own handler) — both run.
        onDragStart={(event) => {
          hover.triggerProps.onDragStart?.();
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 text-start',
          draggable && 'cursor-grab active:cursor-grabbing',
          dragging && 'opacity-50',
        )}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-700 text-white dark:bg-green-600">
          <UserIcon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          {/* A name longer than a seat holds on one line (over 24 letters — a four- or five-part
              name) takes a second line rather than widening its seat, and with it the table past
              its frame at 1536px. Every shorter name keeps its one line. Never a third line: the
              driver card (hover) says the whole name, so no `title` competes with it. */}
          <span
            data-seat-name={longName ? 'long' : 'true'}
            className={cn(
              'text-[12.5px] font-bold leading-5 text-slate-900 min-[1750px]:text-sm dark:text-slate-50',
              longName
                ? 'line-clamp-2 whitespace-normal break-words [text-wrap:balance]'
                : 'block whitespace-nowrap',
            )}
          >
            {/* The id's tail when the name is out of reach (no `fleetDriver.view`, or not landed
                yet) — a seat that is taken must not read as empty. */}
            {person?.fullNameAr ?? employeeId.slice(-8)}
          </span>
          <span className="flex items-center gap-1.5 leading-4">
            <bdi
              dir="ltr"
              // The figures' face by NUM, not `.font-figures` — the boards' table resizes that class.
              className={cn(NUM, 'text-[11px] font-semibold text-slate-500 dark:text-slate-400')}
            >
              {person?.code ?? ''}
            </bdi>
            {problem}
          </span>
        </span>
      </span>
      {hover.card}
    </>
  );
};

export const SeatCell = ({
  row,
  slot,
  mayPlan,
  over,
  setOver,
  dragging,
  setDragging,
  facts,
  pool,
  searchIndex,
  onDrop,
  onClear,
}: {
  row: FleetRosterRowDto;
  slot: DutySlot;
  mayPlan: boolean;
  over: string | null;
  setOver: (update: (key: string | null) => string | null) => void;
  dragging: string | null;
  setDragging: (employeeId: string | null) => void;
  facts: SeatFacts;
  /** The day's free drivers — the list «+ اختيار سائق» offers, exactly the pool a drag carries. */
  pool: readonly { employeeId: string }[];
  searchIndex: ReadonlyMap<string, DriverSearchRecord>;
  onDrop: (row: FleetRosterRowDto, slot: DutySlot, employeeId: string) => void;
  onClear: (row: FleetRosterRowDto, slot: DutySlot) => void;
}): JSX.Element => {
  const t = useT();
  const employeeId = row[slot];
  const key = `${row.vehicleId}:${slot}`;
  // The three refusals: the workshop (FR-5), «الأول قبل الثاني» (a second driver with no first is
  // refused by the server too — DRIVER2_WITHOUT_DRIVER1), and a reader who cannot plan (a past day,
  // or no `fleetRoster.plan`). `onDragOver` never prevents the default on a refused seat, so the
  // browser does not treat it as a drop target at all.
  const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null;
  const droppable = mayPlan && !row.inMaintenance && !needsFirst;
  const active = over === key;
  const label = `${row.code} · ${t(SLOT_WORD[slot])}`;
  const zone = {
    'data-drop-zone': key,
    'data-drop-disabled': row.inMaintenance
      ? 'maintenance'
      : needsFirst
        ? 'needsFirstDriver'
        : !mayPlan
          ? 'readOnly'
          : undefined,
    'aria-label': label,
    ...(droppable
      ? {
          onDragOver: (event: DragEvent) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setOver(() => key);
          },
          onDragLeave: () => setOver((current) => (current === key ? null : current)),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            const id = event.dataTransfer.getData(DRAG_TYPE);
            if (id !== '') onDrop(row, slot, id);
          },
        }
      : {}),
  };

  if (employeeId === null) {
    // A car the workshop holds: ONE line for the row, in the first seat — the second says «—».
    if (row.inMaintenance) {
      return (
        <div>
          {slot === 'driver2EmployeeId' ? (
            <div {...zone} data-seat-state="workshop">
              {DASH}
            </div>
          ) : (
            <div
              {...zone}
              data-seat-state="workshop"
              className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
            >
              {t(mayPlan ? 'fleet.roster.inWorkshopNoDrop' : 'fleet.fixedRoster.noDriver')}
            </div>
          )}
        </div>
      );
    }
    if (!droppable) {
      return (
        <div>
          <div
            {...zone}
            data-seat-state="locked"
            className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500"
          >
            {t(!mayPlan ? 'fleet.fixedRoster.noDriver' : 'fleet.fixedRoster.needsFirstDriver')}
          </div>
        </div>
      );
    }
    // Dashed IS the affordance: a drop lands here, a click opens the picker over the same pool.
    return (
      <div>
        <div
          {...zone}
          data-seat-state="empty"
          className={cn(
            SEAT_BOX,
            'flex min-h-11 items-center border-dashed px-1.5',
            '[&_button[aria-haspopup]]:font-semibold [&_button[aria-haspopup]]:text-brand-700 dark:[&_button[aria-haspopup]]:text-brand-300',
            active
              ? DROP_ON
              : 'border-slate-300 bg-slate-50/60 hover:border-brand-400 dark:border-slate-700 dark:bg-[#080C14]/60 dark:hover:border-brand-500',
          )}
        >
          <DriverSlotPicker
            drivers={pool}
            index={searchIndex}
            slotKey={key}
            label={label}
            onSelect={(id) => onDrop(row, slot, id)}
          />
        </div>
      </div>
    );
  }

  const outReason = facts.unavailable.get(employeeId);
  const expired = facts.expired.has(employeeId);
  const problem = outReason !== undefined || expired;
  const movedFrom = facts.transferFrom(employeeId, row.vehicleId);
  const badges = !problem ? null : (
    <>
      {expired && (
        <span data-driver-licence="expired">
          <Badge tone="danger" size="sm" className="whitespace-nowrap">
            {t('fleet.roster.licenceExpired')}
          </Badge>
        </span>
      )}
      {outReason !== undefined && (
        <span data-driver-out={outReason}>
          <Badge tone="warning" size="sm" className="whitespace-nowrap">
            {facts.reasonLabel(outReason)}
          </Badge>
        </span>
      )}
    </>
  );
  return (
    <div>
      <div
        {...zone}
        data-seat-state="filled"
        data-problem={problem ? 'true' : undefined}
        className={cn(
          SEAT_BOX,
          'flex min-h-11 flex-col',
          active
            ? DROP_ON
            : problem
              ? 'border-amber-400 bg-amber-50/70 dark:border-amber-600/80 dark:bg-amber-950/25'
              : 'border-slate-200 bg-slate-50 dark:border-slate-700/70 dark:bg-slate-800/40',
        )}
      >
        <div className="flex min-h-11 flex-1 items-center gap-0.5 py-1 pe-0.5 ps-1">
          <SeatPerson
            employeeId={employeeId}
            person={facts.person(employeeId)}
            draggable={mayPlan}
            dragging={dragging === employeeId}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, employeeId);
              event.dataTransfer.effectAllowed = 'move';
              setDragging(employeeId);
            }}
            onDragEnd={() => setDragging(null)}
            problem={badges}
          />
          {/* One person off this seat — a bin, as every removal on the computer («خليهم علامه
              سله»). Clearing the first seat moves the second up. */}
          {mayPlan && (
            <button
              type="button"
              data-clear-slot={key}
              data-seat-bin="true"
              aria-label={t('fleet.roster.clearSlot')}
              title={t('fleet.roster.clearSlot')}
              onClick={() => onClear(row, slot)}
              className="flex shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:text-slate-500 dark:hover:text-[#e86870]"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {movedFrom !== null && (
          <span
            data-transfer-hint={movedFrom}
            className="flex items-center gap-1 rounded-b-lg border-t border-amber-200 bg-amber-50 px-2 py-1 text-start text-[11px] font-semibold leading-4 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200"
          >
            <SwapIcon className="h-3 w-3 shrink-0" />
            <span className="[text-wrap:balance]">
              {t('fleet.roster.transferHint', { code: movedFrom })}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
