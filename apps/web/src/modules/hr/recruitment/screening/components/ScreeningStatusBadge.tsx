// Maps a screening status to a shared StatusBadge tone + localized label.
import { type ScreeningStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<ScreeningStatus, Tone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
};

export const ScreeningStatusBadge = ({ status }: { status: ScreeningStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`screening.status.${status}`)} />;
};
