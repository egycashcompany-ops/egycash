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
//
// HOW IT IS DRAWN: by the module's `ReferencePicker` (P2 re-detail §9.4), which owns the chip, the
// search box, the results and the no-access sentence; this file gives it the keys, the search, the
// words and the rows.
import { type AdministrationPersonDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Badge } from '../../../shared/ui/Badge';
import { usePeopleSearch } from '../api/people-queries';
import { ReferencePicker } from './ReferencePicker';

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
  const allowed = ADMINISTRATION_PEOPLE_GRANTS.some((grant) => can(grant));

  return (
    <ReferencePicker
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      error={error}
      allowed={allowed}
      useSearch={usePeopleSearch}
      rowId={(person) => person.employeeId}
      rowLabel={pickerLabel}
      renderRow={(person) => (
        <>
          <span className="flex items-center gap-2">
            <span>{person.fullNameAr}</span>
            {person.status === 'exited' && (
              <Badge size="sm">{t('administration.people.exited')}</Badge>
            )}
          </span>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {person.code}
          </span>
        </>
      )}
      texts={{
        placeholder: 'administration.people.placeholder',
        noResults: 'administration.people.noResults',
        noAccess: 'administration.people.noAccess',
        clearPick: 'administration.people.clearPick',
      }}
    />
  );
};
