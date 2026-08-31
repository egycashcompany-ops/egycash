// The standing crew (الطاقم الثابت) — who normally crews each cash-transfer vehicle.
//
// NEW CAPABILITY, no legacy screen to port. Legacy's `/tashghela` rendered `t.leader || ""`
// (contad_app.js:2305-2311) and started empty every single morning, which is precisely why the
// whole crew had to be dragged again each day. This screen is the permanent answer, and the daily
// board is seeded from it.
//
// IT IS THE CREW BOARD MINUS THE DAY. Every interaction — three slots, stacked cards, what a drop
// does, who is left in the pool, which rows are worth saving — is the same code, imported from
// `lib/crew-board.ts`, which stores no date and never did. What this screen adds is the two things
// a permanent list needs and a day's plan does not: a vehicle can JOIN the cash-transfer fleet and
// a vehicle can LEAVE it.
//
// WHAT IS DELIBERATELY MISSING versus the daily board:
//   · No date picker — that absence IS the entity.
//   · No `notes` field — a note on a day's crew is about that day.
//   · No "already taken today" marking in the pool. `assignedVehicleId` is computed for ONE
//     operating day, and showing a day's fact on a dateless screen would tell an operator that a
//     free person is busy. The rule this screen DOES enforce, server-side, is its own: one person
//     holds one vehicle in the standing crew.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type OperationsCrewMemberDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Input, Select } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useOperationsCrewDirectory,
  useOperationsStandingCrew,
  useRemoveOperationsStandingCrew,
  useSetOperationsStandingCrew,
} from '../api/operations-queries';
import {
  CREW_SLOTS,
  SLOT_POSITIONS,
  assignCaptainWithCrew,
  assignToSlot,
  availablePool,
  changedRows,
  clearSlot,
  filterPool,
  removeFromBoard,
  setRowField,
  slotValue,
  type BoardRow,
  type CrewSlot,
  type RequirementFilter,
} from '../lib/crew-board';
import {
  mergeStandingRows,
  newStandingRow,
  toStandingPayloadRows,
  toStandingRows,
} from '../lib/standing-crew';
import { CREW_DRAG_TYPE, CrewMemberCard } from '../components/CrewMemberCard';
import { CrewRosterNotice } from '../components/CrewRosterNotice';
import { POOL_FILTERS } from './CrewBoardPage';

export const StandingCrewPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();

  const standing = useOperationsStandingCrew();
  // The pool is the Operations roster. Its `date` only decides `assignedVehicleId`, which this
  // screen deliberately ignores — so `null` (the server's today) is as good as any other answer.
  const directory = useOperationsCrewDirectory(null);
  const save = useSetOperationsStandingCrew();
  const remove = useRemoveOperationsStandingCrew();
  const canPlan = can('operationsCrew.plan');

  const serverRows = useMemo(() => toStandingRows(standing.data?.rows ?? []), [standing.data]);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<RequirementFilter[]>([]);
  const [adding, setAdding] = useState('');

  // The server's list is the truth about WHICH vehicles are in the fleet; the draft is the truth
  // about what the operator has been typing. Folding one into the other rather than replacing is
  // what stops a Remove — which refetches the list — from destroying every other unsaved edit.
  const reconciled = useRef<BoardRow[]>([]);
  useEffect(() => {
    setRows((prev) => mergeStandingRows(serverRows, prev, reconciled.current));
    reconciled.current = serverRows;
  }, [serverRows]);

  const members = directory.data?.members ?? [];
  const pool = useMemo(
    () => filterPool(availablePool(members, rows), active, search),
    [members, rows, active, search],
  );
  const memberOf = (employeeId: string | null): OperationsCrewMemberDto | undefined =>
    employeeId === null ? undefined : members.find((m) => m.employeeId === employeeId);

  // A vehicle added locally is not on the server yet, so it counts as changed on its own — that is
  // what makes an EMPTY new row saveable, which is exactly what "in the fleet, nobody on it yet"
  // has to mean here.
  const pending = changedRows(rows, serverRows);
  const dirty = pending.length > 0;

  const available = useMemo(() => {
    const local = new Set(rows.map((row) => row.vehicleId));
    return (standing.data?.available ?? []).filter((v) => !local.has(v.vehicleId));
  }, [standing.data, rows]);

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

  const addVehicle = (vehicleId: string): void => {
    const vehicle = available.find((v) => v.vehicleId === vehicleId);
    if (vehicle === undefined) return;
    setRows((prev) => [...prev, newStandingRow(vehicle)]);
    setAdding('');
  };

  const submit = async (): Promise<void> => {
    if (!dirty) return;
    try {
      await save.mutateAsync({ rows: toStandingPayloadRows(pending) });
      toast.success(t('operations.standingCrew.saved', { count: pending.length }));
    } catch {
      // The domain refuses one person on two vehicles; say so rather than swallowing it.
      toast.error(t('operations.standingCrew.saveFailed'));
    }
  };

  const removeVehicle = async (row: BoardRow): Promise<void> => {
    // A vehicle added locally and not yet saved has no row to delete — drop it from the draft.
    if (!serverRows.some((r) => r.vehicleId === row.vehicleId)) {
      setRows((prev) => prev.filter((r) => r.vehicleId !== row.vehicleId));
      return;
    }
    if (!window.confirm(t('operations.standingCrew.confirmRemove', { code: row.vehicleCode })))
      return;
    try {
      await remove.mutateAsync(row.vehicleId);
      toast.success(t('operations.standingCrew.removed', { code: row.vehicleCode }));
    } catch {
      toast.error(t('operations.standingCrew.removeFailed'));
    }
  };

  const toggleFilter = (flag: RequirementFilter): void =>
    setActive((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]));

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.standingCrew.title')}
        description={t('operations.standingCrew.subtitle')}
        actions={
          canPlan ? (
            <Button onClick={() => void submit()} disabled={!dirty || save.isPending}>
              {dirty
                ? t('operations.standingCrew.saveCount', { count: pending.length })
                : t('common.save')}
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          {canPlan && (
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                {t('operations.standingCrew.addVehicle')}
              </span>
              <Select value={adding} onChange={(e) => addVehicle(e.target.value)}>
                <option value="">{t('common.select')}</option>
                {available.map((vehicle) => (
                  <option key={vehicle.vehicleId} value={vehicle.vehicleId}>
                    {vehicle.vehicleCode}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {standing.data?.availableIsFiltered === false && (
            // Said out loud: an unfiltered picker looks exactly like a correctly filtered one, and
            // the operator would otherwise never learn why a scrapped van is on offer.
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('operations.standingCrew.unfiltered')}
            </p>
          )}
          {dirty && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('operations.standingCrew.unsaved', { count: pending.length })}
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        {/* ── The pool ────────────────────────────────────────────────────── */}
        <Card>
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold">{t('operations.crew.pool')}</h2>
            <CrewRosterNotice rosterIsDerived={directory.data?.rosterIsDerived} />
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

        {/* ── The cash-transfer vehicles ──────────────────────────────────── */}
        <div className="space-y-3">
          {standing.isLoading && <Spinner />}
          {standing.isError && (
            <ErrorState error={standing.error} onRetry={() => void standing.refetch()} />
          )}
          {!standing.isLoading && rows.length === 0 && (
            <Card>
              <CardBody>
                {/* Nobody has named a cash-transfer vehicle yet — the list is explicit, not derived. */}
                <EmptyState
                  title={t('operations.standingCrew.empty')}
                  description={t('operations.standingCrew.emptyHint')}
                />
              </CardBody>
            </Card>
          )}
          {rows.map((row) => (
            <Card key={row.vehicleId}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{row.vehicleCode}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-36"
                      placeholder={t('operations.crew.direction')}
                      value={row.direction ?? ''}
                      disabled={!canPlan}
                      onChange={(e) =>
                        setRows((prev) =>
                          setRowField(prev, row.vehicleId, 'direction', e.target.value),
                        )
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
                    {canPlan && (
                      <Button
                        size="sm"
                        variant="secondary"
                        // Named per vehicle: eight identical "Remove" buttons are unusable from a
                        // screen reader's elements list, where there is no surrounding card to say
                        // which vehicle each one belongs to.
                        aria-label={t('operations.standingCrew.removeVehicle', {
                          code: row.vehicleCode,
                        })}
                        disabled={remove.isPending}
                        onClick={() => void removeVehicle(row)}
                      >
                        {t('operations.standingCrew.remove')}
                      </Button>
                    )}
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
                        const occupantId = slotValue(row, slot, position);
                        const held = memberOf(occupantId);
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
                            {occupantId === null ? (
                              <p className="text-xs text-slate-400">
                                {t('operations.crew.dropHere')}
                              </p>
                            ) : held === undefined ? (
                              // SOMEBODY IS IN THIS SEAT and the directory cannot name them —
                              // they left the company since the standing crew was written. Drawing
                              // an empty seat was the worst of both: the operator saw a free slot,
                              // the payload still carried the id, and the save failed with a
                              // conflict about a person who was nowhere on the screen.
                              <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                <span>{t('operations.standingCrew.unknownMember')}</span>
                                {canPlan && (
                                  <button
                                    type="button"
                                    aria-label={t('operations.standingCrew.removeMember')}
                                    className="font-bold"
                                    onClick={() =>
                                      setRows((prev) =>
                                        clearSlot(prev, row.vehicleId, slot, position),
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
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
