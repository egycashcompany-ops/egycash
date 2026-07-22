// Organization module navigation — the sidebar contribution for the org-structure admin. Items are
// gated by the same permission their backend endpoints require (UX only). The first section carries
// the overview plus a cross-link back to the Recruitment module (until a top-level app switcher
// lands). Order follows the hierarchy Company → Branch → Department → Section, with the org-wide
// Job Titles catalog last.
import { type NavSection } from '../../platform/navigation/nav';
import {
  BadgeIcon,
  BuildingIcon,
  HomeIcon,
  LayersIcon,
  SitemapIcon,
  TagIcon,
  UsersIcon,
} from '../../shared/ui/icons';

export const organizationNav: NavSection[] = [
  {
    items: [
      { to: '/organization', labelKey: 'organization.nav.overview', icon: HomeIcon, end: true },
      { to: '/', labelKey: 'organization.nav.recruitment', icon: UsersIcon, end: true },
    ],
  },
  {
    titleKey: 'organization.nav.structure',
    items: [
      { to: '/organization/company', labelKey: 'organization.nav.company', icon: BuildingIcon, permission: 'organization.view' },
      { to: '/organization/branches', labelKey: 'organization.nav.branches', icon: BuildingIcon, permission: 'branch.view' },
      { to: '/organization/departments', labelKey: 'organization.nav.departments', icon: SitemapIcon, permission: 'department.view' },
      { to: '/organization/sections', labelKey: 'organization.nav.sections', icon: LayersIcon, permission: 'section.view' },
      { to: '/organization/job-positions', labelKey: 'organization.nav.jobPositions', icon: BadgeIcon, permission: 'jobPosition.view' },
      { to: '/organization/job-titles', labelKey: 'organization.nav.jobTitles', icon: TagIcon, permission: 'jobTitle.view' },
    ],
  },
];
