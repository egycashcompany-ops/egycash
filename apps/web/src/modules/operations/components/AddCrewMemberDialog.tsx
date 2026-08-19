// Put an employee on the operations roster.
//
// The employee search reads HR's own endpoint — the same thing the Fleet driver picker does
// (`EmployeeSearchPicker`). That is the established frontend precedent: HR owns the person and
// serves them; Operations does not keep a copy, and the backend never imports HR either — it
// validates the id through the platform directory seam.
//
// Adding someone here creates their requirements row with every flag false. That is deliberate:
// membership and eligibility are different things, and a new member is assignable immediately.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type SetOperationsCrewRequirements } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { listEmployees } from '../../hr/employee-management/employees/api/employee-api';
import { useSetCrewRequirements } from '../api/operations-queries';

/** A brand-new member starts with every flag false — membership, not eligibility. */
export const blankFlags = (): SetOperationsCrewRequirements => ({
  isCaptain: false,
  isSpecialist: false,
  hasWeapon: false,
  hasSignature: false,
  hasLicense: false,
  hasTemporaryLicense: false,
  isOpsAdmin: false,
  isNewJoiner: false,
  isAssignedSpecialTask: false,
  isPriority: false,
  notes: null,
});

export const AddCrewMemberDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const [search, setSearch] = useState('');
  const add = useSetCrewRequirements();

  const results = useQuery({
    queryKey: ['operations', 'employeeSearch', search],
    queryFn: () => listEmployees({ search, page: 1, pageSize: 10 }),
    enabled: open && search.trim().length >= 2,
  });

  const pick = async (employeeId: string): Promise<void> => {
    try {
      await add.mutateAsync({ employeeId, body: blankFlags() });
      toast.success(t('operations.crew.requirements.added'));
      setSearch('');
      onClose();
    } catch {
      toast.error(t('operations.crew.requirements.addFailed'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('operations.crew.requirements.add')}>
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('operations.crew.requirements.searchEmployee')}
        />
        {results.isLoading && <Spinner />}
        {search.trim().length < 2 && (
          <p className="text-sm text-slate-500">{t('operations.crew.requirements.searchHint')}</p>
        )}
        <ul className="space-y-1">
          {(results.data?.items ?? []).map((employee) => (
            <li key={employee.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                disabled={add.isPending}
                onClick={() => void pick(employee.id)}
              >
                <span className="font-medium">{employee.personal.fullNameAr}</span>{' '}
                <span className="text-xs tabular-nums text-slate-500">{employee.code}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
