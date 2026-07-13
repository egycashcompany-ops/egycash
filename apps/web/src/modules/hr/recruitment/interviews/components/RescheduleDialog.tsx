// Reschedule a scheduled interview — changes only the date/time (the round stays `scheduled`).
// Matches RescheduleInterview (scheduledAt required, reason optional, version-checked).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useRescheduleInterview } from '../api/interview-queries';

/** ISO → the local-time value a `datetime-local` input expects (YYYY-MM-DDTHH:mm). */
const toLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const RescheduleDialog = ({
  open,
  onClose,
  interviewId,
  currentScheduledAt,
  version,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  currentScheduledAt: string;
  version: number;
}): JSX.Element => {
  const t = useT();
  const reschedule = useRescheduleInterview(interviewId);
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(currentScheduledAt));
  const [reason, setReason] = useState('');

  const submit = async (): Promise<void> => {
    if (scheduledAt === '') return;
    try {
      await reschedule.mutateAsync({
        scheduledAt: new Date(scheduledAt),
        version,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      toast.success(t('interviews.reschedule.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('interviews.reschedule.title')}
      description={t('interviews.reschedule.body')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={reschedule.isPending} disabled={scheduledAt === ''} onClick={() => void submit()}>
            {t('interviews.reschedule.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('interviews.schedule.when')} required>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('interviews.reschedule.reason')} hint={t('interviews.reschedule.reasonHint')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
};
