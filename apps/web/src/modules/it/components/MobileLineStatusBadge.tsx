// A mobile line's status pill. The status follows from the named actions alone (hand over, return,
// suspend, reactivate) and is the server's — this only picks the tone and the label for it.
import { type ItMobileLineStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<ItMobileLineStatus, Tone>> = {
  inStock: 'success',
  assigned: 'info',
  suspended: 'warning',
};

export const MobileLineStatusBadge = ({ status }: { status: ItMobileLineStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`it.mobileLines.status.${status}`)} />;
};
