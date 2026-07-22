// Recruitment module shell: supplies the brand title to the generic AppShell. The sidebar loads its
// navigation from GET /platform/me/applications. Every recruitment screen renders inside this via the
// router <Outlet/>.
import { AppShell } from '../../../platform/layout/AppShell';

export const RecruitmentLayout = (): JSX.Element => <AppShell titleKey="recruitment.title" />;
