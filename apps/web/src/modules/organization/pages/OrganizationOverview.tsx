// Organization landing page: a permission-aware entry grid into the org-structure hierarchy
// (Company → Branches → Departments → Sections) plus the org-wide Job Titles catalog. Cards the
// user cannot access are hidden. This is the foundation every future module reuses.
import { type ComponentType, type SVGProps } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import {
  BuildingIcon,
  ChevronEndIcon,
  LayersIcon,
  SitemapIcon,
  TagIcon,
} from '../../../shared/ui/icons';

interface EntryCard {
  to: string;
  titleKey: string;
  descKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  permission: string;
}

const CARDS: EntryCard[] = [
  { to: '/organization/company', titleKey: 'organization.nav.company', descKey: 'organization.cards.company', icon: BuildingIcon, permission: 'organization.view' },
  { to: '/organization/branches', titleKey: 'organization.nav.branches', descKey: 'organization.cards.branches', icon: BuildingIcon, permission: 'branch.view' },
  { to: '/organization/departments', titleKey: 'organization.nav.departments', descKey: 'organization.cards.departments', icon: SitemapIcon, permission: 'department.view' },
  { to: '/organization/sections', titleKey: 'organization.nav.sections', descKey: 'organization.cards.sections', icon: LayersIcon, permission: 'section.view' },
  { to: '/organization/job-titles', titleKey: 'organization.nav.jobTitles', descKey: 'organization.cards.jobTitles', icon: TagIcon, permission: 'jobTitle.view' },
];

export const OrganizationOverview = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const visible = CARDS.filter((c) => can(c.permission));

  return (
    <PageContainer>
      <PageHeader title={t('organization.overview.title')} description={t('organization.overview.subtitle')} />
      {visible.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title={t('organization.overview.noAccessTitle')} description={t('organization.overview.noAccessBody')} />
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
