// System Administration shell. The navigation experience (rail + panel + command palette) is a
// single data-driven shell shared across the app, so this just renders it around the router
// <Outlet/> — exactly as the organization module does.
import { AppShell } from '../../platform/layout/AppShell';

export const SystemAdminLayout = (): JSX.Element => <AppShell />;
