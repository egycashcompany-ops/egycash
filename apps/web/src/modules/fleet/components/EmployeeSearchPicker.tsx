// Driver search picker: type → narrow FLEET's own roster → pick.
//
// It searched HR's employee list under `employee.view` — the whole directory — to fill a box whose
// only legitimate answers are DRIVERS: this picker names the person an unavailability is being
// recorded for, on a screen that is about who can be put on the road. So it searches the roster
// Fleet publishes, which is both the right set and the right grant.
//
// «انا عاوز اعرض السواقيين بتوع الحركه للناس اللى واخده موديول الحركه بس». Without the roster
// grant the picker says so rather than showing an empty search that silently finds nothing — and
// the flows that already KNOW the person (recording attendance from a driver's own profile) skip
// the picker entirely.
import { useMemo, useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { useFleetPeopleMap } from './EmployeeName';

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
  const allowed = can('fleetDriver.view');
  const roster = useFleetPeopleMap();

  /** The roster, narrowed by what has been typed — name or code, ten at a time as before. */
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (term === '') return [];
    return [...roster.values()]
      .filter(
        (person) =>
          person.fullNameAr.toLocaleLowerCase().includes(term) ||
          person.code.toLocaleLowerCase().includes(term),
      )
      .slice(0, 10);
  }, [roster, search]);

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
          {matches.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('fleet.drivers.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {matches.map((person) => {
                const label = `${person.fullNameAr} (${person.code})`;
                const picked = person.employeeId === value;
                return (
                  <li key={person.employeeId}>
                    <button
                      type="button"
                      onClick={() => onPick(person.employeeId, label)}
                      aria-pressed={picked}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        picked
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span>{person.fullNameAr}</span>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {person.code}
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
