// "Move to Job Offer" — offered wherever the candidate is, and ONLY once there is nothing left to
// decide. Offer eligibility is never automatic: HR explicitly moves an applicant to the Job Offer
// stage with this action, and only moved applicants surface in the New Job Offer picker.
//
// IT IS NOT A WAY TO SKIP A STAGE, and it used to be one. The button asked only whether the
// candidate was active and not already moved, so it sat on a finished first interview while the
// security check and the medical check were still waiting — and pressing it jumped both. Whether
// the move is available is now the server's answer (`availableActions`' `moveToOffer`, I10),
// derived from the pipeline itself: anything earlier still open and there is nothing to offer yet.
// The route refuses the same case, so a stale tab gets the reason rather than the jump.
//
// Shows a confirm dialog; renders a badge instead once the applicant is already in the offer stage.
// Version-checked, audited, permission-gated (`applicant.moveToOffer`).
import { useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { useStageAuthority } from '../../shared/useStageAuthority';
import { useApplicant, useMoveApplicantToOffer } from '../api/applicant-queries';

export const MoveToOfferButton = ({ applicantId }: { applicantId: string }): JSX.Element | null => {
  const t = useT();
  const { data: applicant } = useApplicant(applicantId);
  const authority = useStageAuthority(applicantId);
  const move = useMoveApplicantToOffer(applicantId);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (applicant === undefined || applicant.status !== 'new') return null;
  if (applicant.movedToOfferAt !== null) {
    return <StatusBadge tone="brand" label={t('applicants.moveToOffer.inStage')} />;
  }
  // Fails closed: no answer yet, no button.
  if (!authority.may('moveToOffer')) return null;

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
    <>
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
          <p className="text-sm text-slate-600 dark:text-slate-300">{applicant.fullNameAr}</p>
        </Dialog>
      )}
    </>
  );
};
