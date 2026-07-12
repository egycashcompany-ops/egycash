// Recruitment route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). The layout route provides the shell; each stage route is
// permission-gated and currently renders the shared placeholder (its real screen lands in a
// later sprint). Default export so React.lazy can import it.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { RecruitmentLayout } from './RecruitmentLayout';
import { RecruitmentOverview } from './pages/RecruitmentOverview';
import { StagePlaceholder } from './pages/StagePlaceholder';

const stage = (permission: string, titleKey: string): JSX.Element => (
  <RequirePermission permission={permission}>
    <StagePlaceholder titleKey={titleKey} />
  </RequirePermission>
);

export default function RecruitmentRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<RecruitmentLayout />}>
        <Route index element={<RecruitmentOverview />} />
        <Route path="applicants/*" element={stage('applicant.view', 'recruitment.nav.applicants')} />
        <Route path="screening/*" element={stage('screening.view', 'recruitment.nav.screening')} />
        <Route path="interviews/*" element={stage('interview.view', 'recruitment.nav.interviews')} />
        <Route path="job-offers/*" element={stage('jobOffer.view', 'recruitment.nav.offers')} />
        <Route path="employees/*" element={stage('employee.view', 'recruitment.nav.employees')} />
        <Route path="hiring-documents/*" element={stage('hiringDocuments.view', 'recruitment.nav.hiringDocuments')} />
        <Route path="employee-files/*" element={stage('employeeFile.view', 'recruitment.nav.employeeFiles')} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
