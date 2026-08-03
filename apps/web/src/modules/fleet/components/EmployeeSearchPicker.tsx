// Employee search picker (the ContractCreatePage idiom): type → live results from the real HR
// list endpoint → pick. Needs `employee.view`; without it the picker says so instead of showing
// an empty search that silently finds nothing — and the flows that already KNOW the employee
// (e.g. recording attendance from a driver's own profile) skip the picker entirely.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { listEmployees } from '../../hr/employee-management/employees/api/employee-api';

export const EmployeeSearchPicker = ({
  value,
  onPick,
}: {
  /** The currently picked employeeId ('' = none). */
  value: string;
  onPick: (employeeId: string, label: string) => void;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('employee.view');

  const results = useQuery({
    queryKey: ['fleet', 'employeeSearch', search],
    queryFn: () => listEmployees({ search, employed: true, pageSize: 10 }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('fleet.drivers.pickerNeedsDirectory')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('fleet.drivers.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('fleet.drivers.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((employee) => {
                const label = `${employee.personal.fullNameAr} (${employee.code})`;
                const picked = employee.id === value;
                return (
                  <li key={employee.id}>
                    <button
                      type="button"
                      onClick={() => onPick(employee.id, label)}
                      aria-pressed={picked}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        picked
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span>{employee.personal.fullNameAr}</span>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {employee.code}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
