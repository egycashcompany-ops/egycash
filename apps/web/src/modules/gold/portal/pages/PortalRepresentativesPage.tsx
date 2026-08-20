// المناديب — the customer's own authorised delegates, as we hold them.
//
// This is the customer's own register, shown back to them: they registered these people with us,
// national ids included, which is why those are on this screen and nowhere else on the portal.
import { type GoldPortalRepresentativeDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type Column } from '../../../../shared/ui/DataTable';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { useGoldPortalRepresentatives } from '../api/portal-queries';
import { PORTAL_PAGE_SIZE, PortalList, usePortalPage } from '../PortalList';

export const PortalRepresentativesPage = (): JSX.Element => {
  const t = useT();
  const [page, setPage] = usePortalPage();
  const query = useGoldPortalRepresentatives({ page, pageSize: PORTAL_PAGE_SIZE });

  const columns: Column<GoldPortalRepresentativeDto>[] = [
    { key: 'name', header: t('gold.representatives.fullName'), render: (r) => r.fullName },
    { key: 'nid', header: t('gold.common.nationalId'), render: (r) => r.nationalId ?? '—' },
    { key: 'phone', header: t('gold.representatives.phone'), render: (r) => r.phone ?? '—' },
    { key: 'job', header: t('gold.representatives.jobTitle'), render: (r) => r.jobTitle ?? '—' },
    { key: 'status', header: t('gold.common.status'), render: (r) => (
        <StatusBadge
          tone={r.status === 'active' ? 'success' : 'neutral'}
          label={t(`gold.activeStatus.${r.status}`)}
        />
      ) },
  ];

  return (
    <PortalList
      title={t('gold.portal.tabs.representatives')}
      description={t('gold.portal.representatives.hint')}
      query={query}
      columns={columns}
      rowKey={(r) => r.id}
      emptyText={t('gold.portal.representatives.empty')}
      onPage={setPage}
    />
  );
};
