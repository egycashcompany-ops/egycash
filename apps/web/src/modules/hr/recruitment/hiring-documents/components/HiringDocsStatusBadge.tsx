// Maps a hiring-documents set status to a shared StatusBadge tone + localized label.
import { type HiringDocumentsStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<HiringDocumentsStatus, Tone> = {
  inProgress: 'warning',
  completed: 'success',
};

export const HiringDocsStatusBadge = ({ status }: { status: HiringDocumentsStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`hiringDocs.status.${status}`)} />;
};
