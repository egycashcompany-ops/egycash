// Overtime approval (D5) — a QUANTITY release, never a valuation. The dialog offers a number of
// minutes bounded by what the engine derived; the server holds the same ceiling and refuses a
// frozen day outright. There is no rate, no multiplier and no total anywhere in this component,
// because Attendance does not know what a minute costs (§1).
import { useState } from 'react';
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Button } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../shared/ui/form';
import { useApproveOvertime } from '../api/attendance-queries';
import { formatMinutes } from './minutes';

export const OvertimeApprovalDialog = ({
  day,
  onClose,
}: {
  day: AttendanceDayDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const approve = useApproveOvertime();
  const [minutes, setMinutes] = useState(String(day.approvedOvertimeMinutes));

  const parsed = Number(minutes);
  const invalid = Number.isNaN(parsed) || parsed < 0 || parsed > day.overtimeMinutes;

  const submit = (): void => {
    if (invalid) return;
    approve.mutate(
      { id: day.id, body: { approvedMinutes: parsed, version: day.version } },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('attendance.overtime.title')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={approve.isPending} disabled={invalid}>
            {t('attendance.overtime.approve')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('attendance.overtime.derived', {
            minutes: formatMinutes(day.overtimeMinutes, locale),
          })}
        </p>
        <Field label={t('attendance.overtime.minutes')}>
          <Input
            type="number"
            min={0}
            max={day.overtimeMinutes}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label={t('attendance.overtime.minutes')}
          />
        </Field>
        {invalid && (
          <p role="alert" className="text-sm text-red-600">
            {t('attendance.overtime.ceiling')}
          </p>
        )}
        {approve.isError && (
          <p role="alert" className="text-sm text-red-600">
            {(approve.error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};
