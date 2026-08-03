// Resolves an employeeId to the person's name + code, sharing the HR employees detail cache
// (same query key), so a name fetched here is free on the HR profile and vice versa. The HR
// directory is its own permission: without `employee.view` the component degrades to the raw
// id — honest, and the fleet screens stay usable for operators without directory access.
import { useQuery } from '@tanstack/react-query';
import { useCan } from '../../../platform/rbac/Can';
import { detailKey } from '../../../shared/lib/query-keys';
import { getEmployee } from '../../hr/employee-management/employees/api/employee-api';

export const useEmployeeName = (
  employeeId: string,
): { name: string | null; code: string | null } => {
  const can = useCan();
  const { data } = useQuery({
    queryKey: detailKey('hr', 'employees', employeeId),
    queryFn: () => getEmployee(employeeId),
    enabled: employeeId !== '' && can('employee.view'),
    staleTime: 5 * 60_000,
  });
  return { name: data?.personal.fullNameAr ?? null, code: data?.code ?? null };
};

export const EmployeeName = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { name, code } = useEmployeeName(employeeId);
  if (name === null) {
    return (
      <span className="font-mono text-xs text-slate-400" dir="ltr">
        {employeeId.slice(-8)}
      </span>
    );
  }
  return (
    <span>
      {name}
      {code !== null && (
        <span className="ms-2 font-mono text-xs text-slate-500" dir="ltr">
          {code}
        </span>
      )}
    </span>
  );
};
