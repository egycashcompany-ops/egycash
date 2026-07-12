// Placeholder screen for a recruitment stage whose UI is a later sprint. It exercises the full
// foundation (page frame, breadcrumbs, card, empty state) so each stage screen drops in by
// replacing this element — no layout/routing work required.
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../../shared/ui/Card';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';

export const StagePlaceholder = ({ titleKey }: { titleKey: string }): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader
        title={t(titleKey)}
        description={t('recruitment.placeholder.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t(titleKey) }]}
      />
      <Card>
        <CardBody>
          <EmptyState title={t('recruitment.placeholder.title')} description={t('recruitment.placeholder.body')} />
        </CardBody>
      </Card>
    </PageContainer>
  );
};
