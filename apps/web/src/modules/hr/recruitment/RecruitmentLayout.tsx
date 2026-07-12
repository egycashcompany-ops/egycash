// Recruitment module shell: supplies the module's nav + title to the generic AppShell. Every
// recruitment screen renders inside this via the router <Outlet/>.
import { AppShell } from '../../../platform/layout/AppShell';
import { recruitmentNav } from './nav';

export const RecruitmentLayout = (): JSX.Element => (
  <AppShell nav={recruitmentNav} titleKey="recruitment.title" />
);
