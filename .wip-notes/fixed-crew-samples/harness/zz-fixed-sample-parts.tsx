// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» in the design of «تعيين السيارات» — the pieces BOTH layouts draw that the daily
// board cannot lend as they are (gap map §10 «Copy into zz»):
//
//   FixedStatusCell   «الحالة»: «في الورشة» + «معيّنة» / «بلا طقم» — the fixed words and tones, in
//                     the daily cell's stacked one-line badges (the daily cell draws «—» where this
//                     board says «بلا طقم», and its day badges have no meaning here)
//   DriversHead       a plain panel heading in the daily tabs' 44px row: «السائقون (11)» — ONE list,
//                     so no segmented track and no lone raised pill
//   FixedDriverList   the daily list's face (green disc, name, code) with the STANDING badges: none on
//                     a free driver (no «متاح», and no licence or profile flag — owner Q1 ب: those
//                     are the daily's); the free drivers FIRST, then the
//                     daily's grey section «معيّنون على سيارات أخرى (n)»: the drivers a car on the
//                     board holds (a seat being filled: a tap MOVES them; badge = that car's code) and
//                     the ones a car OFF the board holds (badge «سيارة أخرى») — the daily's info tone
//   EditCrewDialog    the fixed «تعديل» dialog: its fields, rules and words (FixedRosterPage.tsx:
//                     110-322), the two seats drawn as the daily dialog's DriverSlot (name row + ✕,
//                     «اختيار سائق» opening a list) instead of two native selects
//   FixedMissionSheet / FixedNotesSheet   the daily touch sheets with the fixed title «تعديل · 150»,
//                     the dialog's catalog lines and its 500-letter note (gap map C4)
import { type DragEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { type FleetFixedCrewRowDto, type FleetPersonDto, type Locale } from '@ecms/contracts';
import { useT } from './platform/localization/useT';
import { useAppSelector } from './store';
import { cn } from './shared/lib/cn';
import { localized } from './shared/lib/format';
import { Badge } from './shared/ui/Badge';
import { Button } from './shared/ui/Button';
import { Dialog } from './shared/ui/Dialog';
import { Field, Select, Textarea } from './shared/ui/form';
import { CheckIcon, CloseIcon, UserIcon } from './shared/ui/icons';
import { useDriverHoverCard } from './modules/fleet/components/DriverHoverCard';
import { EmployeeName } from './modules/fleet/components/EmployeeName';
import { BottomSheet } from './modules/fleet/components/roster/RosterBottomSheet';
import { Count } from './modules/fleet/components/roster/roster-parts';
import { DRAG_TYPE, type MissionOption } from './modules/fleet/lib/roster-board';
import { hasDriver } from './modules/fleet/lib/roster-view';
import { type useFleetCatalog } from './modules/fleet/api/fleet-queries';
import { POOL_EMPTY, type EditValues, type FixedDriverOption } from './zz-fixed-sample-model';

export const DASH = <span className="text-slate-400 dark:text-slate-500">—</span>;

// ── «الحالة» ────────────────────────────────────────────────────────────────────────────────────

/** The fixed page's two facts (P:940-956), each badge on ONE line, stacked — never «—». */
export const FixedStatusCell = ({ row }: { row: FleetFixedCrewRowDto }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-status-cell="true"
      className="mx-auto flex w-max flex-col items-center gap-1 [&_span]:whitespace-nowrap"
    >
      {row.inMaintenance && (
        <Badge tone="info" size="sm">
          {t('fleet.vehicles.inWorkshop')}
        </Badge>
      )}
      {hasDriver(row) ? (
        <Badge tone="success" size="sm">
          {t('fleet.roster.assigned')}
        </Badge>
      ) : (
        <span data-uncrewed="true">
          <Badge tone="neutral" size="sm">
            {t('fleet.fixedRoster.unassigned')}
          </Badge>
        </span>
      )}
    </span>
  );
};

/** The card's badges — the same two facts at the touch size. */
export const FixedBadges = ({ row }: { row: FleetFixedCrewRowDto }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {row.inMaintenance && <Badge tone="info">{t('fleet.vehicles.inWorkshop')}</Badge>}
      {hasDriver(row) ? (
        <Badge tone="success">{t('fleet.roster.assigned')}</Badge>
      ) : (
        <span data-uncrewed="true">
          <Badge tone="neutral">{t('fleet.fixedRoster.unassigned')}</Badge>
        </span>
      )}
    </div>
  );
};

// ── the drivers ─────────────────────────────────────────────────────────────────────────────────

/**
 * «السائقون (11)» — a plain panel heading. ONE list here, so no segmented track and no lone raised
 * pill (a control with nothing to switch); it keeps the daily tabs' 44px row, their 13px emerald
 * title and count, so the search under it sits where the daily's does.
 */
export const DriversHead = ({ count }: { count: number }): JSX.Element => {
  const t = useT();
  return (
    <h2
      data-drivers-head="true"
      className="flex h-11 min-w-0 items-center gap-1 px-1 text-[13px] font-semibold text-emerald-800 dark:text-emerald-200"
    >
      <span className="truncate">{t('fleet.fixedRoster.driversTitle')}</span>
      <Count value={count} className="text-xs font-medium opacity-80" />
    </h2>
  );
};

/** A name that opens the driver card on hover — the computer only. */
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

/** The daily list's face: the green disc, the name, the code (ltr). */
const DriverFace = ({
  employeeId,
  person,
  hoverCard,
}: {
  employeeId: string;
  person: (employeeId: string) => FleetPersonDto | undefined;
  hoverCard: boolean;
}): JSX.Element => {
  const record = person(employeeId);
  const name = record?.fullNameAr ?? employeeId.slice(-8);
  return (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-700 text-white dark:bg-green-600">
        <UserIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-5 text-slate-900 dark:text-slate-50">
          {hoverCard ? <CardedName record={record}>{name}</CardedName> : name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span dir="ltr" className="font-figures">
            {record?.code ?? ''}
          </span>
        </span>
      </span>
    </>
  );
};

/**
 * The standing pool, in the daily list's shape.
 *   onPick       a seat is being filled: a tap places the driver (a seated one MOVES)
 *   onIdlePick   no seat yet (touch): a tap CHOOSES the driver, the next seat tap places him
 *   draggable    the computer's panel: a free row drags onto a seat
 */
export const FixedDriverList = ({
  options,
  person,
  hasDrivers,
  searched,
  onPick,
  onIdlePick,
  pendingId = null,
  occupant = null,
  draggable = false,
  onDragDriver,
  hoverCard = false,
}: {
  options: { free: FixedDriverOption[]; seated: FixedDriverOption[] };
  person: (employeeId: string) => FleetPersonDto | undefined;
  /** The pool holds anybody at all (before the term). */
  hasDrivers: boolean;
  searched: boolean;
  onPick: ((employeeId: string) => void) | null;
  onIdlePick?: ((employeeId: string) => void) | undefined;
  pendingId?: string | null;
  occupant?: { employeeId: string; onClear: () => void } | null;
  draggable?: boolean;
  onDragDriver?: ((employeeId: string | null) => void) | undefined;
  hoverCard?: boolean;
}): JSX.Element => {
  const t = useT();
  const row = (option: FixedDriverOption): JSX.Element => {
    const seated = option.state === 'seated';
    const code = person(option.employeeId)?.code;
    const badges = (
      <span className="flex shrink-0 flex-col items-end gap-1">
        {seated && option.seatedCode !== null && (
          <Badge tone="info" size="sm" className="shrink-0">
            <bdi dir="ltr" className="font-figures">
              {option.seatedCode}
            </bdi>
          </Badge>
        )}
        {/* Held by a car off this board: the daily's rule for a car it cannot name — the word,
            in the same info tone as a code. */}
        {option.heldElsewhere && (
          <Badge tone="info" size="sm" className="shrink-0">
            {t('fleet.roster.otherVehicle')}
          </Badge>
        )}
      </span>
    );
    const face = (
      <DriverFace employeeId={option.employeeId} person={person} hoverCard={hoverCard} />
    );
    const tap =
      onPick !== null
        ? () => onPick(option.employeeId)
        : onIdlePick !== undefined && !seated
          ? () => onIdlePick(option.employeeId)
          : null;
    const hooks = seated
      ? { 'data-seated-driver': option.employeeId }
      : {
          'data-driver-card': option.employeeId,
          'data-held-elsewhere': option.heldElsewhere ? 'true' : undefined,
        };
    const dragSource = draggable && !seated;
    const pending = pendingId === option.employeeId;
    const rowLook = cn(
      'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start transition-colors',
      pending
        ? 'bg-brand-50 shadow-[inset_3px_0_0_0] shadow-brand-600 dark:bg-brand-950/50 dark:shadow-brand-400'
        : 'hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none active:bg-slate-100 dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60 dark:active:bg-slate-800',
      dragSource && 'cursor-grab active:cursor-grabbing',
    );
    const drag = {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData(DRAG_TYPE, option.employeeId);
        event.dataTransfer.effectAllowed = 'move';
        onDragDriver?.(option.employeeId);
      },
      onDragEnd: () => onDragDriver?.(null),
    };
    if (tap === null && !dragSource) {
      return (
        <li
          key={option.employeeId}
          {...hooks}
          data-pool-driver={code}
          className="flex min-h-14 items-center gap-3 px-4 py-2"
        >
          {face}
          {badges}
        </li>
      );
    }
    if (tap === null) {
      return (
        <li key={option.employeeId}>
          <div data-pick-driver={code} {...hooks} draggable {...drag} className={rowLook}>
            {face}
            {badges}
          </div>
        </li>
      );
    }
    return (
      <li key={option.employeeId}>
        <button
          type="button"
          data-pick-driver={code}
          {...hooks}
          data-pending={pending ? 'true' : undefined}
          aria-pressed={onPick === null ? pending : undefined}
          draggable={dragSource}
          {...drag}
          onClick={() => tap()}
          className={rowLook}
        >
          {face}
          {badges}
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
        <DriverFace employeeId={occupant.employeeId} person={person} hoverCard={false} />
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
  // The free drivers first; then everyone a standing crew already holds — on a car of this board
  // (a seat being filled: a tap MOVES him) or on a car off it (another branch, or out of service).
  const free = options.free.filter((option) => !option.heldElsewhere);
  const others = [...options.seated, ...options.free.filter((option) => option.heldElsewhere)];
  // The daily list's rule: a term that finds nobody free but finds somebody below says nothing —
  // «لا يوجد سائق مطابق للبحث» only when the term found nobody anywhere.
  const emptyLine =
    free.length > 0
      ? null
      : !hasDrivers || !searched
        ? POOL_EMPTY
        : others.length > 0
          ? null
          : t('fleet.fixedRoster.driverSearchEmpty');
  return (
    <div data-fixed-pool="true">
      {occupantRow}
      {emptyLine !== null ? (
        <p
          data-pool-empty={searched ? 'search' : 'pool'}
          className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
        >
          {emptyLine}
        </p>
      ) : (
        free.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">{free.map(row)}</ul>
        )
      )}
      {others.length > 0 && (
        <>
          <div
            data-seated-head="true"
            className="px-4 pb-1 pt-4 text-xs font-semibold text-slate-500 dark:text-slate-400"
          >
            {t('fleet.roster.onOtherVehicles')}{' '}
            <Count value={others.length} className="font-normal" />
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">{others.map(row)}</ul>
        </>
      )}
      <div className="h-3" />
    </div>
  );
};

// ── «تعديل» — the fixed dialog (FixedRosterPage.tsx:110-322) in the daily dialog's look ────────

/**
 * `EmployeeName` puts its 8px before the code with `ms-2` on a `dir="ltr"` span, so in Arabic the
 * gap lands on the code's far side and the name and the code touch («سامر عادل منصور3104») — the
 * merged daily dialog shows it too (build hand-off). Here the gap is put back between them.
 */
const NAME_CODE_GAP = '[&_[dir=ltr]]:!ms-0 [&_[dir=ltr]]:!me-2';

/** What the list says about a driver: held by a car off the board — nothing else (owner Q1 ب). */
export type DriverFlags = (employeeId: string) => { held: boolean };

/**
 * One seat, drawn as the daily dialog's `DriverSlot` (RosterAssignDialog.tsx:26-112): picked → the
 * name row (name, code) with ✕; empty → «اختيار سائق», which opens the list. The fixed rules feed it
 * unchanged: the candidates are the free pool plus this car's own two, never the other seat's
 * person; a disabled seat (seat 2 before seat 1) shows the fixed hint under its button.
 */
const FixedDriverSlot = ({
  name,
  value,
  onChange,
  exclude,
  candidates,
  flags,
  disabled = false,
  hint,
}: {
  name: string;
  value: string | null;
  onChange: (id: string | null) => void;
  exclude: string | null;
  candidates: string[];
  flags: DriverFlags;
  disabled?: boolean;
  hint?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const [picking, setPicking] = useState(false);
  if (value !== null) {
    return (
      <div
        data-dialog-seat={name}
        data-seat-value="filled"
        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800"
      >
        <span className={cn('text-sm', NAME_CODE_GAP)}>
          <EmployeeName employeeId={value} />
        </span>
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
          aria-label={t('common.clear')}
          title={t('common.clear')}
          onClick={() => onChange(null)}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }
  const list = candidates.filter((id) => id !== exclude);
  if (!picking || disabled) {
    return (
      <div data-dialog-seat={name} data-seat-value="empty">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setPicking(true)}>
          {t('fleet.roster.pickDriver')}
        </Button>
        {hint !== undefined && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        )}
      </div>
    );
  }
  return (
    <div
      data-dialog-seat={name}
      data-seat-value="picking"
      className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800"
    >
      {list.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">{POOL_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {list.map((id) => {
            const flag = flags(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  data-dialog-option={id}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60"
                  onClick={() => {
                    onChange(id);
                    setPicking(false);
                  }}
                >
                  {/* An option button: no card inside it — the badges beside say the rest. */}
                  <span className={NAME_CODE_GAP}>
                    <EmployeeName employeeId={id} card={false} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {flag.held && <Badge tone="info">{t('fleet.roster.otherVehicle')}</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const EditCrewDialog = ({
  row,
  pool,
  missionTypes,
  flags,
  onClose,
  onSave,
}: {
  row: FleetFixedCrewRowDto;
  pool: { employeeId: string }[];
  missionTypes: ReturnType<typeof useFleetCatalog>;
  flags: DriverFlags;
  onClose: () => void;
  onSave: (edit: EditValues) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [missionTypeId, setMissionTypeId] = useState<string | null>(row.missionTypeId);
  const [driver1, setDriver1] = useState<string | null>(row.driver1EmployeeId);
  const [driver2, setDriver2] = useState<string | null>(row.driver2EmployeeId);
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const candidates = useMemo(() => {
    const ids = pool.map((d) => d.employeeId);
    for (const own of [row.driver1EmployeeId, row.driver2EmployeeId])
      if (own !== null && !ids.includes(own)) ids.push(own);
    return ids;
  }, [pool, row.driver1EmployeeId, row.driver2EmployeeId]);
  const sameTwice = driver1 !== null && driver1 === driver2;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={`${t('common.edit')} · ${row.code}`}
      description={t('fleet.fixedRoster.editHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={sameTwice}
            onClick={() =>
              onSave({
                missionTypeId,
                driver1EmployeeId: driver1,
                driver2EmployeeId: driver2,
                notes: notes.trim() === '' ? null : notes.trim(),
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.roster.fields.mission')}>
          {missionTypes.isError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {t('fleet.fixedRoster.missionTypesFailed')}
            </p>
          ) : (
            <Select
              value={missionTypeId ?? ''}
              disabled={missionTypes.isPending}
              onChange={(e) => setMissionTypeId(e.target.value || null)}
            >
              <option value="">{t('fleet.fixedRoster.noMissionType')}</option>
              {(missionTypes.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {localized(item.name, locale)}
                </option>
              ))}
            </Select>
          )}
          {!missionTypes.isPending &&
            !missionTypes.isError &&
            (missionTypes.data?.items.length ?? 0) === 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.fixedRoster.noMissionTypesYet')}
              </p>
            )}
        </Field>
        <Field label={t('fleet.odometer.fields.driver1')}>
          <FixedDriverSlot
            name="driver1"
            value={driver1}
            onChange={(id) => {
              // The fixed rule: seat 1 emptied while seat 2 is held → seat 2 moves up.
              if (id === null && driver2 !== null) {
                setDriver1(driver2);
                setDriver2(null);
                return;
              }
              setDriver1(id);
            }}
            exclude={driver2}
            candidates={candidates}
            flags={flags}
          />
        </Field>
        <Field label={t('fleet.odometer.fields.driver2')}>
          <FixedDriverSlot
            name="driver2"
            value={driver2}
            onChange={setDriver2}
            exclude={driver1}
            candidates={candidates}
            flags={flags}
            disabled={driver1 === null}
            hint={driver1 === null ? t('fleet.fixedRoster.needsFirstDriver') : undefined}
          />
        </Field>
        {sameTwice && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {t('fleet.fixedRoster.sameDriverTwice')}
          </p>
        )}
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
};

// ── the touch sheets with the fixed words (gap map FT18, C4) ────────────────────────────────────

const OptionRow = ({
  on,
  onClick,
  children,
  name,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  name?: string;
}): JSX.Element => (
  <button
    type="button"
    role="menuitemradio"
    aria-checked={on}
    data-option={name}
    onClick={onClick}
    className={cn(
      'flex min-h-14 w-full items-center gap-3 px-4 text-start text-[15px] transition-colors hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60',
      on ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200',
    )}
  >
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        on
          ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500'
          : 'border-slate-300 dark:border-slate-600',
      )}
    >
      {on && <CheckIcon className="h-4 w-4" />}
    </span>
    <span className="min-w-0 flex-1">{children}</span>
  </button>
);

/** The mission pill's sheet — «تعديل · 150» / «نوع المهمة», with the dialog's two catalog lines. */
export const FixedMissionSheet = ({
  row,
  missions,
  missionTypes,
  onPick,
  onClose,
}: {
  row: FleetFixedCrewRowDto | null;
  missions: readonly MissionOption[];
  missionTypes: ReturnType<typeof useFleetCatalog>;
  onPick: (id: string | null) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <BottomSheet
      name="mission"
      open={row !== null}
      onClose={onClose}
      title={`${t('common.edit')} · ${row?.code ?? ''}`}
      subtitle={t('fleet.roster.fields.mission')}
    >
      {missionTypes.isError ? (
        <p className="px-4 py-6 text-sm text-rose-600 dark:text-rose-400">
          {t('fleet.fixedRoster.missionTypesFailed')}
        </p>
      ) : (
        <div className="divide-y divide-slate-100 pb-2 dark:divide-slate-800/80" role="menu">
          <OptionRow on={row?.missionTypeId === null} onClick={() => onPick(null)} name="none">
            {t('fleet.fixedRoster.noMissionType')}
          </OptionRow>
          {missions.map((mission) => (
            <OptionRow
              key={mission.id}
              on={row?.missionTypeId === mission.id}
              onClick={() => onPick(mission.id)}
              name={mission.id}
            >
              <span
                className={cn(
                  'inline-flex h-7 items-center rounded-full px-3 text-[13px] font-semibold',
                  mission.tone,
                )}
              >
                {mission.label}
              </span>
            </OptionRow>
          ))}
          {!missionTypes.isPending && missions.length === 0 && (
            <p className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.fixedRoster.noMissionTypesYet')}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
};

/** «تعديل» on touch — the note, 500 letters at most, empty = no note (the dialog's rules). */
export const FixedNotesSheet = ({
  row,
  onSave,
  onClose,
}: {
  row: FleetFixedCrewRowDto | null;
  onSave: (notes: string) => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState('');
  useEffect(() => {
    if (row !== null) setText(row.notes ?? '');
  }, [row]);
  return (
    <BottomSheet
      name="notes"
      open={row !== null}
      onClose={onClose}
      title={`${t('common.edit')} · ${row?.code ?? ''}`}
      subtitle={t('fleet.attendance.fields.notes')}
      footer={
        <div className="flex items-center gap-2.5">
          <Button data-save-notes="true" onClick={() => onSave(text)} className="min-h-12 flex-1">
            {t('common.save')}
          </Button>
          <Button variant="secondary" onClick={onClose} className="min-h-12 shrink-0">
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="px-4 pb-4 pt-1">
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            data-notes-input="true"
            rows={4}
            maxLength={500}
            textScale="comfortable"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-28"
          />
        </Field>
      </div>
    </BottomSheet>
  );
};
