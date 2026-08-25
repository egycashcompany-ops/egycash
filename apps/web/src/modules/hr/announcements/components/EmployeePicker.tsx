// Choosing recipients BY NAME.
//
// A search box rather than a list, because the list is the company. Loading every employee into a
// multi-select answers "which of the ones that happened to be fetched" and quietly hides the rest
// — the failure mode is that a name you know exists simply is not there, and there is nothing on
// screen to say why.
//
// The chosen people stay visible as chips after the query is cleared. That is the property that
// makes this safe to use: the box shows what you are searching for, the chips show who you have
// actually picked, and the two never have to be the same thing.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type EmployeeDto, type Paginated } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { buildQuery, getPage } from '../../../../shared/lib/api-client';
import { CloseIcon } from '../../../../shared/ui/icons';

export interface PickedEmployee {
  id: string;
  code: string;
  name: string;
}

/** Enough characters to mean something. One letter matches most of the company. */
const MIN_QUERY = 2;
const RESULTS = 10;

export const EmployeePicker = ({
  value,
  onChange,
}: {
  value: PickedEmployee[];
  onChange: (next: PickedEmployee[]) => void;
}): JSX.Element => {
  const t = useT();
  const [query, setQuery] = useState('');
  const term = query.trim();

  const results = useQuery({
    queryKey: ['employees', 'picker', term],
    enabled: term.length >= MIN_QUERY,
    queryFn: () =>
      getPage<EmployeeDto>(
        `/hr/employees${buildQuery({ search: term, page: 1, pageSize: RESULTS })}`,
      ),
    // A search is answered against the registry as it is now; keeping the answer briefly stops a
    // keystroke from re-asking for a term already on screen.
    staleTime: 30_000,
  });

  const chosen = useMemo(() => new Set(value.map((employee) => employee.id)), [value]);

  const add = (employee: EmployeeDto): void => {
    if (chosen.has(employee.id)) return;
    onChange([
      ...value,
      { id: employee.id, code: employee.code, name: employee.personal.fullNameAr },
    ]);
    setQuery('');
  };

  const remove = (id: string): void => onChange(value.filter((employee) => employee.id !== id));

  const items = ((results.data as Paginated<EmployeeDto> | undefined)?.items ?? []).filter(
    (employee) => !chosen.has(employee.id),
  );

  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('hr.announcements.picker.label')}
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('hr.announcements.picker.placeholder')}
          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </label>

      {term.length >= MIN_QUERY && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700">
          {results.isPending ? (
            <p className="p-3 text-sm text-slate-500">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">{t('hr.announcements.picker.noMatches')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((employee) => (
                <li key={employee.id}>
                  <button
                    type="button"
                    onClick={() => add(employee)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-800 dark:text-slate-100">
                      {employee.personal.fullNameAr}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-500">{employee.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((employee) => (
            <li
              key={employee.id}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pe-1 ps-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="text-slate-800 dark:text-slate-100">{employee.name}</span>
              <span className="font-mono text-xs text-slate-500">{employee.code}</span>
              <button
                type="button"
                onClick={() => remove(employee.id)}
                aria-label={t('hr.announcements.picker.remove')}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
