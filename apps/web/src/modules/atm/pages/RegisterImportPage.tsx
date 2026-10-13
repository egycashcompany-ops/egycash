// /atm/register/import — the register workbook import and its settings (spec §8.6). A THIN shell:
// the header carries the title only (no subtitle — page-header-has-no-subtitle.spec.ts), and the
// work lives in `components/register-import/*`: the register settings card, the upload with its
// preview and apply, and the list of previous runs. It reads no URL parameter, so the remembered-
// filters census files it as not filter-capable.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ImportRunsCard } from '../components/register-import/ImportRunsCard';
import { ImportUploadPanel } from '../components/register-import/ImportUploadPanel';
import { RegisterSettingsCard } from '../components/register-import/RegisterSettingsCard';

export const RegisterImportPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('atm.registerImport.title')} />
      <div className="space-y-4">
        <RegisterSettingsCard />
        <ImportUploadPanel />
        <ImportRunsCard />
      </div>
    </PageContainer>
  );
};
