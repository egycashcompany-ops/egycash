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
//   · THE STANDING CREW DESCENDS ONTO THIS BOARD (الطاقم الثابت). Once per date, when nobody has
//     planned it yet, and by a permanent button any other time. The seed is an ABSOLUTE
//     ROW-EXISTENCE VETO — a vehicle that already has a crew row is never touched — because
//     `plan()` has no delete path, so a slot emptied on purpose is byte-identical to one never
//     filled, and a field-level merge would put a captain who called in sick back every morning.
//
// The board is edited locally and saved explicitly, exactly like the legacy one: a drag is not a
// write. Only CHANGED rows are sent.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useOperationsStandingCrew,
  usePlanOperationsCrew,
  useSeedCrewFromStanding,
} from '../api/operations-queries';
import { seedSummary, shouldAutoSeed } from '../lib/crew-seed';
import {
  CREW_SLOTS,
  SLOT_POSITIONS,
  assignToSlot,
  availablePool,
  changedRows,
  clearSlot,
  filterPool,
  removeFromBoard,
  setRowField,
  slotValue,
  toBoardRows,
  toPlanRows,
  type BoardRow,
  type CrewSlot,
  type RequirementFilter,
} from '../lib/crew-board';
import { CREW_DRAG_TYPE, CrewMemberCard } from '../components/CrewMemberCard';

/** `?date=` empty means TOMORROW, resolved by the server — the legacy planning default. */
export const resolveCrewDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

export const POOL_FILTERS: RequirementFilter[] = [
  'isCaptain',
  'hasWeapon',
  'hasSignature',
  'hasLicense',
];

export const CrewBoardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const date = resolveCrewDate(sp.get('date'));

  const board = useOperationsCrewBoard(date);
  const directory = useOperationsCrewDirectory(date);
  const standing = useOperationsStandingCrew();
  const plan = usePlanOperationsCrew();
  const seed = useSeedCrewFromStanding();
  const canPlan = can('operationsCrew.plan');

  const serverRows = useMemo(() => toBoardRows(board.data?.rows ?? []), [board.data]);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<RequirementFilter[]>([]);

  // The server's board is the truth; local edits start from it and are discarded on a reload.
  useEffect(() => setRows(serverRows), [serverRows]);

  const members = directory.data?.members ?? [];
  const pool = useMemo(
    () => filterPool(availablePool(members, rows), active, search),
    [members, rows, active, search],
  );
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
      setRows((prev) => assignToSlot(prev, vehicleId, slot, position, employeeId));
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

  const toggleFilter = (flag: RequirementFilter): void =>
    setActive((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]));

  const boardDay = (board.data?.date ?? '').slice(0, 10);

  // ── The descent: الطاقم الثابت ينزل في التشغيلة ────────────────────────────────────────────────
  const runSeed = async (announceQuiet: boolean): Promise<void> => {
    if (boardDay === '') return;
    try {
      const result = await seed.mutateAsync({ date: new Date(boardDay) });
      const summary = seedSummary(result.seed);
      if (summary.quiet) {
        // Nothing happened and nothing was declined. Saying so on every visit would train the
        // operator to dismiss the message that matters, so only an explicit press gets an answer.
        if (announceQuiet) toast.success(t('operations.crew.seed.nothing'));
        return;
      }
      toast.success(t('operations.crew.seed.done', { count: summary.seeded }));
      // The omissions are a SEPARATE message, because a half-planned day that only says "seeded 4"
      // reads as a finished one.
      if (summary.notRostered + summary.noCrew + summary.dropped > 0) {
        toast.error(
          t('operations.crew.seed.skipped', {
            notRostered: summary.notRostered,
            noCrew: summary.noCrew,
            dropped: summary.dropped,
          }),
        );
      }
    } catch {
      if (announceQuiet) toast.error(t('operations.crew.seed.failed'));
    }
  };

  // ONE ATTEMPT PER DATE, whatever the outcome. A ref rather than state: remembering an attempt
  // must not itself cause a render, or the effect would race its own re-run.
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    const shouldFire = shouldAutoSeed({
      canPlan,
      boardDay: board.data?.day ?? null,
      standingRowCount: standing.data?.rows.length ?? 0,
      attempted: attempted.current,
      date: boardDay,
      busy: board.isLoading || standing.isLoading || seed.isPending,
    });
    if (!shouldFire) return;
    // Recorded BEFORE the call, not after: the effect re-runs the moment the seed invalidates the
    // board query, and a flag set on completion would let a second attempt start first.
    attempted.current.add(boardDay);
    void runSeed(false);
    // `runSeed` is deliberately not a dependency — it is rebuilt every render and closes over the
    // same query state this list already tracks, so including it would re-run the effect forever.
  }, [canPlan, board.data, board.isLoading, standing.data, standing.isLoading, boardDay]);

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.title')}
        description={t('operations.crew.subtitle')}
        actions={
          canPlan ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Permanent, not only automatic: the auto-fire happens once per date, and an
                  operator who has just edited the standing crew needs a way to ask again. */}
              <Button
                variant="secondary"
                onClick={() => void runSeed(true)}
                disabled={seed.isPending || (standing.data?.rows.length ?? 0) === 0}
              >
                {t('operations.crew.seed.action')}
              </Button>
              <Button onClick={() => void save()} disabled={!dirty || plan.isPending}>
                {dirty
                  ? t('operations.crew.saveCount', { count: pending.length })
                  : t('common.save')}
              </Button>
            </div>
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
          {dirty && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('operations.crew.unsaved', { count: pending.length })}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        {/* ── The pool ────────────────────────────────────────────────────── */}
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold">{t('operations.crew.pool')}</h2>
            <Input
              placeholder={t('operations.crew.searchPool')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {POOL_FILTERS.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  aria-pressed={active.includes(flag)}
                  onClick={() => toggleFilter(flag)}
                  className={
                    active.includes(flag)
                      ? 'rounded-full border border-brand-500 bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400'
                  }
                >
                  {t(`operations.crew.flag.${flag}`)}
                </button>
              ))}
            </div>

            {directory.isLoading && <Spinner />}
            {directory.isError && (
              <ErrorState error={directory.error} onRetry={() => void directory.refetch()} />
            )}
            {!directory.isLoading && pool.length === 0 && (
              <p className="text-sm text-slate-500">{t('operations.crew.poolEmpty')}</p>
            )}
            <div
              className="space-y-2"
              // Dropping back onto the pool clears the member from wherever they were.
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const employeeId = e.dataTransfer.getData(CREW_DRAG_TYPE);
                if (employeeId === '' || !canPlan) return;
                setRows((prev) => removeFromBoard(prev, employeeId));
              }}
            >
              {pool.map((member) => (
                <CrewMemberCard key={member.employeeId} member={member} draggable={canPlan} />
              ))}
            </div>
          </CardBody>
        </Card>

        {/* ── The vehicles ────────────────────────────────────────────────── */}
        <div className="space-y-3">
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
                  <h3 className="font-semibold">{row.vehicleCode}</h3>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="w-36"
                      placeholder={t('operations.crew.direction')}
                      value={row.direction ?? ''}
                      disabled={!canPlan}
                      onChange={(e) =>
                        setRows((prev) => setRowField(prev, row.vehicleId, 'direction', e.target.value))
                      }
                    />
                    <Input
                      className="w-28"
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
