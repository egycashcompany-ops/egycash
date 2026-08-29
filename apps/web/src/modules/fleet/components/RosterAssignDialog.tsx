// Assign/edit one vehicle's row of the daily roster (§4.5). The dialog edits the COMPLETE
// desired state of (vehicle, date) and hands it back — it does NOT save. The day is a DRAFT
// now: «حفظ» on the page commits every change at once, so a dialog that wrote straight to the
// server would be a second way to persist and would make «إلغاء» on the page a lie.
//
// Driver choices come from the board's own pool (the availability seam's verdicts), never from
// a directory search: what the server says is assignable is all the UI offers. Picking a driver
// who already holds another vehicle for the date releases that vehicle — but the arithmetic for
// that lives in `applyEdit` on the daily board module, which is the same code a drag goes
// through. It used to be a second copy here, free to drift from the board's.
import { useEffect, useState } from 'react';
import { type FleetRosterDayDto, type FleetRosterRowDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Field, Textarea } from '../../../shared/ui/form';
import { CloseIcon } from '../../../shared/ui/icons';
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
  onSave,
  row,
  board,
}: {
  open: boolean;
  onClose: () => void;
  /** Hands the four edited facts to the page's draft. Nothing is persisted here. */
  onSave: (edit: {
    missionTypeId: string | null;
    driver1EmployeeId: string | null;
    driver2EmployeeId: string | null;
    notes: string | null;
  }) => void;
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

  const submit = (): void => {
    if (row === null) return;
    onSave({
      missionTypeId: missionTypeId === '' ? null : missionTypeId,
      driver1EmployeeId: driver1 === '' ? null : driver1,
      driver2EmployeeId: driver2 === '' ? null : driver2,
      // '' is not a note. The contract refuses an empty string and `null` is how this module
      // spells "nothing" everywhere else.
      notes: notes.trim() === '' ? null : notes.trim(),
    });
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
          <Button onClick={submit}>
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
