// /atm/settings — «إعدادات الصراف الآلي»: the two things about ATM that are one fact for the
// whole company, so both sit behind `atmSettings.manage` (organization scope on the server):
//   · the Banque Misr maintenance mailbox the central reader polls, and the branches it files
//     mail for — switched on one at a time, Mohandessin first (the owner, 2026-10-28);
//   · the branches that work as one in ATM — October as Mohandessin.
// A THIN shell, as the register import page is: the header carries the title only
// (page-header-has-no-subtitle.spec.ts) and the work lives in `components/settings/*`. It reads no
// URL parameter, so the remembered-filters census files it as not filter-capable.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { BranchLinksCard } from '../components/settings/BranchLinksCard';
import { MailboxSettingsCard } from '../components/settings/MailboxSettingsCard';

export const AtmSettingsPage = (): JSX.Element => {
  const t = useT();
  return (
    <PageContainer>
      <PageHeader title={t('atm.settings.title')} />
      <div className="space-y-4">
        <MailboxSettingsCard />
        <BranchLinksCard />
      </div>
    </PageContainer>
  );
};
