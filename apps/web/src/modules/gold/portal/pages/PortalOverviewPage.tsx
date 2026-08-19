// نظرة عامة — what the customer has with us right now.
//
// Current inventory and confirmed movement, exactly as gold's overview computed it, restricted to
// this one customer by the server. Nothing here is a projection or an estimate.
import { useT } from '../../../../platform/localization/useT';
import { StatStrip } from '../../../../shared/ui/StatStrip';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { fmtNumber, fmtWeightValue } from '../../lib/gold-format';
import { useGoldPortalOverview } from '../api/portal-queries';
import { PortalSection } from '../PortalList';

export const PortalOverviewPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useGoldPortalOverview();

  if (isLoading) return <LoadingState />;
  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const grams = (value: number): string =>
    t('gold.common.grams', { value: fmtWeightValue(value) });

  return (
    <div className="space-y-6">
      <PortalSection title={t('gold.portal.overview.inventory')}>
        <StatStrip
          items={[
            { key: 'bars', label: t('gold.portal.overview.bars'), value: fmtNumber(data?.totalBars) },
            {
              key: 'drawers',
              label: t('gold.portal.overview.drawers'),
              value: fmtNumber(data?.totalDrawers),
            },
            { key: 'keys', label: t('gold.portal.overview.keys'), value: fmtNumber(data?.keysCount) },
            {
              key: 'delegates',
              label: t('gold.portal.overview.delegates'),
              value: fmtNumber(data?.representativesCount),
            },
          ]}
        />
      </PortalSection>

      <PortalSection title={t('gold.portal.overview.weights')}>
        <StatStrip
          items={[
            {
              key: 'total',
              label: t('gold.portal.overview.totalWeight'),
              value: grams(data?.totalWeight ?? 0),
            },
            {
              key: 'gold',
              label: t('gold.portal.overview.goldWeight'),
              value: grams(data?.goldWeight ?? 0),
            },
            {
              key: 'silver',
              label: t('gold.portal.overview.silverWeight'),
              value: grams(data?.silverWeight ?? 0),
            },
          ]}
        />
      </PortalSection>

      <PortalSection
        title={t('gold.portal.overview.movement')}
        description={t('gold.portal.confirmedOnly')}
      >
        <StatStrip
          items={[
            {
              key: 'receiving',
              label: t('gold.portal.tabs.receiving'),
              value: fmtNumber(data?.receivingCount),
            },
            {
              key: 'delivery',
              label: t('gold.portal.tabs.delivery'),
              value: fmtNumber(data?.deliveryCount),
            },
            {
              key: 'transfers',
              label: t('gold.portal.tabs.transfers'),
              value: fmtNumber(data?.transferCount),
            },
          ]}
        />
      </PortalSection>
    </div>
  );
};
