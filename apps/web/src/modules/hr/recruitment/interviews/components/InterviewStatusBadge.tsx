// Maps an interview's lifecycle (status + outcome) to a single, most-informative StatusBadge:
// completed → the terminal outcome (passed/failed); everything else → its own tone.
import { type InterviewOutcome, type InterviewStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

/**
 * Exhaustive by type, like every other stage badge (I7). That matters more than it looks: this
 * map used to be a ternary (`cancelled ? neutral : info`), which silently accepted any new status
 * — so when I11 added `waiting` and `inProgress` to `INTERVIEW_STATUSES`, nothing failed to
 * compile and the queues rendered raw translation keys. A `Record<InterviewStatus, Tone>` makes
 * the next value added to the enum a typecheck error here.
 *
 * `waiting` is `warning` to match screening, evaluations and offers — it is the "nothing has
 * happened yet" tone across the whole pipeline.
 */
const TONE: Record<InterviewStatus, Tone> = {
  waiting: 'warning',
  scheduled: 'info',
  inProgress: 'brand',
  completed: 'info', // unreachable — `completed` returns the outcome badge below.
  cancelled: 'neutral',
};

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
  return <StatusBadge tone={TONE[status]} label={t(`interviews.status.${status}`)} />;
};
