// FW-1 scaffolding surface: the module's full information architecture is routed and guarded
// from day one, and every screen whose slice has not landed yet renders this honest state —
// no mock data, no fake tables. Each FW slice replaces its routes' element and this page
// disappears with FW-10. The breadcrumb + header already behave exactly like the final page's.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { WrenchIcon } from '../../../shared/ui/icons';

export const PlannedPage = ({
  titleKey,
  slice,
}: {
  /** i18n key of the final page's title, e.g. `fleet.nav.vehicles`. */
  titleKey: string;
  /** The FW slice that delivers this screen, e.g. `FW-3`. */
  slice: string;
}): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader
        title={t(titleKey)}
        breadcrumbs={[{ label: t('fleet.module.title'), to: '/fleet' }, { label: t(titleKey) }]}
      />
      <Card>
        <CardBody>
          <EmptyState
            icon={<WrenchIcon className="h-10 w-10" />}
            title={t('fleet.planned.title')}
            description={t('fleet.planned.body', { slice })}
          />
        </CardBody>
      </Card>
    </PageContainer>
  );
};
