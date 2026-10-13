// /atm/register — the efficiency register (spec §8.3). STUB created by WP-A so the route, the
// manifest and the persistence census compile; WP-C owns this file from here and builds the grid,
// the filters and the dialogs into it. It already declares the remembered filters the finished
// page reads, so the census entry (`remembered-filters-coverage.spec.ts`) does not change later.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'bank',
  'status',
  'area',
  'q',
  'issues',
  'sort',
  'size',
] as const;

export const RegisterPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  return (
    <PageContainer>
      <PageHeader title={t('atm.register.title')} />
    </PageContainer>
  );
};
