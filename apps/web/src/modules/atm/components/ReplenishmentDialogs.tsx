// Replenishment dialogs. The edit dialog carries the legacy edit form's three facts
// (atm_replenishment.ejs:1219-1283): schedule time, open time, leader — and states the cascade
// rule the legacy applied silently: changing the LEADER on a single row renames the leader on
// every open replenishment of the same area in the same shift (contad_app.js:854-868), and only
// when the open time is not being moved in the same submit. On a checked set, the change applies
// to the checked rows only (:870-889).
import { useEffect, useState, type FormEvent } from 'react';
import { type AtmReplenishmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useBulkUpdateAtmReplenishments, useUpdateAtmReplenishment } from '../api/atm-queries';

/** Instant → the value a `datetime-local` input edits (LOCAL wall clock, minute precision). */
export const toLocalInputValue = (iso: string): string => {
  const date = new Date(iso);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const ConfirmActionDialog = ({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600 dark:text-slate-300">{body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('atm.common.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
};

export const EditReplenishmentDialog = ({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: AtmReplenishmentDto[];
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const updateOne = useUpdateAtmReplenishment();
  const updateMany = useBulkUpdateAtmReplenishments();
  const single = rows.length === 1 ? (rows[0] as AtmReplenishmentDto) : null;

  const [scheduleTime, setScheduleTime] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [leaderName, setLeaderName] = useState('');

  useEffect(() => {
    if (!open) return;
    setScheduleTime(single?.scheduleTime ?? '');
    setOpenedAt(single === null ? '' : toLocalInputValue(single.openedAt));
    setLeaderName(single?.leaderName ?? '');
  }, [open, single]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      if (single !== null) {
        await updateOne.mutateAsync({
          id: single.id,
          body: {
            scheduleTime: scheduleTime === '' ? null : scheduleTime,
            ...(openedAt === '' ? {} : { openedAt: new Date(openedAt).toISOString() }),
            leaderName: leaderName === '' ? null : leaderName,
            version: single.version,
          },
        });
      } else {
        await updateMany.mutateAsync({
          ids: rows.map((row) => row.id),
          ...(scheduleTime === '' ? {} : { scheduleTime }),
          ...(openedAt === '' ? {} : { openedAt: new Date(openedAt) }),
          ...(leaderName === '' ? {} : { leaderName }),
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
          ? t('atm.replenishments.editTitle', { code: single.machineCode })
          : t('atm.replenishments.editManyTitle', { count: rows.length })
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label={t('atm.replenishments.scheduleTime')}>
          <Input value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
        </Field>
        <Field label={t('atm.common.openTime')}>
          <Input
            type="datetime-local"
            value={openedAt}
            onChange={(e) => setOpenedAt(e.target.value)}
          />
        </Field>
        <Field
          label={t('atm.common.leader')}
          hint={single !== null ? t('atm.replenishments.leaderCascadeHint') : undefined}
        >
          <Input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} />
        </Field>
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
