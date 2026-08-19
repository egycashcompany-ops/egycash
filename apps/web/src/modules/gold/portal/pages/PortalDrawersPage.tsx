// الأدراج — the drawers holding this customer's metal, counted as THEIRS.
//
// A drawer can hold several owners' bars. The numbers here are this customer's share of it and
// nothing else, which is why the columns say "my bars" and "my weight" — gold's own wording.
import { type GoldPortalDrawerDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { fmtNumber, fmtWeightValue } from '../../lib/gold-format';
import { useGoldPortalDrawers } from '../api/portal-queries';
import { PortalSection } from '../PortalList';

export const PortalDrawersPage = (): JSX.Element => {
  const t = useT();
  const query = useGoldPortalDrawers();

  const columns: Column<GoldPortalDrawerDto>[] = [
    { key: 'drawer', header: t('gold.common.drawer'), render: (r) => r.label },
    { key: 'vault', header: t('gold.common.vault'), render: (r) => r.vaultName ?? '—' },
    {
      key: 'count',
      header: t('gold.portal.drawers.myBars'),
      align: 'end',
      render: (r) => fmtNumber(r.myBarsCount),
    },
    {
      key: 'weight',
      header: t('gold.portal.drawers.myWeight'),
      align: 'end',
      render: (r) => t('gold.common.grams', { value: fmtWeightValue(r.myWeight) }),
    },
  ];

  return (
    <PortalSection
      title={t('gold.portal.tabs.drawers')}
      description={t('gold.portal.drawers.shared')}
    >
      <DataTable
        columns={columns}
        rows={query.data ?? []}
        rowKey={(r) => r.drawerId}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        onRetry={() => {
          void query.refetch();
        }}
        empty={
          <p className="py-8 text-center text-sm text-slate-500">{t('gold.portal.drawers.empty')}</p>
        }
      />
    </PortalSection>
  );
};
