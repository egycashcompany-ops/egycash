// The register's own asset names as a filter that takes MORE THAN ONE answer — the asset list's
// «الاسم» and the custody register's «الصنف», right after the category whose names it lists
// («فلتر الأسم يبقي بعد الفئات … والبيانات اللى فى فلتر الفئات هي نفسها تتفلتر بناء على الفئات»).
//
// A pick is always one of the register's names, so the request matches each one exactly. The list
// is typed into whatever its length — it was a box you could type into before it took several
// answers («Drop Down مع قابليه للكتابة»). Until this choice's names arrive it says so, and when
// they could not be read it says THAT, asking again when the reader comes back to it — never that
// no asset has the name being typed.
import { useT } from '../../../platform/localization/useT';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { type CategoryNameFilter } from './useCategoryNameFilter';

export const AssetNameFilter = ({
  filter,
  label,
  placeholder,
  className,
  fullWidth = false,
}: {
  filter: CategoryNameFilter;
  /** What the filter asks — the column's own name. */
  label: string;
  /** What the trigger says while nothing is chosen, where the bar writes the label above it. */
  placeholder?: string;
  className?: string;
  fullWidth?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <div className={className} onFocus={filter.retryNames}>
      <MultiSelect
        clearable
        label={label}
        {...(placeholder === undefined ? {} : { placeholder })}
        // WHICH names, not how many — named on the trigger, each removable from the panel.
        showSelectedValues
        chips
        searchThreshold={0}
        // A model name runs long («Lenovo ThinkCentre neo 50a 24»): room to read it whole.
        panelWidth="w-80"
        options={filter.nameOptions}
        value={filter.names}
        onChange={filter.setNames}
        searching={filter.namesLoading}
        {...(filter.namesFailed ? { emptyText: t('common.error.title') } : {})}
        // The chosen names stay listed while the others load or could not be read — so the list
        // says so above them, rather than looking like all the categories hold.
        {...(filter.namesLoading
          ? { statusText: t('common.loading') }
          : filter.namesFailed
            ? { statusText: t('common.error.title') }
            : {})}
        fullWidth={fullWidth}
        className="w-full"
      />
    </div>
  );
};
