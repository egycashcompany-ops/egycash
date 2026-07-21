// Maps an employee status to a shared StatusBadge tone + localized label.
import { type EmployeeStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<EmployeeStatus, Tone> = {
  active: 'success',
  onLeave: 'info',
  suspended: 'warning',
  terminated: 'danger',
};

export const EmployeeStatusBadge = ({ status }: { status: EmployeeStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`employees.status.${status}`)} />;
};
