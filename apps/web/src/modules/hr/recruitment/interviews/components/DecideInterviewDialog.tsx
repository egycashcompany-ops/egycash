// Close a scheduled interview with a pass/fail decision (notes optional). The server blocks a
// decision while any panel member is still `pending`; the caller disables the entry point in that
// case and this dialog also surfaces the rule. Matches DecideInterview; version-checked.
import { useState } from 'react';
import { type InterviewDecision } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useDecideInterview } from '../api/interview-queries';

export const DecideInterviewDialog = ({
  open,
  onClose,
  interviewId,
  outcome,
  version,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  outcome: InterviewDecision;
  version: number;
}): JSX.Element => {
  const t = useT();
  const decide = useDecideInterview(interviewId);
  const [notes, setNotes] = useState('');
  const isFail = outcome === 'failed';

  const close = (): void => {
    onClose();
    setNotes('');
  };

  const submit = async (): Promise<void> => {
    try {
      await decide.mutateAsync({ outcome, version, ...(notes.trim() === '' ? {} : { notes: notes.trim() }) });
      toast.success(isFail ? t('interviews.decide.failedDone') : t('interviews.decide.passedDone'));
      close();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={isFail ? t('interviews.decide.failTitle') : t('interviews.decide.passTitle')}
      description={isFail ? t('interviews.decide.failBody') : t('interviews.decide.passBody')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button variant={isFail ? 'danger' : 'primary'} loading={decide.isPending} onClick={() => void submit()}>
            {isFail ? t('interviews.actions.fail') : t('interviews.actions.pass')}
          </Button>
        </>
      }
    >
      <Field label={t('interviews.decide.notes')} hint={t('interviews.decide.notesHint')}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={2000} />
      </Field>
    </Dialog>
  );
};
