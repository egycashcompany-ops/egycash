// Maintenance dialogs — the two the legacy page owns beyond replenishment's:
//
//   · CLOSE (atm_maintenance.ejs:1151-1230): closing REQUIRES assigning an employee from the ATM
//     department list — the modal's required datalist. Single row or the checked set, one submit.
//     The list is `/atm/leaders/options` (the ATM department by name, or the departments ticked on
//     /atm/settings); the box is searchable and shows each person with their HR code.
//   · EDIT (:1561-1650): service type, notes, open time, leader — a changed leader cascades over
//     the row's area+shift unconditionally (contad_app.js:2019-2032), stated in the hint — unless
//     the «الوردية» box beside it is unticked (2026-10-27): then the row, or the checked rows, only.
//     Ticked on a checked set, it goes over each checked row's area and shift too.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { type AtmLeaderOptionDto, type AtmMaintenanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Combobox } from '../../../shared/ui/Combobox';
import { Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAtmLeaderOptions,
  useBulkUpdateAtmMaintenances,
  useCloseAtmMaintenances,
  useUpdateAtmMaintenance,
} from '../api/atm-queries';
import { LeaderField, toLocalInputValue } from './ReplenishmentDialogs';

/** Pure: the one leader every row shares — blank when they differ, or none has one. */
export const sharedLeader = (rows: readonly { leaderName: string | null }[]): string => {
  const names = new Set(rows.map((row) => row.leaderName ?? ''));
  return names.size === 1 ? ([...names][0] ?? '') : '';
};

/** Pure: how the close picker shows one person — «name (code)», as the HR pickers do. */
export const leaderOptionLabel = (option: AtmLeaderOptionDto): string =>
  `${option.name} (${option.code})`;

export const CloseMaintenanceDialog = ({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: AtmMaintenanceDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const close = useCloseAtmMaintenances();
  const options = useAtmLeaderOptions(open);
  const pickerId = useId();
  const [leaderEmployeeId, setLeaderEmployeeId] = useState('');
  const people = options.data ?? [];
  // The box offers the LABELS, so a search reads what the reader sees («name (code)») and never
  // the employee id behind it; a picked label maps back to its id.
  const labels = people.map(leaderOptionLabel);
  const idOfLabel = new Map(people.map((option, index) => [labels[index], option.employeeId]));
  const labelOfId = new Map(people.map((option, index) => [option.employeeId, labels[index]]));

  useEffect(() => {
    if (open) setLeaderEmployeeId('');
  }, [open]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (leaderEmployeeId === '') return;
    try {
      await close.mutateAsync({ ids: rows.map((row) => row.id), leaderEmployeeId });
      toast.success(t('atm.maintenance.closed'));
      onClose();
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.maintenance.closeTitle')}
      // The employee list opens inside the body; a short body would cut it (`Dialog`, `tall`).
      tall
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('atm.maintenance.closeBody', { count: rows.length })}
        </p>
        <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
          {rows.map((row) => (
            <li key={row.id} className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              {row.machineCode} — {row.machineName}
            </li>
          ))}
        </ul>
        <Field
          label={t('atm.maintenance.assignEmployee')}
          htmlFor={pickerId}
          required
          error={options.isError ? t('atm.common.leadersLoadFailed') : undefined}
          warning={
            options.isSuccess && people.length === 0
              ? t('atm.maintenance.noEmployeesHint')
              : undefined
          }
        >
          <Combobox
            id={pickerId}
            value={labelOfId.get(leaderEmployeeId) ?? ''}
            options={labels}
            onChange={(label) => setLeaderEmployeeId(idOfLabel.get(label) ?? '')}
            placeholder={t('atm.maintenance.pickEmployee')}
            emptyText={t(options.isLoading ? 'common.loading' : 'common.noResults')}
            clearLabel={t('common.clear')}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button type="submit" loading={close.isPending} disabled={leaderEmployeeId === ''}>
            {t('atm.common.close')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export const EditMaintenanceDialog = ({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: AtmMaintenanceDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const updateOne = useUpdateAtmMaintenance();
  const updateMany = useBulkUpdateAtmMaintenances();
  const single = rows.length === 1 ? (rows[0] as AtmMaintenanceDto) : null;

  const [serviceType, setServiceType] = useState('');
  const [notes, setNotes] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [shiftWide, setShiftWide] = useState(true);
  // What the leader box opened on: the row's leader, or — on a checked set — the one leader every
  // checked row shares (blank when they differ). On a checked set only a CHANGE from it is saved,
  // so «حفظ» on an untouched box writes nothing, and a clear is the × pressed, never a blank left.
  const initialLeader = single !== null ? (single.leaderName ?? '') : sharedLeader(rows);

  useEffect(() => {
    if (!open) return;
    setServiceType(single?.serviceType ?? '');
    setNotes(single?.notes ?? '');
    setOpenedAt(single === null ? '' : toLocalInputValue(single.openedAt));
    setLeaderName(initialLeader);
    setShiftWide(true);
  }, [open, single, initialLeader]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      if (single !== null) {
        // The open time moves onto any day — one the machine is already in maintenance on
        // included: several open maintenances of a machine are allowed (port doc OD-1c).
        await updateOne.mutateAsync({
          id: single.id,
          body: {
            serviceType: serviceType === '' ? null : serviceType,
            notes: notes === '' ? null : notes,
            ...(openedAt === '' ? {} : { openedAt: new Date(openedAt).toISOString() }),
            leaderName: leaderName === '' ? null : leaderName,
            cascadeLeader: shiftWide,
            version: single.version,
          },
        });
      } else {
        // The legacy checked-set maintenance edit writes the leader and nothing else
        // (contad_app.js:2042-2050; its schedule write never landed — port doc T6).
        // A cleared box (the ×) clears the CHECKED rows' leader, as an empty field always did —
        // it never goes over their shifts, whatever the box says. Save waits for a change.
        if (leaderName === initialLeader) return;
        await updateMany.mutateAsync({
          ids: rows.map((row) => row.id),
          ...(leaderName === '' ? { leaderName: null } : { leaderName, cascadeLeader: shiftWide }),
        });
      }
      toast.success(t('atm.common.saved'));
      onClose();
    } catch {
      toast.error(t('atm.common.actionFailed'));
    }
  };

  const busy = updateOne.isPending || updateMany.isPending;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        single !== null
          ? t('atm.maintenance.editTitle', { code: single.machineCode })
          : t('atm.maintenance.editManyTitle', { count: rows.length })
      }
      // The leader's list opens inside the body; a short body would cut it (`Dialog`, `tall`).
      tall
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {single !== null && (
          <>
            <Field label={t('atm.maintenance.serviceType')}>
              <Input value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
            </Field>
            <Field label={t('atm.maintenance.notes')}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>
            <Field label={t('atm.common.openTime')}>
              <Input
                type="datetime-local"
                value={openedAt}
                onChange={(e) => setOpenedAt(e.target.value)}
              />
            </Field>
          </>
        )}
        <LeaderField
          value={leaderName}
          onChange={setLeaderName}
          shiftWide={shiftWide}
          onShiftWideChange={setShiftWide}
          many={single === null}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button
            type="submit"
            loading={busy}
            // A checked set has nothing to save but its leader: wait for it to change.
            disabled={single === null && leaderName === initialLeader}
          >
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
