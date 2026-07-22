// Recruitment module home: a permission-aware dashboard into the seven-stage pipeline. A placeholder
// KPI row and recent-activity panel show the dashboard's shape; the quick-access grid links out to
// each stage. Cards the user cannot access are hidden.
import { type ComponentType, type SVGProps } from 'react';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { fullName } from '../../../../shared/lib/format';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../../shared/ui/ModuleHome';
import {
  BadgeIcon,
  ChatIcon,
  ClipboardIcon,
  FileIcon,
  FolderIcon,
  OfferIcon,
  UsersIcon,
} from '../../../../shared/ui/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SHORTCUTS: { to: string; titleKey: string; descKey: string; icon: Icon; permission: string }[] = [
  { to: '/applicants', titleKey: 'recruitment.nav.applicants', descKey: 'recruitment.cards.applicants', icon: UsersIcon, permission: 'applicant.view' },
  { to: '/screening', titleKey: 'recruitment.nav.screening', descKey: 'recruitment.cards.screening', icon: ClipboardIcon, permission: 'screening.view' },
  { to: '/interviews', titleKey: 'recruitment.nav.interviews', descKey: 'recruitment.cards.interviews', icon: ChatIcon, permission: 'interview.view' },
  { to: '/job-offers', titleKey: 'recruitment.nav.offers', descKey: 'recruitment.cards.offers', icon: OfferIcon, permission: 'jobOffer.view' },
  { to: '/employees', titleKey: 'recruitment.nav.employees', descKey: 'recruitment.cards.employees', icon: BadgeIcon, permission: 'employee.view' },
  { to: '/hiring-documents', titleKey: 'recruitment.nav.hiringDocuments', descKey: 'recruitment.cards.hiringDocuments', icon: FileIcon, permission: 'hiringDocuments.view' },
  { to: '/employee-files', titleKey: 'recruitment.nav.employeeFiles', descKey: 'recruitment.cards.employeeFiles', icon: FolderIcon, permission: 'employeeFile.view' },
];

const KPIS: { labelKey: string; icon: Icon; permission: string }[] = [
  { labelKey: 'recruitment.nav.applicants', icon: UsersIcon, permission: 'applicant.view' },
  { labelKey: 'recruitment.nav.interviews', icon: ChatIcon, permission: 'interview.view' },
  { labelKey: 'recruitment.nav.offers', icon: OfferIcon, permission: 'jobOffer.view' },
  { labelKey: 'recruitment.nav.employees', icon: BadgeIcon, permission: 'employee.view' },
];

export const RecruitmentOverview = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const name = me === null ? '' : fullName(me.name, locale);

  const shortcuts = SHORTCUTS.filter((c) => can(c.permission)).map((c) => ({
    to: c.to,
    title: t(c.titleKey),
    description: t(c.descKey),
    icon: c.icon,
  }));
  const kpis = KPIS.filter((k) => can(k.permission)).map((k) => ({ label: t(k.labelKey), icon: k.icon }));

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.overview.title')}
        description={name === '' ? t('recruitment.overview.subtitle') : t('recruitment.overview.welcome', { name })}
      />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={kpis}
        emptyTitle={t('recruitment.overview.noAccessTitle')}
        emptyBody={t('recruitment.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
