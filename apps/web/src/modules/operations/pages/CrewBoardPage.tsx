// The daily crew board (B3) — the replacement for the legacy `/tashghela` screen.
//
// WHAT THE LEGACY SCREEN WAS (discovery §8, contad_app.js:2234-2430): a drag-and-drop board of the
// day's vehicles, each with a captain and two specialist slots, fed by a pool of operations staff.
// It defaulted to TOMORROW — crews are planned a day ahead — and it enforced its one rule
// (a member holds one vehicle per day) in browser JavaScript, while the POST blind-upserted
// whatever it was sent. A direct API call could double-book anyone.
//
// WHAT CHANGED AND WHAT DID NOT:
//   · Tomorrow is still the default, resolved server-side.
//   · The one-vehicle rule (Q11) is now a DOMAIN invariant, end-state-checked. The board still
//     prevents the mistake, but it is no longer the thing standing between the plan and the data.
//   · A drop MOVES a member who is already crewed, rather than refusing as legacy did — that
//     produces the valid end state the server demands. All of it lives in `lib/crew-board.ts` as
//     pure transitions, tested there.
//   · Requirement icons are indicators and filters. They gate NOTHING (approved decision).
//   · Each slot now holds up to CREW_SLOT_CAPACITY people, drawn as that many cards stacked in the
//     cell — a crew of six. Legacy drew exactly one card per cell (tashghela.ejs:914-916), so this
//     raises a ceiling rather than replacing a behaviour: at one occupant the board looks and
//     behaves as it did.
//   · The vehicle list comes from the Fleet duty roster for the date, which is the normalized form
//     of the legacy `car_lock` gate — Operations never re-models the roster.
//   · THE STANDING CREW IS LOADED BY A TOGGLE (الطاقم الثابت), off by default. It fills the DRAFT,
//     never the server, so it is reviewable before saving and reversible after — and it only ever
//     touches vehicles that are EMPTY, so it cannot overwrite a crew somebody placed by hand or
//     refill a slot emptied on purpose this morning. A vehicle Fleet did not roster today is not
//     on this board at all, so its standing crew stays in the pool and the screen says so.
//
// The board is edited locally and saved explicitly, exactly like the legacy one: a drag is not a
// write. Only CHANGED rows are sent.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type Locale, type OperationsCrewMemberDto } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { localized } from '../../../shared/lib/format';
import { useFleetCatalog } from '../../fleet/api/fleet-queries';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input, Switch } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useOperationsStandingCrew,
  usePlanOperationsCrew,
} from '../api/operations-queries';
import { clearStandingCrew, loadStandingCrew } from '../lib/standing-load';
import {
  CREW_SLOTS,
  SLOT_POSITIONS,
  assignCaptainWithCrew,
  assignToSlot,
  changedRows,
  clearSlot,
  removeFromBoard,
  setRowField,
  slotValue,
  toBoardRows,
  toPlanRows,
  type BoardRow,
  type CrewSlot,
  type PoolKind,
} from '../lib/crew-board';
import { CREW_DRAG_TYPE, CrewMemberCard } from '../components/CrewMemberCard';
import { CrewPools, EMPTY_POOL_QUERIES, type PoolQuery } from '../components/CrewPools';

/** `?date=` empty means TOMORROW, resolved by the server — the legacy planning default. */
export const resolveCrewDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

export const CrewBoardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const date = resolveCrewDate(sp.get('date'));

  const board = useOperationsCrewBoard(date);
  const directory = useOperationsCrewDirectory(date);
  const standing = useOperationsStandingCrew();
  const plan = usePlanOperationsCrew();
  const canPlan = can('operationsCrew.plan');

  // The mission NAME, from the same `missionType` catalog `fleet/roster` writes the id from —
  // the same cached hook, so N cards still cost one request, and no second vocabulary.
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string): string | null => {
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? null : localized(item.name, locale);
  };

  const serverRows = useMemo(() => toBoardRows(board.data?.rows ?? []), [board.data]);
  const [rows, setRows] = useState<BoardRow[]>([]);
  // Each pool narrows on its own — a search typed into the captains column says nothing about
  // which specialist the planner is looking for.
  const [queries, setQueries] = useState<Record<PoolKind, PoolQuery>>(EMPTY_POOL_QUERIES);

  // The server's board is the truth; local edits start from it and are discarded on a reload.
  useEffect(() => setRows(serverRows), [serverRows]);

  const members = directory.data?.members ?? [];
  const memberOf = (employeeId: string | null): OperationsCrewMemberDto | undefined =>
    employeeId === null ? undefined : members.find((m) => m.employeeId === employeeId);

  const pending = changedRows(rows, serverRows);
  const dirty = pending.length > 0;

  // Each CARD is its own drop target, not each slot: with two cards per slot, "which of the two
  // does this drop replace" is a question only the operator can answer, and aiming at a card is
  // how they answer it.
  const drop =
    (vehicleId: string, slot: CrewSlot, position: number) =>
    (event: React.DragEvent): void => {
      event.preventDefault();
      const employeeId = event.dataTransfer.getData(CREW_DRAG_TYPE);
      if (employeeId === '' || !canPlan) return;
      // A captain moving between vehicles takes the specialists sharing his card position with
      // him: a crew is what was decided, not three independent seats.
      setRows((prev) =>
        slot === 'captain'
          ? assignCaptainWithCrew(prev, vehicleId, position, employeeId)
          : assignToSlot(prev, vehicleId, slot, position, employeeId),
      );
    };

  const save = async (): Promise<void> => {
    if (!dirty) return;
    try {
      await plan.mutateAsync({
        // The contract types dates post-coercion; JSON.stringify serialises a Date to ISO, which
        // is what the server coerces back.
        date: new Date(date ?? (board.data?.date ?? '').slice(0, 10)),
        rows: toPlanRows(pending),
      });
      toast.success(t('operations.crew.saved', { count: pending.length }));
    } catch {
      // The domain refuses a plan that would double-book; say so rather than swallowing it.
      toast.error(t('operations.crew.saveFailed'));
    }
  };

  const boardDay = (board.data?.date ?? '').slice(0, 10);

  // ── The toggle: تحميل الطاقم الثابت على التشغيلة ──────────────────────────────────────────────
  //
  // OFF BY DEFAULT, and off again on every date change: the board opens showing what was actually
  // planned, and the standing crew arrives only because somebody asked for it. It edits the DRAFT,
  // so it is reviewable before saving and reversible after — a control that wrote to the server
  // could not be switched back off.
  const [standingOn, setStandingOn] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  useEffect(() => {
    setStandingOn(false);
    setFilled([]);
  }, [boardDay]);

  const standingSources = useMemo(
    () =>
      (standing.data?.rows ?? []).map((row) => ({
        vehicleId: row.vehicleId,
        captainEmployeeIds: row.captainEmployeeIds,
        specialist1EmployeeIds: row.specialist1EmployeeIds,
        specialist2EmployeeIds: row.specialist2EmployeeIds,
      })),
    [standing.data],
  );

  const toggleStanding = (on: boolean): void => {
    if (!on) {
      setRows((prev) => clearStandingCrew(prev, filled));
      setFilled([]);
      setStandingOn(false);
      return;
    }
    const load = loadStandingCrew(rows, standingSources);
    setRows(load.rows);
    setFilled(load.filledVehicleIds);
    setStandingOn(true);
    if (load.unavailableVehicleIds.length > 0) {
      // Said out loud, not swallowed: those crews are still in the pool, and the planner needs to
      // know they were not placed rather than assume the board is complete.
      toast.error(
        t('operations.crew.standing.unavailable', { count: load.unavailableVehicleIds.length }),
      );
    }
  };


  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.title')}
        actions={
          canPlan ? (
            <Button onClick={() => void save()} disabled={!dirty || plan.isPending}>
              {dirty ? t('operations.crew.saveCount', { count: pending.length }) : t('common.save')}
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t('operations.crew.date')}</span>
            <Input
              type="date"
              value={date ?? boardDay}
              onChange={(e) => {
                const next = new URLSearchParams(sp);
                if (e.target.value === '') next.delete('date');
                else next.set('date', e.target.value);
                setSp(next);
              }}
            />
          </label>
          {canPlan && (
            <Switch
              checked={standingOn}
              disabled={standingSources.length === 0}
              onChange={(e) => toggleStanding(e.target.checked)}
              label={t('operations.crew.standing.toggle')}
              description={
                standingSources.length === 0
                  ? t('operations.crew.standing.none')
                  : t('operations.crew.standing.hint')
              }
            />
          )}
          {dirty && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('operations.crew.unsaved', { count: pending.length })}
            </p>
          )}
        </CardBody>
      </Card>

      {/* The vehicles at the START and the pools at the END — in Arabic, the board on the right
          and the names on the left, as the legacy screen had them. Logical, not physical: in
          English the same layout mirrors, which is what a reader of that language expects.

          The pools come FIRST in the markup so that below `lg`, where everything stacks, a
          planner meets the names before twenty vehicles rather than after them; the grid
          placement is what moves them to the end on a wide screen. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_32rem]">
        <CrewPools
          className="lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:h-[calc(100dvh-7rem)] lg:self-start"
          members={members}
          rows={rows}
          queries={queries}
          onQueryChange={(kind, next) => setQueries((prev) => ({ ...prev, [kind]: next }))}
          loading={directory.isLoading}
          error={directory.isError ? directory.error : null}
          onRetry={() => void directory.refetch()}
          rosterIsDerived={directory.data?.rosterIsDerived}
          canPlan={canPlan}
          onReturn={(employeeId) => setRows((prev) => removeFromBoard(prev, employeeId))}
        />

        {/* ── The vehicles ────────────────────────────────────────────────── */}
        <div className="space-y-3 lg:col-start-1 lg:row-start-1">
          {board.isLoading && <Spinner />}
          {board.isError && (
            <ErrorState error={board.error} onRetry={() => void board.refetch()} />
          )}
          {!board.isLoading && rows.length === 0 && (
            <Card>
              <CardBody>
                {/* No vehicles on the Fleet roster for the day — the normalized car_lock gate. */}
                <EmptyState
                  title={t('operations.crew.noVehicles')}
                  description={t('operations.crew.noVehiclesHint')}
                />
              </CardBody>
            </Card>
          )}
          {rows.map((row) => (
            <Card key={row.vehicleId}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                    {row.vehicleCode}
                    {/* التشغيله, as Fleet planned it. Read-only here — this board crews the day,
                        it does not decide what the day is for. Shown because a captain being
                        assigned to a car needs to know what that car is doing, and because the
                        value was arriving in the response and then being dropped. */}
                    {row.missionTypeId !== null && (
                      <Badge tone="info" size="sm">
                        {missionName(row.missionTypeId)}
                      </Badge>
                    )}
                  </h3>
                  {/* الاتجاه and التوقيت on ONE line, as the legacy row had them. The boxes are sized by
                      a wrapper, not by a class on the Input: the Input carries `w-full`, `cn` does
                      not resolve Tailwind conflicts, and `.w-full` is emitted after `.w-36` — so a
                      width given to the Input itself silently lost, every box took the whole row,
                      and the two wrapped one under the other.
                      THE DIRECTION BOX GIVES WAY, the time box does not: a fixed-width row spilled
                      out of the card on a 1024–1190px screen and slid under the pinned pools, where
                      the time could not be clicked. From `sm` up the row never wraps and the direction
                      shrinks — which takes `min-w-0` on the ROW as well as on the box: a flex row's
                      minimum width is otherwise its contents' (224 + 144px), so the box's own
                      permission to shrink never came into play. On a phone the direction keeps 7rem
                      and anything that no longer fits — the standing crew's إزالة — moves to the next
                      line instead of crushing it. */}
                  <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                    <div className="min-w-[7rem] flex-1 sm:w-56 sm:min-w-0 sm:flex-initial">
                      <Input
                        aria-label={t('operations.crew.direction')}
                        placeholder={t('operations.crew.direction')}
                        value={row.direction ?? ''}
                        disabled={!canPlan}
                        onChange={(e) =>
                          setRows((prev) => setRowField(prev, row.vehicleId, 'direction', e.target.value))
                        }
                      />
                    </div>
                    <div className="w-36 shrink-0">
                      <Input
                        type="time"
                        aria-label={t('operations.crew.plannedTime')}
                        value={row.plannedTime ?? ''}
                        disabled={!canPlan}
                        onChange={(e) =>
                          setRows((prev) =>
                            setRowField(prev, row.vehicleId, 'plannedTime', e.target.value),
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Three slots across; inside each, the cards stack vertically. */}
                <div className="grid gap-2 sm:grid-cols-3">
                  {CREW_SLOTS.map((slot) => (
                    <div key={slot} className="space-y-1" data-slot={slot}>
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {t(`operations.crew.slot.${slot}`)}
                      </div>
                      {SLOT_POSITIONS.map((position) => {
                        const held = memberOf(slotValue(row, slot, position));
                        return (
                          <div
                            key={position}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={drop(row.vehicleId, slot, position)}
                            className="min-h-[3.25rem] rounded-lg border-2 border-dashed border-slate-200 p-2 dark:border-slate-700"
                            data-slot={slot}
                            data-slot-position={position}
                            data-vehicle-id={row.vehicleId}
                          >
                            {held === undefined ? (
                              <p className="text-xs text-slate-400">
                                {t('operations.crew.dropHere')}
                              </p>
                            ) : (
                              <CrewMemberCard
                                member={held}
                                draggable={canPlan}
                                onRemove={
                                  canPlan
                                    ? () =>
                                        setRows((prev) =>
                                          clearSlot(prev, row.vehicleId, slot, position),
                                        )
                                    : undefined
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  );
};
