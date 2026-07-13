// Mark an assigned interviewer as skipped/absent so a decision is no longer blocked on them.
// Matches SkipInterviewer (reason optional, version-checked). Only a pending member can be skipped
// (a submitted evaluation cannot — server-enforced).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { UserName } from './UserName';
import { useSkipInterviewer } from '../api/interview-queries';

export const SkipInterviewerDialog = ({
  onClose,
  interviewId,
  interviewerId,
  version,
}: {
  onClose: () => void;
  interviewId: string;
  interviewerId: string;
  version: number;
}): JSX.Element => {
  const t = useT();
  const skip = useSkipInterviewer(interviewId);
  const [reason, setReason] = useState('');

  const submit = async (): Promise<void> => {
    try {
      await skip.mutateAsync({ interviewerId, version, ...(reason.trim() === '' ? {} : { reason: reason.trim() }) });
      toast.success(t('interviews.panel.skipped'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('interviews.panel.skipTitle')}
      description={t('interviews.panel.skipBody')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={skip.isPending} onClick={() => void submit()}>
            {t('interviews.panel.skip')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <UserName id={interviewerId} className="font-medium" />
        </p>
        <Field label={t('interviews.panel.skipReason')} hint={t('interviews.panel.skipReasonHint')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
};
