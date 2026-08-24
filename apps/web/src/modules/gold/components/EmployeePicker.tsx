// INTEGRATION 1 + 2 — the picker behind the crew leader and both vault custodians.
//
// The gold system typed all three as free text and kept its own `supervisors` collection. Inside
// ECMS they are employees, so this box searches HR's public list and stores an employee id. The
// server records the NAME beside the id at write time, which is why the caller keeps `valueLabel`:
// a receipt that has already been printed must keep reading the same afterwards.
//
// Searching costs `employee.view`. Without it the control says so rather than searching into a 403
// the operator cannot interpret (the IT custody picker's precedent).
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { useEmployeeSearch } from '../api/gold-queries';

export const EmployeePicker = ({
  label,
  value,
  valueLabel,
  onChange,
  disabled = false,
}: {
  label: string;
  /** The picked employee id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (employeeId: string, name: string) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('employee.view');
  const results = useEmployeeSearch(search, allowed && !disabled);

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="truncate text-brand-800 dark:text-brand-200">{valueLabel}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onChange('', '');
              }}
              aria-label={t('gold.common.clear')}
              className="shrink-0 rounded p-0.5 text-brand-700 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-900"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {!disabled && value === '' && !allowed && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('gold.common.pickerNoAccess')}
        </p>
      )}
      {!disabled && value === '' && allowed && (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('gold.common.pickEmployee')}
          />
          {results.isFetching && <Spinner />}
          {search.trim() !== '' && !results.isFetching && (
            <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {results.data?.items.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  {t('gold.common.noResults')}
                </li>
              )}
              {results.data?.items.map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(employee.id, employee.personal.fullNameAr);
                      setSearch('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-800 dark:text-slate-200">
                      {employee.personal.fullNameAr}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-400" dir="ltr">
                      {employee.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
