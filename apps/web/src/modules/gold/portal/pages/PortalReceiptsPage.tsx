// عمليات الدخول / عمليات الخروج — the two receipt registers, which read identically.
//
// Only confirmed documents reach here: a draft is work the vault has not committed to, and a
// customer counting it as theirs would be counting metal that has not moved.
import { type GoldPortalReceiptDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type Column } from '../../../../shared/ui/DataTable';
import { docStatusLabel, docStatusTone } from '../../components/gold-labels';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { fmtDate, fmtNumber, fmtWeightValue } from '../../lib/gold-format';
import { useGoldPortalDelivery, useGoldPortalReceiving } from '../api/portal-queries';
import { PORTAL_PAGE_SIZE, PortalList, usePortalPage } from '../PortalList';

const Receipts = ({ kind }: { kind: 'receiving' | 'delivery' }): JSX.Element => {
  const t = useT();
  const [page, setPage] = usePortalPage();
  const params = { page, pageSize: PORTAL_PAGE_SIZE };
  // Both hooks are called unconditionally — hooks cannot be called in a branch — and the one that
  // is not this tab is disabled by React Query never being asked for it. Splitting the component
  // in two would duplicate the columns for nothing.
  const receiving = useGoldPortalReceiving(params);
  const delivery = useGoldPortalDelivery(params);
  const query = kind === 'receiving' ? receiving : delivery;

  const columns: Column<GoldPortalReceiptDto>[] = [
    { key: 'number', header: t('gold.receiving.number'), render: (r) => r.receiptNumber },
    { key: 'date', header: t('gold.common.date'), render: (r) => fmtDate(r.receiptDate) },
    {
      key: 'rep',
      header: t('gold.keys.holder'),
      render: (r) => r.representativeName ?? '—',
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
      title={t(`gold.portal.tabs.${kind}`)}
      description={t('gold.portal.confirmedOnly')}
      query={query}
      columns={columns}
      rowKey={(r) => r.id}
      emptyText={t(`gold.portal.${kind}.empty`)}
      onPage={setPage}
    />
  );
};

export const PortalReceivingPage = (): JSX.Element => <Receipts kind="receiving" />;
export const PortalDeliveryPage = (): JSX.Element => <Receipts kind="delivery" />;
