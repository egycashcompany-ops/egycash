// «مستندات مطلوبة للتعيين» — the documents required for hiring.
//
// A placeholder on purpose: the tab exists in the settings bar so its place is reserved, and what
// it will configure has not been decided yet. Build the screen here when it is.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/states/EmptyState';

export const HiringRequirementsPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('hr.settings.tab.hiring-requirements')} />
      <Card>
        <CardBody>
          <EmptyState title={t('hr.settings.hiringRequirements.empty')} />
        </CardBody>
      </Card>
    </PageContainer>
  );
};
