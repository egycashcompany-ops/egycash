// المفاتيح — which of this customer's delegates holds a drawer key, and which have come back.
import { type GoldPortalKeyDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type Column } from '../../../../shared/ui/DataTable';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { fmtDate } from '../../lib/gold-format';
import { useGoldPortalKeys } from '../api/portal-queries';
import { PORTAL_PAGE_SIZE, PortalList, usePortalPage } from '../PortalList';

export const PortalKeysPage = (): JSX.Element => {
  const t = useT();
  const [page, setPage] = usePortalPage();
  const query = useGoldPortalKeys({ page, pageSize: PORTAL_PAGE_SIZE });

  const columns: Column<GoldPortalKeyDto>[] = [
    { key: 'vault', header: t('gold.common.vault'), render: (r) => r.vaultName ?? '—' },
    { key: 'drawer', header: t('gold.common.drawer'), render: (r) => r.drawerLabel ?? '—' },
    {
      key: 'holder',
      header: t('gold.keys.holder'),
      render: (r) => r.representativeName ?? '—',
    },
    { key: 'status', header: t('gold.common.status'), render: (r) =>
        r.status === 'active' ? (
          <StatusBadge tone="success" label={t('gold.keys.statusActive')} />
        ) : (
          <StatusBadge tone="neutral" label={t('gold.keys.statusReturned')} />
        ) },
    { key: 'handover', header: t('gold.keys.handoverDate'), render: (r) => fmtDate(r.handoverDate) },
    {
      key: 'returned',
      header: t('gold.keys.returnDate'),
      render: (r) => (r.returnDate === null ? '—' : fmtDate(r.returnDate)),
    },
  ];

  return (
    <PortalList
      title={t('gold.portal.tabs.keys')}
      query={query}
      columns={columns}
      rowKey={(r) => r.id}
      emptyText={t('gold.portal.keys.empty')}
      onPage={setPage}
    />
  );
};
