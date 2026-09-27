// The technician box — «الفنى يكون من موظفين الـ IT بس».
//
// A ticket goes to somebody who works in IT: a current employee of the departments ticked in the
// help-desk settings (`it.technicianDepartmentIds`). The list is HR's, read through IT's own
// `/it/technicians`, so the dispatcher sees HR names rather than login accounts — and nobody from
// payroll or the vault turns up in it.
//
// Three honest states rather than one empty list:
//   • no IT department chosen yet — said so, with where it is fixed;
//   • an IT employee with no login — shown, and not pickable: a ticket is assigned to a LOGIN, and
//     one that does not exist cannot open the ticket it was given;
//   • a leaver — found only when `includeExited` asks (a FILTER over work already done), marked.
// The server holds the same line on assignment; the box only keeps from offering what it refuses.
//
// The list is a server page, searched as the dispatcher types — ADR-019 rule 5. In a dialog
// (`listWhenEmpty`) it opens on the first page unsearched, because an IT department is a handful
// of people and the dispatcher should see them before being asked to spell one; in a filter bar it
// stays closed until something is typed, like every other filter box.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ItTechnicianDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Badge } from '../../../shared/ui/Badge';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import * as api from '../api/it-api';

export const TechnicianPicker = ({
  value,
  valueLabel,
  onChange,
  ariaLabel,
  placeholder,
  includeExited = false,
  listWhenEmpty = false,
}: {
  /** The picked technician's EMPLOYEE id, '' when none. */
  value: string;
  valueLabel: string;
  /** The whole technician: assignment needs the login, a filter keeps the employee. */
  onChange: (technician: ItTechnicianDto | null, label: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  /** `true` for a filter: technicians who have since left did the work they did. */
  includeExited?: boolean;
  /** Show the first page before anything is typed — a dialog's choice, not a filter bar's. */
  listWhenEmpty?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('itTicket.assign') || can('itTicket.edit');

  const results = useQuery({
    queryKey: listKey('it', 'technicians', { search, includeExited }),
    queryFn: () => api.searchTechnicians(search, { includeExited }),
    enabled: allowed && (listWhenEmpty || search.trim() !== ''),
    staleTime: 30_000,
  });
  const listed = listWhenEmpty || search.trim() !== '';

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.tickets.pickerNoAccess')}</p>
    );
  }

  // Nobody is configured: said in place of the list, and the box stays usable — a filter that has
  // been typed into can still be cleared.
  const notConfigured = results.data?.configured === false;
  const items = results.data?.items ?? [];

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">{valueLabel}</span>
          <button
            type="button"
            onClick={() => onChange(null, '')}
            aria-label={t('it.tickets.clearPick')}
            title={t('it.tickets.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? placeholder ?? t('it.tickets.pickerPlaceholder')}
        placeholder={placeholder ?? t('it.tickets.pickerPlaceholder')}
      />
      {listed && notConfigured && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t('it.tickets.pickerNotConfigured')}
        </p>
      )}
      {listed && !notConfigured && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.tickets.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((technician) => {
                const label = `${technician.fullNameAr} (${technician.code})`;
                const pickable = technician.userId !== null;
                return (
                  <li key={technician.employeeId}>
                    <button
                      type="button"
                      disabled={!pickable}
                      aria-pressed={technician.employeeId === value}
                      onClick={() => {
                        onChange(technician, label);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:hover:bg-slate-800/60 ${
                        technician.employeeId === value
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{technician.fullNameAr}</span>
                        {technician.status === 'exited' && (
                          <Badge size="sm">{t('it.custody.pickerExited')}</Badge>
                        )}
                        {!pickable && (
                          <Badge size="sm" tone="warning">
                            {t('it.tickets.pickerNoLogin')}
                          </Badge>
                        )}
                      </span>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {technician.code}
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
