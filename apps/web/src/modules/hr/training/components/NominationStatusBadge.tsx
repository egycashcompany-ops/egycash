// One nomination's status, in a word and a colour.
//
// `pendingApproval` is the one that wants attention — it is the row somebody is waiting on. The
// three ends are told apart deliberately: approved is the good one, rejected is not, and withdrawn
// is neither — the request was taken back rather than refused, and colouring it as a refusal would
// blame the wrong person.
import { type TrainingNominationStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../shared/ui';
import { useT } from '../../../../platform/localization/useT';

const TONE: Readonly<Record<TrainingNominationStatus, Tone>> = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export const NominationStatusBadge = ({
  status,
}: {
  status: TrainingNominationStatus;
}): JSX.Element => {
  const t = useT();
  return (
    <StatusBadge tone={TONE[status]} label={t(`training.nomination.status.${status}`)} />
  );
};
