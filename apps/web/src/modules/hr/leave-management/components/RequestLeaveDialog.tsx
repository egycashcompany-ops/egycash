// The request wizard (frozen design §11): type → dates (live day count + balance-after via the
// eligibility preflight) → reason → submit. Used self-service (employeeId = my own) and by HR
// on-behalf (employeeId prop). Soft violations show as warnings (they block self-service
// server-side; HR on-behalf overrides them — L8); hard violations disable submission.
import { useMemo, useState } from 'react';
import { type LeaveTypeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog, EmptyState } from '../../../../shared/ui';
import { Field, Input, Select, Textarea, Checkbox } from '../../../../shared/ui/form';
import { useLeaveEligibility, useLeaveTypes, useSubmitLeaveRequest } from '../api/leave-queries';

export const RequestLeaveDialog = ({
  open,
  onClose,
  employeeId,
  onBehalf = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The subject employee (the caller's own for self-service). */
  employeeId: string;
  onBehalf?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const { data: types } = useLeaveTypes();
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [halfDayStart, setHalfDayStart] = useState(false);
  const [halfDayEnd, setHalfDayEnd] = useState(false);
  const [reason, setReason] = useState('');
  const submit = useSubmitLeaveRequest();

  const activeTypes = useMemo(() => (types ?? []).filter((x) => x.active), [types]);
  const type: LeaveTypeDto | undefined = activeTypes.find((x) => x.id === typeId);
  const ready = typeId !== '' && start !== '' && end !== '' && start <= end;

  const { data: eligibility } = useLeaveEligibility(
    employeeId,
    { typeId, start, end, halfDayStart, halfDayEnd },
    open && ready,
  );
  const hard = (eligibility?.violations ?? []).filter((v) => v.severity === 'hard');
  const soft = (eligibility?.violations ?? []).filter((v) => v.severity === 'soft');
  const blocked = !ready || hard.length > 0 || (!onBehalf && soft.length > 0);

  const doSubmit = (): void => {
    if (blocked || submit.isPending) return;
    submit.mutate(
      {
        ...(onBehalf ? { employeeId } : {}),
        typeId,
        startDate: new Date(start),
        endDate: new Date(end),
        halfDayStart,
        halfDayEnd,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      },
      { onSuccess: onClose },
    );
  };

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} title={t('leave.request.title')} size="lg">
      <div className="space-y-4">
        <Field label={t('leave.request.type')}>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('leave.request.selectType')}</option>
            {activeTypes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name.ar} ({x.code})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('leave.request.startDate')}>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('leave.request.endDate')}>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {type?.allowHalfDay === true && (
          <div className="flex gap-6">
            <Checkbox
              checked={halfDayStart}
              onChange={(e) => setHalfDayStart(e.target.checked)}
              label={t('leave.request.halfDayStart')}
            />
            <Checkbox
              checked={halfDayEnd}
              onChange={(e) => setHalfDayEnd(e.target.checked)}
              label={t('leave.request.halfDayEnd')}
            />
          </div>
        )}
        <Field label={t('leave.request.reason')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {ready && eligibility !== undefined && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <div className="flex flex-wrap gap-4">
              <span>
                {t('leave.request.days')}: <strong>{eligibility.days}</strong>
              </span>
              {eligibility.available !== null && (
                <>
                  <span>
                    {t('leave.request.available')}: <strong>{eligibility.available}</strong>
                  </span>
                  <span>
                    {t('leave.request.balanceAfter')}:{' '}
                    <strong className={eligibility.balanceAfter !== null && eligibility.balanceAfter < 0 ? 'text-red-600' : ''}>
                      {eligibility.balanceAfter}
                    </strong>
                  </span>
                </>
              )}
            </div>
            {hard.length > 0 && (
              <ul className="mt-2 list-disc ps-5 text-red-600">
                {hard.map((v) => (
                  <li key={v.rule}>{t(`leave.rule.${v.rule}`)}{v.detail === null ? '' : ` — ${v.detail}`}</li>
                ))}
              </ul>
            )}
            {soft.length > 0 && (
              <ul className="mt-2 list-disc ps-5 text-amber-600">
                {soft.map((v) => (
                  <li key={v.rule}>
                    {t(`leave.rule.${v.rule}`)}
                    {v.detail === null ? '' : ` — ${v.detail}`}
                    {onBehalf ? ` (${t('leave.request.softOverride')})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {activeTypes.length === 0 && <EmptyState title={t('leave.request.noTypes')} />}
        {submit.isError && (
          <p className="text-sm text-red-600">{(submit.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={doSubmit} disabled={blocked} loading={submit.isPending}>
            {t('leave.request.submit')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
