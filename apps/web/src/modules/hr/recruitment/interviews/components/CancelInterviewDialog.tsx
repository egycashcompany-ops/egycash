// Cancel a scheduled interview. Matches CancelInterview (reason required, version-checked).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useCancelInterview } from '../api/interview-queries';

export const CancelInterviewDialog = ({
  open,
  onClose,
  interviewId,
  version,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  version: number;
}): JSX.Element => {
  const t = useT();
  const cancel = useCancelInterview(interviewId);
  const [reason, setReason] = useState('');

  const close = (): void => {
    onClose();
    setReason('');
  };

  const submit = async (): Promise<void> => {
    if (reason.trim() === '') return;
    try {
      await cancel.mutateAsync({ reason: reason.trim(), version });
      toast.success(t('interviews.cancel.done'));
      close();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('interviews.cancel.title')}
      description={t('interviews.cancel.body')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={cancel.isPending} disabled={reason.trim() === ''} onClick={() => void submit()}>
            {t('interviews.cancel.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('interviews.cancel.reason')} required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
      </Field>
    </Dialog>
  );
};
