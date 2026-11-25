// The keeper box (design §7.8, OD-10 A; ADR-019 rule 5): it searches the server, and the browser
// never holds the staff list to filter it. Written after IT's `EmployeePicker`, over the module's
// OWN endpoint — `/administration/people`, under the module's own keys — never HR's list under
// `employee.view`, and never IT's.
//
// WHO IT FINDS: the people who work here today, within the reach of the warehouse write keys the
// reader holds (the server's `peopleScopesOf`). A keeper names nobody who has left — the endpoint
// takes no status, and the server refuses a leaver too (`ADMINISTRATION_EMPLOYEE_EXITED`). A stored
// keeper is shown by the caller from the warehouse's own `keeper` summary, so no read of it is
// needed here.
//
// WHO MAY OPEN IT: exactly the keys the endpoint's `authorizeAny` admits —
// `administrationWarehouse.create` or `.edit`. Without either the box says so, rather than
// searching into a 403 the reader could not interpret.
import { useState } from 'react';
import { type AdministrationPersonDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Badge } from '../../../shared/ui/Badge';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { usePeopleSearch } from '../api/people-queries';

/** The keys `GET /administration/people` admits (`ADMINISTRATION_PEOPLE_GRANTS`, the server's). */
export const ADMINISTRATION_PEOPLE_GRANTS = [
  'administrationWarehouse.create',
  'administrationWarehouse.edit',
] as const;

/** The label a pick carries to the caller's chip — «محمد أحمد (0100052)». */
export const pickerLabel = (person: Pick<AdministrationPersonDto, 'fullNameAr' | 'code'>): string =>
  `${person.fullNameAr} (${person.code})`;

export const EmployeePicker = ({
  value,
  valueLabel,
  onChange,
  error = false,
}: {
  /** The picked employee id, '' when none. */
  value: string;
  /** Label for the current pick, kept by the caller so the chip survives a refetch. */
  valueLabel: string;
  onChange: (employeeId: string, label: string) => void;
  /** The field around it carries a refusal: the chip says so in its colour too. */
  error?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = ADMINISTRATION_PEOPLE_GRANTS.some((grant) => can(grant));
  const results = usePeopleSearch(search, allowed);
  const rows = results.data?.items ?? [];

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('administration.people.noAccess')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div
          data-keeper-chip=""
          className={
            error
              ? 'flex items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-950/40'
              : 'flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40'
          }
        >
          <span
            className={
              error ? 'text-red-800 dark:text-red-200' : 'text-brand-800 dark:text-brand-200'
            }
          >
            {valueLabel}
          </span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label={t('administration.people.clearPick')}
            title={t('administration.people.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('administration.people.placeholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('administration.people.noResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((person) => (
                <li key={person.employeeId}>
                  <button
                    type="button"
                    aria-pressed={person.employeeId === value}
                    onClick={() => {
                      onChange(person.employeeId, pickerLabel(person));
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                      person.employeeId === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{person.fullNameAr}</span>
                      {person.status === 'exited' && (
                        <Badge size="sm">{t('administration.people.exited')}</Badge>
                      )}
                    </span>
                    <span
                      className="font-mono text-xs text-slate-500 dark:text-slate-400"
                      dir="ltr"
                    >
                      {person.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
