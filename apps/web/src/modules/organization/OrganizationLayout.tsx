// Organization module shell. The navigation experience (rail + panel + command palette) is a single
// data-driven shell shared across the app, so this just renders it around the router <Outlet/>.
import { AppShell } from '../../platform/layout/AppShell';

export const OrganizationLayout = (): JSX.Element => <AppShell />;
