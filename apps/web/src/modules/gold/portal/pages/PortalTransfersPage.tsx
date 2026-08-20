// التحويلات — ownership moving, in or out.
//
// A transfer touches two customers, so it appears for both — each of them seeing it from their own
// side, with the other party named and nothing else about them.
import { type GoldPortalTransferDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type Column } from '../../../../shared/ui/DataTable';
import { docStatusLabel, docStatusTone } from '../../components/gold-labels';
import { Badge, StatusBadge } from '../../../../shared/ui/Badge';
import { fmtDate, fmtNumber, fmtWeightValue } from '../../lib/gold-format';
import { useGoldPortalTransfers } from '../api/portal-queries';
import { PORTAL_PAGE_SIZE, PortalList, usePortalPage } from '../PortalList';

export const PortalTransfersPage = (): JSX.Element => {
  const t = useT();
  const [page, setPage] = usePortalPage();
  const query = useGoldPortalTransfers({ page, pageSize: PORTAL_PAGE_SIZE });

  const columns: Column<GoldPortalTransferDto>[] = [
    { key: 'number', header: t('gold.transfers.number'), render: (r) => r.transferNumber },
    { key: 'date', header: t('gold.common.date'), render: (r) => fmtDate(r.transferDate) },
    {
      key: 'direction',
      header: t('gold.portal.transfers.direction'),
      render: (r) => (
        <Badge tone={r.direction === 'in' ? 'success' : 'warning'}>
          {t(`gold.portal.transfers.${r.direction}`)}
        </Badge>
      ),
    },
    {
      key: 'counterparty',
      header: t('gold.portal.transfers.counterparty'),
      render: (r) => r.counterpartyName ?? '—',
    },
    {
      key: 'bars',
      header: t('gold.reports.barsCount'),
      align: 'end',
      render: (r) => fmtNumber(r.barsCount),
    },
    {
      key: 'weight',
      header: t('gold.common.weight'),
      align: 'end',
      render: (r) => t('gold.common.grams', { value: fmtWeightValue(r.totalWeight) }),
    },
    { key: 'status', header: t('gold.common.status'), render: (r) => <StatusBadge tone={docStatusTone(r.status)} label={docStatusLabel(t, r.status)} /> },
  ];

  return (
    <PortalList
      title={t('gold.portal.tabs.transfers')}
      description={t('gold.portal.confirmedOnly')}
      query={query}
      columns={columns}
      rowKey={(r) => r.id}
      emptyText={t('gold.portal.transfers.empty')}
      onPage={setPage}
    />
  );
};
