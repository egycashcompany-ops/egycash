// «مين السائق؟» answered from the DRIVERS REGISTRY, the same way every other screen asks it.
//
// This is `DriverPickerFilter` with the driving seats already resolved, because a fine is filed
// against a DRIVER and «driver» has exactly one meaning in this module: whoever holds a seat whose
// job title requires a driving test. The server agrees — `recordDriverBatch` asks the same
// question — so everyone offered here can be filed against, and nobody who could be filed against
// is missing.
//
// WHY IT IS NOT A JOINED-AGAINST LIST. The first version of this control read one page of
// `/fleet/drivers` (capped at `MAX_PAGE_SIZE`, 100) and filtered it in the browser. That fixed the
// reported error — the picker stopped offering people the server refused — and bought a worse
// one in its place: on a fleet of more than a hundred drivers the hundred-and-first was
// unpickable, unsearchable, and indistinguishable from not existing, which is the same silent cap
// that had already broken the drivers filter bar once. It also named every option by employee id
// until a hundred separate HR reads came back.
//
// The search belongs on the SERVER, and HR's own `search` covers the name and the employee code
// in one parameter — which is exactly the question this control asks.
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { type ControlDensity } from '../../../shared/ui/form';
import { useDrivingJobTitles } from '../../hr/recruitment/job-offers/api/job-offer-queries';
import { DriverPickerFilter } from './DriverPickerFilter';

export const RegistryDriverPicker = ({
  value,
  onChange,
  multiple = false,
  placeholder,
  density,
  fullWidth = false,
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
  /** Fill the width this control was given — see `MultiSelect`. */
  fullWidth?: boolean;
  className?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  // The seats the registry is made of. Without `jobTitle.view` this is never asked and stays
  // empty, which the picker reads as «do not narrow» — the same degradation the drivers screen
  // makes, rather than an empty list a reader would read as «this company has no drivers».
  const { data: drivingTitles } = useDrivingJobTitles(can('jobTitle.view'));
  const jobTitleIds = (drivingTitles ?? []).map((title) => title.id);

  return (
    <DriverPickerFilter
      value={value}
      // A single-pick control REPLACES its choice rather than adding to it, which is what «one
      // driver per fine» means — expressed here rather than by a second component.
      onChange={(next) => onChange(multiple ? next : next.slice(-1))}
      jobTitleIds={jobTitleIds}
      placeholder={placeholder ?? t('fleet.drivers.filters.employeeShort')}
      fullWidth={fullWidth}
      {...(density === undefined ? {} : { density })}
      {...(className === undefined ? {} : { className })}
    />
  );
};
