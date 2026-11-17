// A manager deciding one employee-day (stage 3).
//
// WHAT THIS DIALOG IS CAREFUL ABOUT. It is the one place in Attendance where somebody states a
// fact instead of reading one, so it says plainly what each choice does and makes the reason
// unavoidable. The reason is mandatory on the server too — this is not politeness, it is the only
// thing that will explain the decision to a reviewer months later, and the only protection for the
// manager who made it.
//
// It deliberately does NOT promise that the decision takes effect: past the branch's threshold the
// server records it for HR instead, and the note below says so before anything is sent, rather
// than surprising the manager with a status they did not expect.
import { useState } from 'react';
import { type AttendanceSheetRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import { useCreateAttendanceDecision } from '../api/attendance-queries';

type DecisionType = 'markPresent' | 'markAbsent' | 'editTimes';

/** `datetime-local` wants the Cairo wall clock, which is the only clock this module speaks (R10). */
const cairoLocal = (date: string, time: string): string => `${date}T${time}`;

/**
 * The Cairo wall-clock string back to an instant. Cairo is UTC+2 in winter and UTC+3 under DST,
 * and which one applies depends on the DATE being decided rather than on today — so the offset is
 * read from the date itself instead of assumed.
 */
const toInstant = (local: string): Date => {
  const [datePart, timePart] = local.split('T');
  if (datePart === undefined || timePart === undefined) return new Date(NaN);
  const [y, m, d] = datePart.split('-').map(Number) as [number, number, number];
  const [hh, mm] = timePart.split(':').map(Number) as [number, number];
  // Probe the offset at midday on that date, which is never inside a DST transition.
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const asCairo = new Date(
    probe.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }) + ' UTC',
  ).getTime();
  const offsetMinutes = Math.round((asCairo - probe.getTime()) / 60_000);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetMinutes * 60_000);
};

export const DayDecisionDialog = ({
  row,
  onClose,
}: {
  row: AttendanceSheetRowDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const create = useCreateAttendanceDecision();
  const [type, setType] = useState<DecisionType>('markPresent');
  const [inTime, setInTime] = useState('09:00');
  const [outTime, setOutTime] = useState('17:00');
  const [reason, setReason] = useState('');

  const needsIn = type !== 'markAbsent';
  const needsOut = type === 'editTimes';
  const invalid =
    reason.trim().length < 3 || (needsIn && inTime === '') || (needsOut && outTime === '');

  const submit = (): void => {
    if (invalid) return;
    create.mutate(
      {
        employeeId: row.employeeId,
        // 'YYYY-MM-DD' parses to UTC midnight, which IS the date-only convention everything in HR
        // uses — the work date is a calendar day, never an instant.
        workDate: new Date(row.date),
        type,
        ...(needsIn ? { inAt: toInstant(cairoLocal(row.date, inTime)) } : {}),
        ...(needsOut ? { outAt: toInstant(cairoLocal(row.date, outTime)) } : {}),
        reason: reason.trim(),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('attendance.decision.title')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={invalid}>
            {t('attendance.decision.submit')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {row.employeeName}{' '}
          <span className="font-mono text-xs text-slate-500" dir="ltr">
            {row.employeeCode}
          </span>{' '}
          — <span dir="ltr">{row.date}</span>
        </p>

        <Field label={t('attendance.decision.type')}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as DecisionType)}
            aria-label={t('attendance.decision.type')}
          >
            <option value="markPresent">{t('attendance.decision.markPresent')}</option>
            <option value="markAbsent">{t('attendance.decision.markAbsent')}</option>
            <option value="editTimes">{t('attendance.decision.editTimes')}</option>
          </Select>
        </Field>

        {needsIn && (
          <Field label={t('attendance.decision.inAt')}>
            <Input
              type="time"
              value={inTime}
              onChange={(e) => setInTime(e.target.value)}
              aria-label={t('attendance.decision.inAt')}
              dir="ltr"
            />
          </Field>
        )}
        {needsOut && (
          <Field label={t('attendance.decision.outAt')}>
            <Input
              type="time"
              value={outTime}
              onChange={(e) => setOutTime(e.target.value)}
              aria-label={t('attendance.decision.outAt')}
              dir="ltr"
            />
          </Field>
        )}

        {/* Said BEFORE the manager commits, not after: on this payroll an arrival with no
            departure is the ordinary working day, and the dialog should not imply it is lacking. */}
        {type === 'markPresent' && (
          <p className="text-xs text-slate-500">{t('attendance.decision.arrivalOnlyHint')}</p>
        )}
        {/* The evidence is kept, and the manager should know that before overriding it. */}
        {type === 'markAbsent' && row.day !== null && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('attendance.decision.overrideHint')}
          </p>
        )}

        <Field label={t('attendance.decision.reason')}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            aria-label={t('attendance.decision.reason')}
            placeholder={t('attendance.decision.reasonPlaceholder')}
          />
        </Field>
        <p className="text-xs text-slate-500">{t('attendance.decision.oldDayHint')}</p>

        {create.isError && (
          <p role="alert" className="text-sm text-red-600">
            {(create.error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};
