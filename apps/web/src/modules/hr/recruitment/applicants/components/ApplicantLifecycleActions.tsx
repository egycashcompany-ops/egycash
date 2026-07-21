// Applicant withdraw / restore — usable FROM ANY STAGE. Given an applicant (preloaded or fetched
// by id) it renders the one relevant lifecycle action: Withdraw while active (`new`), or Restore
// while `withdrawn`. Restoring returns the applicant to the pipeline WITHOUT losing history — they
// resume from the exact stage they left (visibility is derived from their records, so their
// existing screening/interview/offer place them back automatically). Version-checked, audited,
// permission-gated (`applicant.edit`). Shared by the applicant detail and every stage detail page.
import { useState } from 'react';
import { type ApplicantDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Textarea } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useApplicant, useRestoreApplicant, useWithdrawApplicant } from '../api/applicant-queries';

export const ApplicantLifecycleActions = ({
  applicantId,
  applicant: preloaded,
  size = 'sm',
  showWithdrawnHint = false,
}: {
  applicantId: string;
  /** Pass the already-loaded applicant to avoid a second fetch (applicant detail). */
  applicant?: ApplicantDto;
  size?: 'sm' | 'md';
  /** Show a short "withdrawn — restore to continue" hint next to the Restore button. */
  showWithdrawnHint?: boolean;
}): JSX.Element | null => {
  const t = useT();
  const fetched = useApplicant(preloaded === undefined ? applicantId : '');
  const a = preloaded ?? fetched.data;
  const withdraw = useWithdrawApplicant(applicantId);
  const restore = useRestoreApplicant(applicantId);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (a === undefined || (a.status !== 'new' && a.status !== 'withdrawn')) return null;

  const submitWithdraw = async (): Promise<void> => {
    try {
      await withdraw.mutateAsync({ version: a.version, reason: reason.trim() });
      toast.success(t('applicants.withdraw.done'));
      setWithdrawOpen(false);
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  const submitRestore = async (): Promise<void> => {
    try {
      await restore.mutateAsync({
        version: a.version,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
      toast.success(t('applicants.restore.done'));
      setRestoreOpen(false);
      setReason('');
    } catch {
      // surfaced globally
    }
  };

  return (
    <>
      {a.status === 'new' && (
        <Can permission="applicant.edit">
          <Button size={size} variant="secondary" onClick={() => { setReason(''); setWithdrawOpen(true); }}>
            {t('applicants.actions.withdraw')}
          </Button>
        </Can>
      )}
      {a.status === 'withdrawn' && (
        <Can permission="applicant.edit">
          <span className="inline-flex items-center gap-2">
            {showWithdrawnHint && (
              <span className="text-xs text-amber-700 dark:text-amber-300">{t('applicants.restore.hint')}</span>
            )}
            <Button size={size} onClick={() => { setReason(''); setRestoreOpen(true); }}>
              {t('applicants.actions.restore')}
            </Button>
          </span>
        </Can>
      )}

      <Dialog
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={t('applicants.withdraw.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={withdraw.isPending} disabled={reason.trim() === ''} onClick={() => void submitWithdraw()}>
              {t('applicants.actions.withdraw')}
            </Button>
          </>
        }
      >
        <Field label={t('applicants.withdraw.reason')} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Dialog>

      <Dialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title={t('applicants.restore.title')}
        description={t('applicants.restore.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={restore.isPending} onClick={() => void submitRestore()}>
              {t('applicants.actions.restore')}
            </Button>
          </>
        }
      >
        <Field label={t('applicants.restore.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Dialog>
    </>
  );
};
