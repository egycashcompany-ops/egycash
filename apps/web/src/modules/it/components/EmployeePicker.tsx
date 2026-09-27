// The employee box (ADR-019 rule 5): it searches the server, and the browser never holds the staff
// list to filter it.
//
// Custody references employees, which the design makes a live HR integration (§9.1). The names
// are HR's, read through IT's OWN endpoint (`/it/people`) under IT's own grant, `itAsset.view` —
// not HR's list under `employee.view`, which is the whole HR file and which a technician used to
// need before they could see who they were handing a laptop to. Without `itAsset.view` the box
// says so rather than searching into a 403 the user cannot interpret.
//
// Resolve-by-id is the CALLER's: a filter arriving on a link resolves its chip through
// `useItPerson`, and a custody dialog always opens on a fresh choice.
//
// WHO THE BOX FINDS depends on what the pick is for — «لما يعمل بحث ... كل المواظفين سواء اللى
// مشى او اللى موجود لكن فى حاله الاضافه اللى موجود بس»:
//   • a SEARCH (every filter that picks a person) finds everyone HR has, leavers included — the
//     records still hold them, and a leaver who kept a laptop is exactly who a filter gets asked
//     about;
//   • a HAND-OVER (assign, transfer) finds the people who work here today, and nobody else.
// The hand-over is the default, so a new box that forgets to choose cannot offer a leaver
// custody. The server refuses that hand-over too; this only keeps the box from offering it.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Badge } from '../../../shared/ui/Badge';
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
  placeholder,
  includeExited = false,
}: {
  /** The picked employee id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (employeeId: string, label: string) => void;
  ariaLabel?: string;
  /** What the box asks for — a filter says WHICH person it narrows by. */
  placeholder?: string;
  /** `true` for a search: the people who have left are found too, and marked as such. */
  includeExited?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('itAsset.view');

  const results = useQuery({
    // The population is part of the key: a search's wider answer must never be served from the
    // cache to a hand-over box that was typed into with the same letters.
    queryKey: listKey('it', 'employeeSearch', { search, includeExited }),
    queryFn: () => api.searchPeople(search, { includeExited }),
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
        aria-label={ariaLabel ?? placeholder ?? t('it.custody.pickerPlaceholder')}
        placeholder={placeholder ?? t('it.custody.pickerPlaceholder')}
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
                const label = `${employee.fullNameAr} (${employee.code})`;
                return (
                  <li key={employee.employeeId}>
                    <button
                      type="button"
                      aria-pressed={employee.employeeId === value}
                      onClick={() => {
                        onChange(employee.employeeId, label);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        employee.employeeId === value
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{employee.fullNameAr}</span>
                        {employee.status === 'exited' && (
                          <Badge size="sm">{t('it.custody.pickerExited')}</Badge>
                        )}
                      </span>
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
