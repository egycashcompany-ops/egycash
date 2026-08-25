// Requisition status pill. The status is the SERVER's — the two fulfilment states in particular
// are entered by the system as hires land (D-REQ-13), so nothing here derives one from a count.
import { type JobRequisitionStatus } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';

const TONES: Readonly<Record<JobRequisitionStatus, Tone>> = {
  draft: 'neutral',
  pendingManager: 'warning',
  pendingHr: 'warning',
  open: 'info',
  partiallyFilled: 'info',
  filled: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  closed: 'neutral',
};

export const RequisitionStatusBadge = ({
  status,
}: {
  status: JobRequisitionStatus;
}): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`hr.requisitions.status.${status}`)} />;
};
