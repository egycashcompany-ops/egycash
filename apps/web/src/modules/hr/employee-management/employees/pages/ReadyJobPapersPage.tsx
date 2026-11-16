// «مستندات الوظائف» under «جاهزون للتعيين»'s bar (A28) — the papers each job prints, by department and
// job, as its own screen rather than a popup. The editor is the contracts module's `JobPapersPanel`.
import { useT } from '../../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { JobPapersPanel } from '../../../contracts/components/JobPapersPanel';

export const ReadyJobPapersPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader
        title={t('contracts.jobPapers.title')}
        breadcrumbs={[
          { label: t('employees.title'), to: '/employees' },
          { label: t('employees.ready.title'), to: '/employees/ready' },
          { label: t('contracts.jobPapers.title') },
        ]}
      />
      <JobPapersPanel />
    </PageContainer>
  );
};
