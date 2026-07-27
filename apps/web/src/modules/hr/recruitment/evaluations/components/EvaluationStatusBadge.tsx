// Maps an evaluation status to a shared StatusBadge tone + localized label.
import { type EvaluationStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<EvaluationStatus, Tone> = {
  waiting: 'warning',
  approved: 'success',
  rejected: 'danger',
  // Not a decision — the candidate left before the phase was assessed (I14).
  cancelled: 'neutral',
};

export const EvaluationStatusBadge = ({ status }: { status: EvaluationStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`evaluations.status.${status}`)} />;
};
