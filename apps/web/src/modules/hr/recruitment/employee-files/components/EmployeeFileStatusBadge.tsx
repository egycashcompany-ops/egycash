// Maps an employee-file status to a shared StatusBadge tone + localized label.
import { type EmployeeFileStatus } from '@ecms/contracts';
import { StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { useT } from '../../../../../platform/localization/useT';

const TONE: Record<EmployeeFileStatus, Tone> = {
  active: 'success',
  archived: 'neutral',
};

export const EmployeeFileStatusBadge = ({ status }: { status: EmployeeFileStatus }): JSX.Element => {
  const t = useT();
  return <StatusBadge tone={TONE[status]} label={t(`employeeFiles.status.${status}`)} />;
};
