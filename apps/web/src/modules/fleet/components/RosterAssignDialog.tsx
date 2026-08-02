// Assign/edit one vehicle's row of the daily roster (§4.5). The dialog edits the COMPLETE
// desired state of (vehicle, date) — exactly the shape the plan API upserts. Driver choices
// come from the board's own pool (the availability seam's verdicts), never from a directory
// search: what the server says is assignable is all the UI offers. Picking a driver who
// already holds another vehicle's assignment composes that vehicle's releasing row into the
// SAME save — both sides of the move in one transaction, the drag semantics FL-5 was built
// for (FR-7); the server remains the authority and refuses anything the board missed.
import { useEffect, useState } from 'react';
import {
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type PlanFleetRosterRow,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Field, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CloseIcon } from '../../../shared/ui/icons';
import { usePlanRoster } from '../api/fleet-queries';
import { CatalogSelect } from './CatalogSelect';
import { EmployeeName } from './EmployeeName';

const vehicleCode = (board: FleetRosterDayDto, vehicleId: string): string | null =>
  board.rows.find((row) => row.vehicleId === vehicleId)?.code ?? null;

/** One driver slot: picked → resolved name + clear; empty → the day's available pool. */
const DriverSlot = ({
  board,
  currentVehicleId,
  value,
  onChange,
  exclude,
}: {
  board: FleetRosterDayDto;
  currentVehicleId: string;
  value: string;
  onChange: (employeeId: string) => void;
  /** The other slot's pick — one person cannot hold both seats (FR-7). */
  exclude: string;
}): JSX.Element => {
  const t = useT();
  const [picking, setPicking] = useState(false);

  if (value !== '') {
    const from = board.availableDrivers.find((d) => d.employeeId === value)?.assignedVehicleId;
    const transferFrom = from != null && from !== currentVehicleId ? from : null;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="text-sm">
            <EmployeeName employeeId={value} />
          </span>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800"
            aria-label={t('common.clear')}
            title={t('common.clear')}
            onClick={() => onChange('')}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {transferFrom !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('fleet.roster.transferHint', {
              code: vehicleCode(board, transferFrom) ?? t('fleet.roster.otherVehicle'),
            })}
          </p>
        )}
      </div>
    );
  }

  const pool = board.availableDrivers.filter((d) => d.employeeId !== exclude);
  if (!picking) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
        {t('fleet.roster.pickDriver')}
      </Button>
    );
  }
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
      {pool.length === 0 ? (
        <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.roster.availableEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {pool.map((driver) => (
            <li key={driver.employeeId}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/60 dark:focus-visible:bg-slate-800/60"
                onClick={() => {
                  onChange(driver.employeeId);
                  setPicking(false);
                }}
              >
                <EmployeeName employeeId={driver.employeeId} />
                {driver.assignedVehicleId === null ? (
                  <Badge tone="success">{t('fleet.roster.free')}</Badge>
                ) : (
                  <Badge tone="info">
                    {vehicleCode(board, driver.assignedVehicleId) ?? t('fleet.roster.otherVehicle')}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const RosterAssignDialog = ({
  open,
  onClose,
  date,
  row,
  board,
}: {
  open: boolean;
  onClose: () => void;
  /** The board's day as the yyyy-mm-dd URL value — also the day cache key. */
  date: string;
  row: FleetRosterRowDto | null;
  board: FleetRosterDayDto;
}): JSX.Element => {
  const t = useT();
  const [missionTypeId, setMissionTypeId] = useState('');
  const [driver1, setDriver1] = useState('');
  const [driver2, setDriver2] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open && row !== null) {
      setMissionTypeId(row.missionTypeId ?? '');
      setDriver1(row.driver1EmployeeId ?? '');
      setDriver2(row.driver2EmployeeId ?? '');
      setNotes(row.notes ?? '');
    }
  }, [open, row]);

  const plan = usePlanRoster();

  const submit = async (): Promise<void> => {
    if (row === null) return;
    // One row per touched vehicle: releasing rows first (a picked driver held elsewhere is
    // stripped from that vehicle's CURRENT state), then this vehicle's full desired state.
    const rows = new Map<string, PlanFleetRosterRow>();
    for (const picked of [driver1, driver2]) {
      if (picked === '') continue;
      const from = board.availableDrivers.find((d) => d.employeeId === picked)?.assignedVehicleId;
      if (from == null || from === row.vehicleId) continue;
      const source =
        rows.get(from) ??
        ((): PlanFleetRosterRow | undefined => {
          const current = board.rows.find((r) => r.vehicleId === from);
          if (current === undefined) return undefined; // outside the scoped board — the server will answer
          return {
            vehicleId: current.vehicleId,
            missionTypeId: current.missionTypeId,
            driver1EmployeeId: current.driver1EmployeeId,
            driver2EmployeeId: current.driver2EmployeeId,
            notes: current.notes,
          };
        })();
      if (source === undefined) continue;
      if (source.driver1EmployeeId === picked) source.driver1EmployeeId = null;
      if (source.driver2EmployeeId === picked) source.driver2EmployeeId = null;
      rows.set(from, source);
    }
    rows.set(row.vehicleId, {
      vehicleId: row.vehicleId,
      missionTypeId: missionTypeId === '' ? null : missionTypeId,
      driver1EmployeeId: driver1 === '' ? null : driver1,
      driver2EmployeeId: driver2 === '' ? null : driver2,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    await plan.mutateAsync({
      dateKey: date,
      body: { date: new Date(date), rows: [...rows.values()] },
    });
    toast.success(t('fleet.roster.saved'));
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.roster.assignTitle', { code: row?.code ?? '' })}
      description={t('fleet.roster.assignHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={plan.isPending} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.roster.fields.mission')}>
          <CatalogSelect
            kind="missionType"
            value={missionTypeId}
            onChange={setMissionTypeId}
            ariaLabel={t('fleet.roster.fields.mission')}
          />
        </Field>
        <Field label={t('fleet.odometer.fields.driver1')}>
          <DriverSlot
            board={board}
            currentVehicleId={row?.vehicleId ?? ''}
            value={driver1}
            onChange={setDriver1}
            exclude={driver2}
          />
        </Field>
        <Field label={t('fleet.odometer.fields.driver2')}>
          <DriverSlot
            board={board}
            currentVehicleId={row?.vehicleId ?? ''}
            value={driver2}
            onChange={setDriver2}
            exclude={driver1}
          />
        </Field>
        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
};
