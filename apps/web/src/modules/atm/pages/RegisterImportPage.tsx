// /atm/register/import — the register workbook import and its settings (spec §8.6). STUB created
// by WP-A so the route compiles; WP-B owns this file from here. It stays a thin shell: the settings
// card, the upload, the preview and the runs live in `components/register-import/*`.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';

export const RegisterImportPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('atm.registerImport.title')} />
    </PageContainer>
  );
};
