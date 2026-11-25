// Who sees a folder — «مين من الشركة ليه الأحقية أنه يشوف الفولدر دا». Written after Administrative
// Affairs' `EmployeePicker` (a search box over the module's OWN endpoint, results as buttons, the
// pick as a chip), for several people at once: every chosen person is a chip, and a pick leaves the
// search open for the next.
//
// It searches the server — `/compliance/people`, active employee logins only — and the browser never
// holds the staff list. A person already on the list whose account was since suspended stays a chip,
// marked as such, until they are taken off.
import { useState } from 'react';
import { type CompliancePersonDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Badge } from '../../../shared/ui/Badge';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CheckIcon, CloseIcon } from '../../../shared/ui/icons';
import { usePeopleSearch } from '../api/compliance-queries';

export const personName = (person: CompliancePersonDto, locale: Locale): string =>
  locale === 'en' && person.name.en.trim() !== '' ? person.name.en : person.name.ar;

export const PeoplePicker = ({
  value,
  onChange,
}: {
  value: CompliancePersonDto[];
  onChange: (next: CompliancePersonDto[]) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');
  const results = usePeopleSearch(search, true);
  const rows = results.data?.items ?? [];
  const chosen = new Set(value.map((person) => person.userId));

  const toggle = (person: CompliancePersonDto): void => {
    onChange(
      chosen.has(person.userId)
        ? value.filter((p) => p.userId !== person.userId)
        : [...value, person],
    );
  };

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400" data-people-none="">
          {t('compliance.people.none')}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={t('compliance.people.chosen')}>
          {value.map((person) => (
            <li
              key={person.userId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 py-1 pe-1 ps-2.5 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200"
            >
              <span>{personName(person, locale)}</span>
              {!person.isActive && <Badge size="sm">{t('compliance.people.suspended')}</Badge>}
              <button
                type="button"
                onClick={() => toggle(person)}
                aria-label={`${t('compliance.people.remove')} — ${personName(person, locale)}`}
                title={t('compliance.people.remove')}
                className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('compliance.people.placeholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('compliance.people.noResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((person) => {
                const picked = chosen.has(person.userId);
                return (
                  <li key={person.userId}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggle(person)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        picked
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {picked && <CheckIcon className="h-4 w-4" />}
                        {personName(person, locale)}
                      </span>
                      {person.username !== null && (
                        <span
                          className="font-mono text-xs text-slate-500 dark:text-slate-400"
                          dir="ltr"
                        >
                          {person.username}
                        </span>
                      )}
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
