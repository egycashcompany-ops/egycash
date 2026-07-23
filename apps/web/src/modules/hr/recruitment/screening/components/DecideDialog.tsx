// Accept / Reject a pending screening. A reason is required to reject (server-enforced, OQ-32)
// and optional (recorded as a decision note) to accept. Version-checked.
import { useState } from 'react';
import { type ScreeningOutcome } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useDecideScreening, useRedecideScreening } from '../api/screening-queries';

export const DecideDialog = ({
  open,
  onClose,
  outcome,
  screeningId,
  version,
  edit = false,
}: {
  open: boolean;
  onClose: () => void;
  outcome: ScreeningOutcome;
  screeningId: string;
  version: number;
  /** True when editing an already-decided screening (D7); uses the audited re-decide endpoint. */
  edit?: boolean;
}): JSX.Element => {
  const t = useT();
  const decideFresh = useDecideScreening(screeningId);
  const redecide = useRedecideScreening(screeningId);
  const decide = edit ? redecide : decideFresh;
  const [reason, setReason] = useState('');
  const isReject = outcome === 'rejected';

  const close = (): void => {
    onClose();
    setReason('');
  };

  const submit = async (): Promise<void> => {
    try {
      await decide.mutateAsync({ outcome, version, ...(reason.trim() === '' ? {} : { reason: reason.trim() }) });
      toast.success(isReject ? t('screening.decide.rejectedDone') : t('screening.decide.acceptedDone'));
      close();
    } catch {
      // surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={isReject ? t('screening.decide.rejectTitle') : t('screening.decide.acceptTitle')}
      description={isReject ? t('screening.decide.rejectBody') : t('screening.decide.acceptBody')}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant={isReject ? 'danger' : 'primary'}
            loading={decide.isPending}
            disabled={isReject && reason.trim() === ''}
            onClick={() => void submit()}
          >
            {isReject ? t('screening.actions.reject') : t('screening.actions.accept')}
          </Button>
        </>
      }
    >
      <Field
        label={t('screening.decide.reason')}
        required={isReject}
        hint={isReject ? undefined : t('screening.decide.reasonOptional')}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
    </Dialog>
  );
};
