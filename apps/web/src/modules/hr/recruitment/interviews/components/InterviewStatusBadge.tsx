// Maps an interview's lifecycle (status + outcome) to a single, most-informative StatusBadge:
// scheduled → info; completed → the terminal outcome (passed/failed); cancelled → neutral.
import { type InterviewOutcome, type InterviewStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

export const InterviewStatusBadge = ({
  status,
  outcome,
}: {
  status: InterviewStatus;
  outcome: InterviewOutcome;
}): JSX.Element => {
  const t = useT();
  if (status === 'completed') {
    const passed = outcome === 'passed';
    return (
      <StatusBadge tone={passed ? 'success' : 'danger'} label={t(`interviews.outcome.${passed ? 'passed' : 'failed'}`)} />
    );
  }
  const tone: Tone = status === 'cancelled' ? 'neutral' : 'info';
  return <StatusBadge tone={tone} label={t(`interviews.status.${status}`)} />;
};
