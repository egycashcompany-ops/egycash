// Maps an evaluation status to a shared StatusBadge tone + localized label.
import { type EvaluationStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<EvaluationStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export const EvaluationStatusBadge = ({ status }: { status: EvaluationStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`evaluations.status.${status}`)} />;
};
