// Organization module home: a permission-aware dashboard into the org-structure hierarchy
// (Company → Branches → Departments → Sections → Job Positions → Job Titles) and the platform catalog
// (Applications, Application Categories). A placeholder KPI row and recent-activity panel show the
// dashboard's shape; cards the user cannot access are hidden.
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../shared/ui/ModuleHome';
import {
  BadgeIcon,
  BuildingIcon,
  FolderIcon,
  LayersIcon,
  SitemapIcon,
  TagIcon,
} from '../../../shared/ui/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SHORTCUTS: { to: string; titleKey: string; descKey: string; icon: Icon; permission: string }[] = [
  { to: '/organization/company', titleKey: 'organization.nav.company', descKey: 'organization.cards.company', icon: BuildingIcon, permission: 'organization.view' },
  { to: '/organization/branches', titleKey: 'organization.nav.branches', descKey: 'organization.cards.branches', icon: BuildingIcon, permission: 'branch.view' },
  { to: '/organization/departments', titleKey: 'organization.nav.departments', descKey: 'organization.cards.departments', icon: SitemapIcon, permission: 'department.view' },
  { to: '/organization/sections', titleKey: 'organization.nav.sections', descKey: 'organization.cards.sections', icon: LayersIcon, permission: 'section.view' },
  { to: '/organization/job-positions', titleKey: 'organization.nav.jobPositions', descKey: 'organization.cards.jobPositions', icon: BadgeIcon, permission: 'jobPosition.view' },
  { to: '/organization/job-titles', titleKey: 'organization.nav.jobTitles', descKey: 'organization.cards.jobTitles', icon: TagIcon, permission: 'jobTitle.view' },
  { to: '/organization/applications', titleKey: 'organization.nav.applications', descKey: 'organization.cards.applications', icon: FolderIcon, permission: 'application.view' },
  { to: '/organization/application-categories', titleKey: 'organization.nav.applicationCategories', descKey: 'organization.cards.applicationCategories', icon: TagIcon, permission: 'applicationCategory.view' },
];

const KPIS: { labelKey: string; icon: Icon; permission: string }[] = [
  { labelKey: 'organization.nav.branches', icon: BuildingIcon, permission: 'branch.view' },
  { labelKey: 'organization.nav.departments', icon: SitemapIcon, permission: 'department.view' },
  { labelKey: 'organization.nav.sections', icon: LayersIcon, permission: 'section.view' },
  { labelKey: 'organization.nav.jobPositions', icon: BadgeIcon, permission: 'jobPosition.view' },
];

export const OrganizationOverview = (): JSX.Element => {
  const t = useT();
  const can = useCan();

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
        title={t('organization.overview.title')}
        description={t('organization.overview.subtitle')}
      />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={kpis}
        emptyTitle={t('organization.overview.noAccessTitle')}
        emptyBody={t('organization.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
