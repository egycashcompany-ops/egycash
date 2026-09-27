// A person's employment status as IT prints it. HR's fact, read fresh through `/it/people` — this
// only picks the tone and the label, and never infers a status from any other field. `exited` is
// the one every IT screen has to tell apart: a leaver can still appear in a search and a history,
// and must never be mistaken for somebody a laptop can be handed to.
import { type EmployeeStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { StatusBadge, type Tone } from '../../../shared/ui/Badge';

const TONES: Readonly<Record<EmployeeStatus, Tone>> = {
  probation: 'info',
  active: 'success',
  onLeave: 'brand',
  suspended: 'warning',
  exited: 'neutral',
};

export const PersonStatusBadge = ({ status }: { status: EmployeeStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONES[status]} label={t(`it.employees.status.${status}`)} />;
};
