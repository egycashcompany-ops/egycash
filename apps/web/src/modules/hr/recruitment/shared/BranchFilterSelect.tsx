// The recruitment queues' branch filter, in one place: every stage record denormalizes `branchId`
// (it is the field the platform's own→…→organization scoping already keys on), so the control is
// identical everywhere and only the state around it differs.
//
// It renders for EVERY reader of the queue. Its options come from `/platform/branches/options`,
// which is authenticated but not `branch.view`-gated — naming the branches a list is already
// scoped by is not browsing the directory. It used to hide itself without `branch.view`, on the
// reasoning that an empty dropdown filters nothing; but the dropdown is only empty because it was
// fed from the administration LIST, and hiding it left a reader whose grants reach the whole
// company looking at every branch's rows with nothing to narrow them by.
//
// It still only NARROWS. The server scopes the rows under the screen's own grant, so picking a
// branch whose rows the reader may not see returns an empty page, never somebody else's records.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { localized } from '../../../../shared/lib/format';
import { useBranchOptions } from '../../../organization/shared/references';

export const BranchFilterSelect = ({
  value,
  onChange,
  clearable = false,
}: {
  value: readonly string[];
  onChange: (branchIds: string[]) => void;
  /** A ✕ that clears every pick — see `MultiSelect`. Fleet's bars turn it on. */
  clearable?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: branches = [] } = useBranchOptions();

  return (
    <MultiSelect
      clearable={clearable}
      label={t('recruitment.filters.branch')}
      value={value}
      onChange={onChange}
      options={branches.map((b) => ({ value: b.id, label: localized(b.name, locale) }))}
    />
  );
};
