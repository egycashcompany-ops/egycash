// The fixed crew (الطقم الثابت) — who a car's standing crew IS, dragged into place.
//
// A sibling of the daily roster board (§4.5) and deliberately not a copy of it. The roster
// answers "who was planned on this car on day D", so it has a date picker, an availability
// verdict per driver and an unassignable-in-workshop rule — all facts ABOUT A DAY. This screen
// has no day: it answers "who is this car's crew", which stays true until somebody changes it.
// So there is no date anywhere, and the pool has no unavailable half — the same active driver
// profiles the roster draws from, undivided, because "free next Tuesday" is not a question here.
//
// The interaction is a real drag, not buttons that mimic one: HTML5 dragstart/dragover/drop, no
// library. What a drop MEANS lives in `lib/fixed-roster-board` as pure functions, so the two
// rules the server enforces — one person cannot hold both slots of a car, one driver belongs to
// one crew — are the same rules the UI proposes, and they are testable without a DOM.
//
// Saving is explicit. A drag edits a DRAFT; the banner and the button read the difference
// between draft and saved board, and only «حفظ» writes. A reload before saving therefore keeps
// the saved crews, exactly as an unsaved form does everywhere else in the app.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetFixedCrewRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardHeader } from '../../../shared/ui/Card';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { TrashIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useFixedRoster, useSaveFixedRoster } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { InWorkshopBadge } from '../components/VehicleStatusBadge';
import {
  CREW_SLOTS,
  assignDriver,
  changedRows,
  clearSlot,
  findSeat,
  type CrewSlot,
} from '../lib/fixed-roster-board';

/** The one thing a drag carries. Read on drop; nothing else is inferred from the event. */
const DRAG_TYPE = 'application/x-ecms-driver';

const SLOT_LABEL: Record<CrewSlot, string> = {
  driver1EmployeeId: 'fleet.odometer.fields.driver1',
  driver2EmployeeId: 'fleet.odometer.fields.driver2',
};

export const FixedRosterPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const mayPlan = can('fleetRoster.plan');

  const search = sp.get('q') ?? '';
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const boardQuery = useFixedRoster();
  const save = useSaveFixedRoster();
  const saved = useMemo(() => boardQuery.data?.rows ?? [], [boardQuery.data]);

  // The draft the drags edit, derived from the saved board DURING render rather than by an
  // effect. The difference is not stylistic: an effect runs after the first paint, so the board
  // would flash empty on arrival — and never runs at all under `renderToStaticMarkup`, which is
  // how this screen is tested. Holding the base the draft was taken from lets the draft reset
  // itself the moment the server answers with a different board, and stay put in between, so a
  // background refetch of the same board cannot undo a drag.
  const [edit, setEdit] = useState<{ base: FleetFixedCrewRowDto[]; rows: FleetFixedCrewRowDto[] }>({
    base: [],
    rows: [],
  });
  const draft = edit.base === saved ? edit.rows : saved;
  const setDraft = (next: (rows: FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[]): void =>
    setEdit({ base: saved, rows: next(draft) });
  const discard = (): void => setEdit({ base: saved, rows: saved });

  const pending = useMemo(() => changedRows(saved, draft), [saved, draft]);
  const dirty = pending.length > 0;

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const term = search.trim().toLowerCase();
  const rows = draft.filter(
    (row) =>
      term === '' ||
      row.code.toLowerCase().includes(term) ||
      row.plateNumber.toLowerCase().includes(term),
  );

  // Where every driver sits in the DRAFT, so the pool reflects the drag before it is saved.
  const seatOf = (employeeId: string) => findSeat(draft, employeeId);
  const codeOf = (vehicleId: string): string =>
    draft.find((row) => row.vehicleId === vehicleId)?.code ?? t('fleet.roster.otherVehicle');

  const drop = (vehicleId: string, slot: CrewSlot, employeeId: string): void => {
    setDraft((current) => assignDriver(current, vehicleId, slot, employeeId));
    setOver(null);
    setDragging(null);
  };

  const commit = async (): Promise<void> => {
    if (!dirty) return;
    await save.mutateAsync({ rows: pending });
    toast.success(t('fleet.fixedRoster.saved'));
  };

  const zoneKey = (vehicleId: string, slot: CrewSlot): string => `${vehicleId}:${slot}`;

  /** One slot: a labelled drop target that either holds a card or asks for one. */
  const Slot = ({ row, slot }: { row: FleetFixedCrewRowDto; slot: CrewSlot }): JSX.Element => {
    const employeeId = row[slot];
    const key = zoneKey(row.vehicleId, slot);
    const active = over === key;
    return (
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          {t(SLOT_LABEL[slot])}
        </p>
        <div
          data-drop-zone={key}
          aria-label={`${row.code} · ${t(SLOT_LABEL[slot])}`}
          onDragOver={(e) => {
            if (!mayPlan) return;
            // Preventing the default IS what makes an element a drop target.
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(key);
          }}
          onDragLeave={() => setOver((k) => (k === key ? null : k))}
          onDrop={(e) => {
            if (!mayPlan) return;
            e.preventDefault();
            const id = e.dataTransfer.getData(DRAG_TYPE);
            if (id !== '') drop(row.vehicleId, slot, id);
          }}
          className={[
            'flex min-h-[3.25rem] items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition-colors',
            active
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
              : employeeId === null
                ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60',
          ].join(' ')}
        >
          {employeeId === null ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {t('fleet.fixedRoster.dropHere')}
            </span>
          ) : (
            <>
              <span
                draggable={mayPlan}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, employeeId);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(employeeId);
                }}
                onDragEnd={() => setDragging(null)}
                className={[
                  'min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100',
                  mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
                  dragging === employeeId ? 'opacity-50' : '',
                ].join(' ')}
              >
                <EmployeeName employeeId={employeeId} />
              </span>
              {mayPlan && (
                <button
                  type="button"
                  aria-label={t('fleet.fixedRoster.removeDriver')}
                  title={t('fleet.fixedRoster.removeDriver')}
                  onClick={() => setDraft((c) => clearSlot(c, row.vehicleId, slot))}
                  className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.fixedRoster')}
        description={t('fleet.fixedRoster.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fixedRoster') },
        ]}
        actions={
          mayPlan ? (
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {t('fleet.fixedRoster.unsaved')}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={discard}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!dirty}
                loading={save.isPending}
                onClick={() => void commit()}
              >
                {t('common.save')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <FilterBar hasActiveFilters={search !== ''} onClear={() => patch({ q: null })}>
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('fleet.roster.searchPlaceholder')}
              className="w-56"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {t('fleet.fixedRoster.summary', {
                total: formatNumber(draft.length, locale),
                crewed: formatNumber(
                  draft.filter((r) => r.driver1EmployeeId !== null || r.driver2EmployeeId !== null)
                    .length,
                  locale,
                ),
              })}
            </span>
          </FilterBar>

          {boardQuery.isError ? (
            <ErrorState error={boardQuery.error} onRetry={() => void boardQuery.refetch()} />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState title={t('fleet.fixedRoster.noVehicles')} />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {rows.map((row) => (
                <Card key={row.vehicleId}>
                  <CardHeader
                    title={row.code}
                    description={row.plateNumber}
                    actions={<InWorkshopBadge inWorkshop={row.inMaintenance} />}
                  />
                  <div className="space-y-3 px-5 py-4">
                    {CREW_SLOTS.map((slot) => (
                      <Slot key={slot} row={row} slot={slot} />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`${t('fleet.fixedRoster.driversTitle')} · ${formatNumber(boardQuery.data?.drivers.length ?? 0, locale)}`}
              description={t('fleet.fixedRoster.driversHint')}
            />
            {boardQuery.data === undefined || boardQuery.data.drivers.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : (
              <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {boardQuery.data.drivers.map((driver) => {
                  const seat = seatOf(driver.employeeId);
                  return (
                    <li key={driver.employeeId}>
                      <div
                        data-driver-card={driver.employeeId}
                        draggable={mayPlan}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, driver.employeeId);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging(driver.employeeId);
                        }}
                        onDragEnd={() => setDragging(null)}
                        className={[
                          'flex items-center justify-between gap-2 px-5 py-2.5 text-sm',
                          mayPlan
                            ? 'cursor-grab active:cursor-grabbing hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            : '',
                          dragging === driver.employeeId ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        <span className="min-w-0 truncate">
                          <EmployeeName employeeId={driver.employeeId} />
                        </span>
                        {seat === null ? (
                          <Badge tone="neutral">{t('fleet.fixedRoster.unassigned')}</Badge>
                        ) : (
                          <Badge tone="info">{codeOf(seat.vehicleId)}</Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
