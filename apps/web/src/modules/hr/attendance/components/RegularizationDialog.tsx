// Filing a regularization (§7). The employee proposes the day's PUNCH TRUTH — an in and an out —
// and never a derived number: on final approval the proposal becomes manual punches and the day
// is recomputed (ADR-027). Two steps follow, manager then HR; nothing here can skip either.
import { useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Textarea } from '../../../../shared/ui/form';
import { useCreateRegularization } from '../api/attendance-queries';

/** `workDate` is `YYYY-MM-DD`; the two instants default to that day's ordinary span. */
export const RegularizationDialog = ({
  workDate,
  employeeId,
  onClose,
}: {
  workDate: string;
  /** Set only for the HR direct edit (D7) — omitted, the request is filed for the caller. */
  employeeId?: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateRegularization();
  const [inAt, setInAt] = useState(`${workDate}T09:00`);
  const [outAt, setOutAt] = useState(`${workDate}T17:00`);
  const [reason, setReason] = useState('');

  const invalid = reason.trim().length < 3 || inAt === '' || outAt === '' || outAt <= inAt;

  const submit = (): void => {
    if (invalid) return;
    create.mutate(
      {
        // Dates go over the wire as ISO strings; the schema coerces them (the Leave idiom).
        workDate: new Date(workDate),
        proposedInAt: new Date(inAt),
        proposedOutAt: new Date(outAt),
        reason: reason.trim(),
        ...(employeeId === undefined ? {} : { employeeId }),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={employeeId === undefined ? t('attendance.reg.title') : t('attendance.reg.directTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={invalid}>
            {t('attendance.reg.submit')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {employeeId !== undefined && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('attendance.reg.directHint')}
          </p>
        )}
        <Field label={t('attendance.reg.in')}>
          <Input
            type="datetime-local"
            value={inAt}
            onChange={(e) => setInAt(e.target.value)}
            aria-label={t('attendance.reg.in')}
          />
        </Field>
        <Field label={t('attendance.reg.out')}>
          <Input
            type="datetime-local"
            value={outAt}
            onChange={(e) => setOutAt(e.target.value)}
            aria-label={t('attendance.reg.out')}
          />
        </Field>
        <Field label={t('attendance.reg.reason')}>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t('attendance.reg.reason')}
          />
        </Field>
        {create.isError && (
          <p role="alert" className="text-sm text-red-600">
            {(create.error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};
