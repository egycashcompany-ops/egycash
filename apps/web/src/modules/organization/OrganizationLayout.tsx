// Organization module shell: supplies the module's nav + title to the generic AppShell. Every
// org-structure screen renders inside this via the router <Outlet/>.
import { AppShell } from '../../platform/layout/AppShell';
import { organizationNav } from './nav';

export const OrganizationLayout = (): JSX.Element => (
  <AppShell nav={organizationNav} titleKey="organization.title" />
);
