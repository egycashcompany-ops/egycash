// /atm/register/report — the Data Report (spec §8.5). STUB created by WP-A so the route compiles;
// WP-D owns this file from here. It stays a thin shell: the sections, charts and tables live in
// `components/register-report/*`.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';

export const RegisterReportPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('atm.registerReport.title')} />
    </PageContainer>
  );
};
