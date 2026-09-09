// «مين السائق؟» answered from the DRIVERS REGISTRY, not from the payroll.
//
// The card this sits in files a fine against a person, and the server accepts that only for
// someone who HAS a fleet driver profile — «no driver profile exists for this employee (FR-11)».
// The control it replaced searched every employed person, so a reader could pick a colleague who
// is not a driver, fill the card, press save, and be told «some fields need review» about a field
// they had filled correctly. The offer and the rule now agree: this lists exactly the people the
// drivers screen lists as recorded, so anyone offered can be filed against.
//
// Names come from HR, as everywhere else — the roster carries ids, and `useEmployeeRecords` reads
// the same cached records the drivers table itself renders, so naming this list costs no extra
// request beyond the ones that screen already makes.
import { useMemo } from 'react';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type ControlDensity } from '../../../shared/ui/form';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useDrivers } from '../api/fleet-queries';
import { useEmployeeRecords } from './EmployeeName';
import { driverPickLabel, driverPickShortLabel } from '../lib/driver-filter-selection';

/** Everyone the registry has a RECORDED profile for — the only people a fine can be filed against. */
const useRecordedDrivers = (): { employeeId: string; name: string; code: string }[] => {
  const { data } = useDrivers(
    { page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'createdAt', sortDir: 'desc' },
    true,
  );
  // A row with no profile is a person the drivers screen shows as «غير مسجّل»: on the registry,
  // but with nothing recorded — and the server refuses a fine against them, so they are not
  // offered here either.
  const ids = useMemo(
    () => (data?.items ?? []).filter((row) => row.profile !== null).map((row) => row.employeeId),
    [data],
  );
  const records = useEmployeeRecords(ids);
  return useMemo(
    () =>
      ids.map((employeeId) => {
        const employee = records.get(employeeId);
        return {
          employeeId,
          name: employee?.personal.fullNameAr ?? '',
          code: employee?.code ?? '',
        };
      }),
    [ids, records],
  );
};

export const RegistryDriverPicker = ({
  value,
  onChange,
  multiple = false,
  placeholder,
  density,
  className,
}: {
  /** Picked employee ids. A single-pick control still carries a list, of at most one. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Off by default: a fine belongs to ONE driver; the board's filter asks about several. */
  multiple?: boolean;
  placeholder?: string;
  /** Passed straight through — a bar sizing its controls to one rhythm asks for `tight`. */
  density?: ControlDensity;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const drivers = useRecordedDrivers();

  const options = useMemo(
    () =>
      drivers.map((driver) => ({
        value: driver.employeeId,
        label: driverPickLabel(driver),
        shortLabel: driverPickShortLabel(driver),
      })),
    [drivers],
  );

  if (!can('employee.view')) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t('fleet.drivers.pickerNeedsDirectory')}
      </p>
    );
  }

  return (
    <MultiSelect
      label={t('fleet.violations.fields.driver')}
      placeholder={placeholder ?? t('fleet.drivers.filters.employeeShort')}
      options={options}
      value={value}
      // A single-pick control replaces its choice rather than adding to it, which is what «one
      // driver per fine» means — expressed here rather than by a second component.
      onChange={(next) =>
        onChange(multiple ? next : next.slice(-1).filter((id) => id !== undefined))
      }
      showSelectedValues
      chips={multiple}
      // NO `onSearch`, deliberately: the whole registry is already in hand, and `MultiSelect`
      // reads an `onSearch` handler as «the owner narrows this list», which would leave typing
      // showing everything. Omitting it makes the box filter what is here.
      searchThreshold={0}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
