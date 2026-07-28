// The recruitment queues' branch filter, in one place: every stage record denormalizes `branchId`
// (it is the field the platform's own→…→organization scoping already keys on), so the control is
// identical everywhere and only the state around it differs.
//
// It renders NOTHING without `branch.view`. The catalog is a separate permission from the queue
// itself, so a user who can see the queue but not the directory would otherwise get an empty
// dropdown that silently filters nothing — and adding the filter must not change who can read what.
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { Select } from '../../../../shared/ui/form';
import { localized } from '../../../../shared/lib/format';
import { useBranches } from '../job-offers/api/job-offer-queries';

export const BranchFilterSelect = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (branchId: string) => void;
}): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const allowed = can('branch.view');
  const { data: branches = [] } = useBranches(allowed);

  if (!allowed) return null;

  return (
    <Select
      aria-label={t('recruitment.filters.branch')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-auto"
    >
      <option value="">{t('recruitment.filters.allBranches')}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {localized(b.name, locale)}
        </option>
      ))}
    </Select>
  );
};
