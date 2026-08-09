// Employee picker for custody (ADR-019 rule 5): the box searches the server, and the browser
// never holds the staff list to filter it.
//
// Custody references employees, which the design makes a live HR integration (§9.1) — so this
// reads HR's public list endpoint through IT's own api module, never by importing HR's code. The
// endpoint is gated by `employee.view`; without it the picker says so rather than searching into
// a 403 the user cannot interpret.
//
// Resolve-by-id is not needed here and is deliberately absent: a custody dialog always opens on a
// fresh choice, and the CURRENT holder is rendered from the assignment row the server already
// returned. A picker only has to resolve ids it might arrive holding.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import * as api from '../api/it-api';

export const EmployeePicker = ({
  value,
  valueLabel,
  onChange,
  ariaLabel,
}: {
  /** The picked employee id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (employeeId: string, label: string) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('employee.view');

  const results = useQuery({
    queryKey: listKey('it', 'employeeSearch', search),
    queryFn: () => api.searchEmployees(search),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.custody.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">{valueLabel}</span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label={t('it.custody.clearPick')}
            title={t('it.custody.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.custody.pickerPlaceholder')}
        placeholder={t('it.custody.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.custody.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((employee) => {
                const label = `${employee.personal.fullNameAr} (${employee.code})`;
                return (
                  <li key={employee.id}>
                    <button
                      type="button"
                      aria-pressed={employee.id === value}
                      onClick={() => {
                        onChange(employee.id, label);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        employee.id === value
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
