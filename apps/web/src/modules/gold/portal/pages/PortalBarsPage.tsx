// السبائك — every bar of this customer's metal, wherever it is now.
import { useState } from 'react';
import { type GoldPortalBarDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { type Column } from '../../../../shared/ui/DataTable';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { barStatusLabel, barStatusTone, metalLabel } from '../../components/gold-labels';
import { fmtWeightValue } from '../../lib/gold-format';
import { useGoldPortalBars } from '../api/portal-queries';
import { PORTAL_PAGE_SIZE, PortalList, usePortalPage } from '../PortalList';

export const PortalBarsPage = (): JSX.Element => {
  const t = useT();
  const [page, setPage] = usePortalPage();
  const [search, setSearch] = useState('');
  const query = useGoldPortalBars({
    page,
    pageSize: PORTAL_PAGE_SIZE,
    ...(search === '' ? {} : { search }),
  });

  const columns: Column<GoldPortalBarDto>[] = [
    { key: 'serial', header: t('gold.common.serial'), render: (r) => r.serialNumber },
    { key: 'metal', header: t('gold.common.metalType'), render: (r) => metalLabel(t, r.metalType) },
    { key: 'purity', header: t('gold.common.purity'), render: (r) => r.purity ?? '—' },
    {
      key: 'weight',
      header: t('gold.common.weight'),
      align: 'end',
      render: (r) => t('gold.common.grams', { value: fmtWeightValue(r.weight) }),
    },
    { key: 'vault', header: t('gold.common.vault'), render: (r) => r.vaultName ?? '—' },
    { key: 'drawer', header: t('gold.common.drawer'), render: (r) => r.drawerLabel ?? '—' },
    { key: 'status', header: t('gold.common.status'), render: (r) => <StatusBadge tone={barStatusTone(r.status)} label={barStatusLabel(t, r.status)} /> },
  ];

  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder={t('gold.portal.bars.searchPlaceholder')}
      />
      <PortalList
        title={t('gold.portal.tabs.bars')}
        query={query}
        columns={columns}
        rowKey={(r) => r.id}
        emptyText={t('gold.portal.bars.empty')}
        onPage={setPage}
      />
    </div>
  );
};
