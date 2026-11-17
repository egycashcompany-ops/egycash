// «تعيين السيارات» — the day's DRIVERS, one set of lists for every home they have: the phone's
// picker sheet, the portrait tablet's drivers sheet, the landscape tablet's side panel and the
// computer's one drivers panel. Ported from the approved samples without a change of look.
//
// The same two halves the board always had («السائقون المتاحون (n)» / «غير المتاحين (n)»), now as
// tabs over ONE list; the same search (name or code, `filterDrivers`); the same reason chips
// (`reasonSubtotals` / `byReasons`, pressed = amber); the same licence block («منهم رخصة منتهية N»
// — every flagged driver of the day, seated or not, with the two licence-check links). Where a
// seat is being filled, the list adds the drivers the draft holds on OTHER cars, each with that
// car's code; a move is promised («سيُنقل من السيارة … عند الحفظ») in one place only — on the seat,
// after the pick.
//
// The markup hooks the specs and the dashboard links read are the employee ids: a free row
// `data-driver-card`, a licence-block row `data-licence-expired-driver`, an unavailable row
// `data-unavailable-driver`, the block itself `data-licence-expired-panel`.
import { type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type FleetPersonDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Badge } from '../../../../shared/ui/Badge';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { CloseIcon, UserIcon } from '../../../../shared/ui/icons';
import { useDriverHoverCard } from '../DriverHoverCard';
import {
  DRAG_TYPE,
  KNOWN_REASONS,
  type DriverOption,
  type DriverOptions,
  type LicenceBlock,
} from '../../lib/roster-board';
import { Count, num } from './roster-parts';

export type DriverTab = 'available' | 'unavailable';

/** Who an employee id is — the board model's `person`. */
export type PersonOf = (employeeId: string) => FleetPersonDto | undefined;

/** The two halves as a segmented control — each 44px, the count in the label as the page has it. */
export const DriverTabs = ({
  tab,
  onTab,
  availableCount,
  unavailableCount,
  panelIds,
}: {
  tab: DriverTab;
  onTab: (tab: DriverTab) => void;
  availableCount: number;
  unavailableCount: number;
  /** The `id` of each tab's panel, when the caller renders panels (`aria-controls`). */
  panelIds?: Partial<Record<DriverTab, string>>;
}): JSX.Element => {
  const t = useT();
  const item = (key: DriverTab, label: string, count: number, tone: string): JSX.Element => {
    const on = tab === key;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        aria-controls={panelIds?.[key]}
        data-driver-tab={key}
        onClick={() => onTab(key)}
        className={cn(
          'flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors',
          on
            ? cn(
                'bg-white shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-700 dark:ring-white/10',
                tone,
              )
            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
        )}
      >
        <span className="truncate">{label}</span>
        <Count
          value={count}
          className={cn('text-xs font-medium', on ? 'opacity-80' : 'opacity-70')}
        />
      </button>
    );
  };
  return (
    <div role="tablist" className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80">
      {item(
        'available',
        t('fleet.roster.availableTitle'),
        availableCount,
        'text-emerald-800 dark:text-emerald-200',
      )}
      {item(
        'unavailable',
        t('fleet.roster.unavailableTitle'),
        unavailableCount,
        'text-slate-900 dark:text-slate-50',
      )}
    </div>
  );
};

/** «ابحث بالاسم أو الكود…» over the list on show — 44px, 16px words (no zoom on a phone). */
export const DriverSearch = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <SearchInput
      value={value}
      onChange={onChange}
      debounceMs={0}
      textScale="comfortable"
      placeholder={t('fleet.fixedRoster.driverSearchPlaceholder')}
      className="w-full [&_input]:h-11"
    />
  );
};

/**
 * A name that opens the driver card on hover — the computer's panel only (`hoverCard`): touch has
 * no hover, and its lists draw exactly as before. Not focusable: the row around it is the control.
 */
const CardedName = ({
  record,
  children,
}: {
  record: FleetPersonDto | undefined;
  children: ReactNode;
}): JSX.Element => {
  const hover = useDriverHoverCard(record === undefined ? [] : [record], { focusable: false });
  return (
    <>
      <span {...hover.triggerProps}>{children}</span>
      {hover.card}
    </>
  );
};

/** The face of a driver in every list: the DriverChip green, the name, the code (ltr). */
const DriverFace = ({
  employeeId,
  person,
  muted = false,
  extra,
  hoverCard = false,
}: {
  employeeId: string;
  person: PersonOf;
  muted?: boolean;
  extra?: ReactNode;
  hoverCard?: boolean;
}): JSX.Element => {
  const record = person(employeeId);
  // The id's tail when the name is out of reach (no `fleetDriver.view`, or not landed yet).
  const name = record?.fullNameAr ?? employeeId.slice(-8);
  return (
    <>
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          muted
            ? 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500'
            : 'bg-green-700 text-white dark:bg-green-600',
        )}
      >
        <UserIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[15px] font-semibold leading-5',
            muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-50',
          )}
        >
          {hoverCard ? <CardedName record={record}>{name}</CardedName> : name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span dir="ltr" className="font-figures">
            {record?.code ?? ''}
          </span>
          {extra}
        </span>
      </span>
    </>
  );
};

const SectionHead = ({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'danger';
}): JSX.Element => (
  <div
    className={cn(
      'px-4 pb-1 pt-4 text-xs font-semibold',
      tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400',
    )}
  >
    {children}
  </div>
);

/** Which list a row sits in — it decides the row's markup hook. */
type RowHome = 'free' | 'licence' | 'seated';

/**
 * The AVAILABLE half.
 *   onPick       a seat is being filled: a tap places the driver there
 *   onIdlePick   no seat yet: a tap CHOOSES the driver, the next seat tap places him
 *   neither      only looking (a reader who cannot plan, a past day): rows, not buttons
 * Optional, so touch draws exactly as the approved sample:
 *   hoverCard    every name opens the driver card on hover (the computer)
 *   part         'list' — the list without the licence block; 'licence' — the block alone, which
 *                the computer pins under the list as RosterPage did (`max-h-[45%]` footer)
 */
export const AvailableList = ({
  options,
  person,
  onPick,
  onIdlePick,
  pendingId = null,
  occupant = null,
  licence,
  dayHasDrivers,
  searched,
  draggable = false,
  onDragDriver,
  hoverCard = false,
  part = 'all',
}: {
  options: DriverOptions;
  person: PersonOf;
  onPick: ((employeeId: string) => void) | null;
  onIdlePick?: ((employeeId: string) => void) | undefined;
  /** The driver chosen first, still waiting for a seat. */
  pendingId?: string | null;
  /** Who sits in the seat being filled — he goes back to the pool if somebody else is picked. */
  occupant?: { employeeId: string; onClear: () => void } | null;
  /** The «منهم رخصة منتهية» block — null when the board's licence check is off. */
  licence: LicenceBlock | null;
  dayHasDrivers: boolean;
  searched: boolean;
  draggable?: boolean;
  /** Told when a drag from this list starts (the id) and ends (null) — a seat may light up. */
  onDragDriver?: ((employeeId: string | null) => void) | undefined;
  hoverCard?: boolean;
  part?: 'all' | 'list' | 'licence';
}): JSX.Element | null => {
  const t = useT();
  const look = onPick === null && onIdlePick === undefined && !draggable;
  const row = (option: DriverOption, home: RowHome): JSX.Element => {
    const seated = option.state === 'seated';
    const code = person(option.employeeId)?.code;
    const badge = option.licenceExpired ? (
      <Badge tone="danger" size="sm" className="shrink-0">
        {t('fleet.roster.licenceExpired')}
      </Badge>
    ) : seated ? (
      // The assign dialog's badge: the other car's CODE (its word only when the code is unknown).
      <Badge tone="info" size="sm" className="shrink-0">
        {option.seatedCode === null ? (
          t('fleet.roster.otherVehicle')
        ) : (
          <bdi dir="ltr" className="font-figures">
            {option.seatedCode}
          </bdi>
        )}
      </Badge>
    ) : (
      <Badge tone="success" size="sm" className="shrink-0">
        {t('fleet.roster.free')}
      </Badge>
    );
    // In the licence block a seated driver says where, as the board always did.
    const extra =
      home === 'licence' && seated && option.seatedCode !== null ? (
        <span className="text-slate-600 dark:text-slate-300">
          {t('fleet.roster.expiredLicence.seatedOn', { code: option.seatedCode })}
        </span>
      ) : undefined;
    const pending = pendingId === option.employeeId;
    // A seated driver is pickable only as a MOVE onto a seat being filled — never "chosen first",
    // and never onto his own car.
    const tap =
      onPick !== null
        ? option.onTarget
          ? null
          : () => onPick(option.employeeId)
        : onIdlePick !== undefined && !seated
          ? () => onIdlePick(option.employeeId)
          : null;
    // The markup hooks: a free row is the pool's card, a licence row is the block's, a seated row
    // is neither (the pool never offers a driver the day already seats).
    const card = home === 'free' ? option.employeeId : undefined;
    const homeProps =
      home === 'licence'
        ? { 'data-licence-expired-driver': option.employeeId }
        : home === 'seated'
          ? { 'data-seated-driver': option.employeeId }
          : {};
    const face = (
      <DriverFace
        employeeId={option.employeeId}
        person={person}
        extra={extra}
        hoverCard={hoverCard}
      />
    );
    const dragSource = draggable && !seated;
    if (look || (tap === null && !dragSource)) {
      return (
        <li
          key={option.employeeId}
          {...homeProps}
          data-pool-driver={code}
          data-driver-state={option.state}
          data-driver-card={card}
          className="flex min-h-14 items-center gap-3 px-4 py-2"
        >
          {face}
          {badge}
        </li>
      );
    }
    const drag = {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData(DRAG_TYPE, option.employeeId);
        event.dataTransfer.effectAllowed = 'move';
        onDragDriver?.(option.employeeId);
      },
      onDragEnd: () => onDragDriver?.(null),
    };
    const rowLook = cn(
      'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start transition-colors',
      pending
        ? 'bg-brand-50 shadow-[inset_3px_0_0_0] shadow-brand-600 dark:bg-brand-950/50 dark:shadow-brand-400'
        : 'hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none active:bg-slate-100 dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60 dark:active:bg-slate-800',
      dragSource && 'cursor-grab active:cursor-grabbing',
    );
    // A drag source and nothing else (the computer's panel: no seat is being filled, no driver is
    // chosen first): the drag is its one use, so it is no button — no Tab stop announced as a
    // toggle that does nothing. The keyboard's way onto a seat is the seat's «+ اختيار سائق».
    if (tap === null) {
      return (
        <li key={option.employeeId} {...homeProps}>
          <div
            data-pick-driver={code}
            data-driver-state={option.state}
            data-driver-card={card}
            draggable
            {...drag}
            className={rowLook}
          >
            {face}
            {badge}
          </div>
        </li>
      );
    }
    return (
      <li key={option.employeeId} {...homeProps}>
        <button
          type="button"
          data-pick-driver={code}
          data-driver-state={option.state}
          data-pending={pending ? 'true' : undefined}
          aria-pressed={onPick === null ? pending : undefined}
          data-driver-card={card}
          draggable={dragSource}
          {...drag}
          onClick={() => tap()}
          className={rowLook}
        >
          {face}
          {badge}
        </button>
      </li>
    );
  };
  const occupantRow =
    occupant === null ? null : (
      <div
        data-occupant={person(occupant.employeeId)?.code}
        className="mx-3 mt-3 flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pe-1.5 ps-3 dark:border-slate-700 dark:bg-slate-800/50"
      >
        <DriverFace employeeId={occupant.employeeId} person={person} />
        <button
          type="button"
          data-clear-occupant="true"
          onClick={occupant.onClear}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 active:bg-red-100 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          <CloseIcon className="h-4 w-4" />
          {t('fleet.roster.clearSlot')}
        </button>
      </div>
    );
  const linkClass =
    'inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200';
  const licenceBlock =
    licence === null ? null : (
      <div data-licence-expired-panel="true">
        <SectionHead tone="danger">
          {t('fleet.roster.expiredLicence.title', { count: num(licence.count) })}
        </SectionHead>
        <p className="px-4 pb-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
          {t('fleet.roster.expiredLicence.hint')}
        </p>
        {options.flagged.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {options.flagged.map((option) => row(option, 'licence'))}
          </ul>
        )}
        {(licence.links.drivers !== null || licence.links.vehicles !== null) && (
          <div className="flex flex-wrap gap-x-5 px-4">
            {licence.links.drivers !== null && (
              <Link to={licence.links.drivers} data-licence-check="drivers" className={linkClass}>
                {t('fleet.roster.expiredLicence.driversLink')}
              </Link>
            )}
            {licence.links.vehicles !== null && (
              <Link to={licence.links.vehicles} data-licence-check="vehicles" className={linkClass}>
                {t('fleet.roster.expiredLicence.vehiclesLink', {
                  count: num(licence.links.vehiclesCount),
                })}
              </Link>
            )}
          </div>
        )}
      </div>
    );
  if (part === 'licence') return licenceBlock;
  // A day with nobody available still has its licence check: the expired-licence vehicles are a
  // fact about the cars, and the block says so under «لا يوجد سائقون متاحون», as the board always did.
  if (!dayHasDrivers) {
    return (
      <div>
        {occupantRow}
        <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.roster.availableEmpty')}
        </p>
        {part === 'all' && licenceBlock}
      </div>
    );
  }
  const nothing = options.free.length + options.flagged.length + options.seated.length === 0;
  // The free list empty: the day has no free licensed driver left («لا يوجد سائقون متاحون في هذا
  // التاريخ»), or the term found nobody — said where the list would be (on touch only when the term
  // found nobody anywhere; on the computer's list, whose licence block is pinned apart, as the
  // board always said it: «nobody HERE»).
  const emptyLine =
    options.free.length > 0
      ? null
      : !searched
        ? 'fleet.roster.availableEmpty'
        : nothing || part === 'list'
          ? 'fleet.fixedRoster.driverSearchEmpty'
          : null;
  return (
    <div data-available-list="true">
      {occupantRow}
      {emptyLine !== null ? (
        <p
          data-available-empty={searched ? 'search' : 'day'}
          className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
        >
          {t(emptyLine)}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {options.free.map((option) => row(option, 'free'))}
        </ul>
      )}
      {part === 'all' && licenceBlock}
      {options.seated.length > 0 && (
        <>
          <SectionHead>
            {t('fleet.roster.onOtherVehicles')}{' '}
            <Count value={options.seated.length} className="font-normal" />
          </SectionHead>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {options.seated.map((option) => row(option, 'seated'))}
          </ul>
        </>
      )}
      <div className="h-3" />
    </div>
  );
};

/** The UNAVAILABLE half: the reason chips, then each driver with his reason — never pickable. */
export const UnavailableList = ({
  drivers,
  person,
  chips,
  reasons,
  onToggleReason,
  searched,
  dayHasAny,
  hoverCard = false,
}: {
  drivers: readonly { employeeId: string; reason: string }[];
  person: PersonOf;
  chips: readonly { reason: string; count: number }[];
  reasons: readonly string[];
  onToggleReason: (reason: string) => void;
  searched: boolean;
  dayHasAny: boolean;
  /** The computer: each name opens the driver card on hover. */
  hoverCard?: boolean;
}): JSX.Element => {
  const t = useT();
  const label = (reason: string): string =>
    KNOWN_REASONS.has(reason) ? t(`fleet.roster.reason.${reason}`) : reason;
  if (!dayHasAny) {
    return (
      <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('fleet.roster.unavailableEmpty')}
      </p>
    );
  }
  return (
    <div data-unavailable-list="true">
      {chips.length > 0 && (
        <div
          role="group"
          aria-label={t('fleet.roster.reasonFilter')}
          className="flex flex-wrap gap-2 px-4 pb-1 pt-3"
        >
          {chips.map(({ reason, count }) => {
            const on = reasons.includes(reason);
            return (
              <button
                key={reason}
                type="button"
                data-reason-filter={reason}
                aria-pressed={on}
                onClick={() => onToggleReason(reason)}
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
                  on
                    ? 'border-amber-500 bg-amber-100 text-amber-900 dark:border-amber-400 dark:bg-amber-900/40 dark:text-amber-100'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <span>{label(reason)}</span>
                <span className="font-figures font-bold">{num(count)}</span>
              </button>
            );
          })}
        </div>
      )}
      {drivers.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {t(
            !searched && reasons.length > 0
              ? 'fleet.roster.reasonFilterEmpty'
              : 'fleet.fixedRoster.driverSearchEmpty',
          )}
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800/80">
          {drivers.map((driver) => (
            <li
              key={driver.employeeId}
              data-unavailable-driver={driver.employeeId}
              aria-disabled="true"
              className="flex min-h-14 items-center gap-3 px-4 py-2"
            >
              <DriverFace
                employeeId={driver.employeeId}
                person={person}
                muted
                hoverCard={hoverCard}
              />
              <Badge tone="warning" size="sm" className="shrink-0">
                {label(driver.reason)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="h-3" />
    </div>
  );
};
