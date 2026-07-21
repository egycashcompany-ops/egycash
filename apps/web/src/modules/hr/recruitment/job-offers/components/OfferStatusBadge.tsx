// Maps an offer status to a shared StatusBadge tone + localized label.
import { type OfferStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<OfferStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'danger',
  expired: 'warning',
  withdrawn: 'neutral',
};

export const OfferStatusBadge = ({ status }: { status: OfferStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`offers.status.${status}`)} />;
};
