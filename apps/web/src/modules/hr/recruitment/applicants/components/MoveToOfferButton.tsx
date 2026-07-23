// "Move to Job Offer" — usable FROM ANY interview or evaluation stage. Offer eligibility is
// never automatic: HR explicitly moves an applicant to the Job Offer stage with this action, and
// only moved applicants surface in the New Job Offer picker. Shows a confirm dialog; renders a
// badge instead once the applicant is already in the offer stage. Version-checked, audited,
// permission-gated (`applicant.moveToOffer`).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Can } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useApplicant, useMoveApplicantToOffer } from '../api/applicant-queries';

export const MoveToOfferButton = ({ applicantId }: { applicantId: string }): JSX.Element | null => {
  const t = useT();
  const { data: applicant } = useApplicant(applicantId);
  const move = useMoveApplicantToOffer(applicantId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (applicant === undefined || applicant.status !== 'new') return null;
  if (applicant.movedToOfferAt !== null) {
    return <StatusBadge tone="brand" label={t('applicants.moveToOffer.inStage')} />;
  }

  const submit = async (): Promise<void> => {
    try {
      await move.mutateAsync({ version: applicant.version });
      toast.success(t('applicants.moveToOffer.done'));
      setConfirmOpen(false);
    } catch {
      // surfaced globally
    }
  };

  return (
    <Can permission="applicant.moveToOffer">
      <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(true)}>
        {t('applicants.moveToOffer.action')}
      </Button>
      {confirmOpen && (
        <Dialog
          open
          onClose={() => setConfirmOpen(false)}
          title={t('applicants.moveToOffer.title')}
          description={t('applicants.moveToOffer.body')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
              <Button loading={move.isPending} onClick={() => void submit()}>
                {t('applicants.moveToOffer.action')}
              </Button>
            </>
          }
        >
          <p className="font-mono text-sm text-slate-600 dark:text-slate-300" dir="ltr">{applicant.code}</p>
        </Dialog>
      )}
    </Can>
  );
};
