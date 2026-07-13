// Recruitment route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). The layout route provides the shell; each stage route is
// permission-gated and currently renders the shared placeholder (its real screen lands in a
// later sprint). Default export so React.lazy can import it.
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { RecruitmentLayout } from './RecruitmentLayout';
import { RecruitmentOverview } from './pages/RecruitmentOverview';
import { StagePlaceholder } from './pages/StagePlaceholder';
import { ApplicantsListPage } from './applicants/pages/ApplicantsListPage';
import { ApplicantDetailPage } from './applicants/pages/ApplicantDetailPage';
import { ApplicantFormPage } from './applicants/pages/ApplicantFormPage';
import { ScreeningQueuePage } from './screening/pages/ScreeningQueuePage';
import { ScreeningDetailPage } from './screening/pages/ScreeningDetailPage';
import { InterviewQueuePage } from './interviews/pages/InterviewQueuePage';
import { InterviewDetailPage } from './interviews/pages/InterviewDetailPage';

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
        <Route
          path="applicants"
          element={
            <RequirePermission permission="applicant.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<ApplicantsListPage />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="applicant.create">
                <ApplicantFormPage mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<ApplicantDetailPage />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="applicant.edit">
                <ApplicantFormPage mode="edit" />
              </RequirePermission>
            }
          />
        </Route>
        <Route
          path="screening"
          element={
            <RequirePermission permission="screening.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<ScreeningQueuePage />} />
          <Route path=":id" element={<ScreeningDetailPage />} />
        </Route>
        <Route
          path="interviews"
          element={
            <RequirePermission permission="interview.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<InterviewQueuePage />} />
          <Route path=":id" element={<InterviewDetailPage />} />
        </Route>
        <Route path="job-offers/*" element={stage('jobOffer.view', 'recruitment.nav.offers')} />
        <Route path="employees/*" element={stage('employee.view', 'recruitment.nav.employees')} />
        <Route path="hiring-documents/*" element={stage('hiringDocuments.view', 'recruitment.nav.hiringDocuments')} />
        <Route path="employee-files/*" element={stage('employeeFile.view', 'recruitment.nav.employeeFiles')} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
