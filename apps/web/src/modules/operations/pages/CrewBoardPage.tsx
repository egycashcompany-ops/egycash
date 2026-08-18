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
//   · The vehicle list comes from the Fleet duty roster for the date, which is the normalized form
//     of the legacy `car_lock` gate — Operations never re-models the roster.
//
// The board is edited locally and saved explicitly, exactly like the legacy one: a drag is not a
// write. Only CHANGED rows are sent.
import { useEffect, useMemo, useState } from 'react';
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
  usePlanOperationsCrew,
} from '../api/operations-queries';
import {
  CREW_SLOTS,
  assignToSlot,
  availablePool,
  changedRows,
  clearSlot,
  filterPool,
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
  const plan = usePlanOperationsCrew();
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

  const drop = (vehicleId: string, slot: CrewSlot) => (event: React.DragEvent): void => {
    event.preventDefault();
    const employeeId = event.dataTransfer.getData(CREW_DRAG_TYPE);
    if (employeeId === '' || !canPlan) return;
    setRows((prev) => assignToSlot(prev, vehicleId, slot, employeeId));
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

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.crew.title')}
        description={t('operations.crew.subtitle')}
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
                setRows((prev) =>
                  prev.map((row) => {
                    const next = { ...row };
                    for (const slot of CREW_SLOTS) {
                      if (slotValue(next, slot) === employeeId) {
                        next[
                          slot === 'captain'
                            ? 'captainEmployeeId'
                            : slot === 'specialist1'
                              ? 'specialist1EmployeeId'
                              : 'specialist2EmployeeId'
                        ] = null;
                      }
                    }
                    return next;
                  }),
                );
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

                <div className="grid gap-2 sm:grid-cols-3">
                  {CREW_SLOTS.map((slot) => {
                    const held = memberOf(slotValue(row, slot));
                    return (
                      <div
                        key={slot}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={drop(row.vehicleId, slot)}
                        className="min-h-[4.5rem] rounded-lg border-2 border-dashed border-slate-200 p-2 dark:border-slate-700"
                        data-slot={slot}
                        data-vehicle-id={row.vehicleId}
                      >
                        <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                          {t(`operations.crew.slot.${slot}`)}
                        </div>
                        {held === undefined ? (
                          <p className="text-xs text-slate-400">{t('operations.crew.dropHere')}</p>
                        ) : (
                          <CrewMemberCard
                            member={held}
                            draggable={canPlan}
                            onRemove={
                              canPlan
                                ? () => setRows((prev) => clearSlot(prev, row.vehicleId, slot))
                                : undefined
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  );
};
