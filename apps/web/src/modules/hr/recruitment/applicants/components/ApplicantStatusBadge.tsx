// Maps an applicant lifecycle status to a shared StatusBadge tone + localized label.
import { type ApplicantStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<ApplicantStatus, Tone> = {
  new: 'info',
  rejected: 'danger',
  withdrawn: 'neutral',
};

export const ApplicantStatusBadge = ({ status }: { status: ApplicantStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`applicants.status.${status}`)} />;
};
