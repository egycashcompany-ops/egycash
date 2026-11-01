// Maintenance dialogs — the two the legacy page owns beyond replenishment's:
//
//   · CLOSE (atm_maintenance.ejs:1151-1230): closing REQUIRES assigning an employee from the ATM
//     department list — the modal's required datalist. Single row or the checked set, one submit.
//   · EDIT (:1561-1650): service type, notes, open time, leader — a changed leader cascades over
//     the row's area+shift unconditionally (contad_app.js:2019-2032), stated in the hint — unless
//     the «الوردية» box beside it is unticked (2026-10-27): then the row, or the checked rows, only.
//     Ticked on a checked set, it goes over each checked row's area and shift too.
import { useEffect, useState, type FormEvent } from 'react';
import { type AtmMaintenanceDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input, Select, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAtmMaintenanceLeaderOptions,
  useBulkUpdateAtmMaintenances,
  useCloseAtmMaintenances,
  useUpdateAtmMaintenance,
} from '../api/atm-queries';
import { LeaderField, toLocalInputValue } from './ReplenishmentDialogs';
import { isAlreadyOpenRefusal } from '../lib/operation-view';

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
  const options = useAtmMaintenanceLeaderOptions(open);
  const [leaderEmployeeId, setLeaderEmployeeId] = useState('');

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
    <Dialog open={open} onClose={onClose} title={t('atm.maintenance.closeTitle')}>
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
          required
          hint={
            (options.data ?? []).length === 0 && !options.isLoading
              ? t('atm.maintenance.noEmployeesHint')
              : undefined
          }
        >
          <Select
            value={leaderEmployeeId}
            onChange={(e) => setLeaderEmployeeId(e.target.value)}
            required
          >
            <option value="" disabled>
              {t('atm.maintenance.pickEmployee')}
            </option>
            {(options.data ?? []).map((option) => (
              <option key={option.employeeId} value={option.employeeId}>
                {option.name}
              </option>
            ))}
          </Select>
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

  useEffect(() => {
    if (!open) return;
    setServiceType(single?.serviceType ?? '');
    setNotes(single?.notes ?? '');
    setOpenedAt(single === null ? '' : toLocalInputValue(single.openedAt));
    setLeaderName(single?.leaderName ?? '');
    setShiftWide(true);
  }, [open, single]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      if (single !== null) {
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
        // An empty field clears the CHECKED rows' leader, as it always did — it never goes over
        // their shifts, whatever the box says.
        await updateMany.mutateAsync({
          ids: rows.map((row) => row.id),
          ...(leaderName === '' ? { leaderName: null } : { leaderName, cascadeLeader: shiftWide }),
        });
      }
      toast.success(t('atm.common.saved'));
      onClose();
    } catch (error) {
      // The per-day rule (port doc OD-1): moving the open time onto a day the machine is already
      // open on is refused — say so, rather than a bare «failed».
      toast.error(
        t(isAlreadyOpenRefusal(error) ? 'atm.common.moveAlreadyOpen' : 'atm.common.actionFailed'),
      );
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
          <Button type="submit" loading={busy}>
            {t('atm.common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
