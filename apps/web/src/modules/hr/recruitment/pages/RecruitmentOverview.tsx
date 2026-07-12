// Recruitment landing page: a permission-aware entry grid into the seven-stage pipeline. Not
// the Applicants screen — it reuses the foundation (page frame, cards, permission gating) and
// links out to each stage. Cards the user cannot access are hidden.
import { type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { fullName } from '../../../../shared/lib/format';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../../shared/ui/Card';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import {
  BadgeIcon,
  ChatIcon,
  ChevronEndIcon,
  ClipboardIcon,
  FileIcon,
  FolderIcon,
  OfferIcon,
  UsersIcon,
} from '../../../../shared/ui/icons';

interface StageCard {
  to: string;
  titleKey: string;
  descKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  permission: string;
}

const CARDS: StageCard[] = [
  { to: '/applicants', titleKey: 'recruitment.nav.applicants', descKey: 'recruitment.cards.applicants', icon: UsersIcon, permission: 'applicant.view' },
  { to: '/screening', titleKey: 'recruitment.nav.screening', descKey: 'recruitment.cards.screening', icon: ClipboardIcon, permission: 'screening.view' },
  { to: '/interviews', titleKey: 'recruitment.nav.interviews', descKey: 'recruitment.cards.interviews', icon: ChatIcon, permission: 'interview.view' },
  { to: '/job-offers', titleKey: 'recruitment.nav.offers', descKey: 'recruitment.cards.offers', icon: OfferIcon, permission: 'jobOffer.view' },
  { to: '/employees', titleKey: 'recruitment.nav.employees', descKey: 'recruitment.cards.employees', icon: BadgeIcon, permission: 'employee.view' },
  { to: '/hiring-documents', titleKey: 'recruitment.nav.hiringDocuments', descKey: 'recruitment.cards.hiringDocuments', icon: FileIcon, permission: 'hiringDocuments.view' },
  { to: '/employee-files', titleKey: 'recruitment.nav.employeeFiles', descKey: 'recruitment.cards.employeeFiles', icon: FolderIcon, permission: 'employeeFile.view' },
];

export const RecruitmentOverview = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const name = me === null ? '' : fullName(me.name, locale);
  const visible = CARDS.filter((c) => can(c.permission));

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.overview.title')}
        description={name === '' ? t('recruitment.overview.subtitle') : t('recruitment.overview.welcome', { name })}
      />
      {visible.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title={t('recruitment.overview.noAccessTitle')} description={t('recruitment.overview.noAccessBody')} />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => {
            const Icon = c.icon;
            return (
              <Link key={c.to} to={c.to} className="group focus:outline-none">
                <Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-brand-500">
                  <CardBody className="flex items-start gap-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                      <Icon className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 font-medium text-slate-800 dark:text-slate-100">
                        {t(c.titleKey)}
                        <ChevronEndIcon className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t(c.descKey)}</p>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
};
