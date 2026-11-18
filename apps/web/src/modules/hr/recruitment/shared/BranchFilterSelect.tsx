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
//
// It OFFERS the active branches only. A branch id the address already carries that the active list
// does not hold (a closed branch, arriving with a dashboard «فتح» or a remembered filter) is still
// drawn under its own name from the every-branch names list — «—» for one no list holds any more —
// so the chip never shows a raw id or nothing at all (fleet audit D14).
import { type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { MultiSelect, type MultiSelectOption } from '../../../../shared/ui/MultiSelect';
import { localized } from '../../../../shared/lib/format';
import { useBranchNames, useBranchOptions } from '../../../organization/shared/references';

interface NamedBranch {
  id: string;
  name: LocalizedString;
}

/**
 * The filter's options: the active branches, then each picked id the active list does not offer,
 * named from the every-branch list — «—» when no list holds it any more. Pure, for the spec.
 */
export const branchFilterOptions = (
  active: readonly NamedBranch[],
  everyBranch: readonly NamedBranch[],
  value: readonly string[],
  locale: Locale,
): MultiSelectOption[] => {
  const offered = new Set(active.map((b) => b.id));
  return [
    ...active.map((b) => ({ value: b.id, label: localized(b.name, locale) })),
    ...value
      .filter((id) => !offered.has(id))
      .map((id) => {
        const named = everyBranch.find((b) => b.id === id);
        return { value: id, label: named === undefined ? '—' : localized(named.name, locale) };
      }),
  ];
};

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
  // The every-branch list is read only while a pick is not on the active one.
  const closedPicked = value.some((id) => !branches.some((b) => b.id === id));
  const { data: names = [] } = useBranchNames(closedPicked);
  const options = branchFilterOptions(branches, names, value, locale);

  return (
    <MultiSelect
      clearable={clearable}
      label={t('recruitment.filters.branch')}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
};
