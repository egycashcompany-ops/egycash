// Recruitment route subtree (lazy-loaded as one chunk — route-based code splitting per
// Software Architecture §6). The layout route provides the shell; every stage route is
// permission-gated and renders its real screen — all seven recruitment stages are now built
// (Applicants → … → Hiring Documents). Employees + Employee Files moved to the
// employee-management module (frozen Employee design). Default export so React.lazy can import it.
import { Outlet, Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { RecruitmentLayout } from './RecruitmentLayout';
import { RecruitmentOverview } from './pages/RecruitmentOverview';
import { ApplicantsListPage } from './applicants/pages/ApplicantsListPage';
import { RecruitmentFormPage } from './recruitment-form/pages/RecruitmentFormPage';
import { ApplicantSourcesPage } from './applicant-sources/pages/ApplicantSourcesPage';
import { ApplicantDetailPage } from './applicants/pages/ApplicantDetailPage';
import { ApplicantFormPage } from './applicants/pages/ApplicantFormPage';
import { ScreeningQueuePage } from './screening/pages/ScreeningQueuePage';
import { ScreeningDetailPage } from './screening/pages/ScreeningDetailPage';
import { InterviewQueuePage } from './interviews/pages/InterviewQueuePage';
import { InterviewDetailPage } from './interviews/pages/InterviewDetailPage';
import { InterviewStagesPage } from './interviews/pages/InterviewStagesPage';
import { InterviewStageQueuePage } from './interviews/pages/InterviewStageQueuePage';
import { EvaluationQueuePage } from './evaluations/pages/EvaluationQueuePage';
import { EvaluationDetailPage } from './evaluations/pages/EvaluationDetailPage';
import { EvaluationPhasesPage } from './evaluations/pages/EvaluationPhasesPage';
import { EvaluationPhaseQueuePage } from './evaluations/pages/EvaluationPhaseQueuePage';
import { EvaluationBatchesPage } from './evaluation-batches/pages/EvaluationBatchesPage';
import { EvaluationBatchDetailPage } from './evaluation-batches/pages/EvaluationBatchDetailPage';
import { JobOffersListPage } from './job-offers/pages/JobOffersListPage';
import { JobOfferDetailPage } from './job-offers/pages/JobOfferDetailPage';
import { JobOfferFormPage } from './job-offers/pages/JobOfferFormPage';
import { HiringDocsListPage } from './hiring-documents/pages/HiringDocsListPage';
import { HiringDocsDetailPage } from './hiring-documents/pages/HiringDocsDetailPage';

export default function RecruitmentRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<RecruitmentLayout />}>
        <Route index element={<RecruitmentOverview />} />
        <Route
          path="recruitment-form"
          element={
            <RequirePermission permission="recruitmentForm.manage">
              <RecruitmentFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="applicant-sources"
          element={
            <RequirePermission permission="applicant.view">
              <ApplicantSourcesPage />
            </RequirePermission>
          }
        />
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
          <Route
            path="stages"
            element={
              <RequirePermission permission="interviewStage.manage">
                <InterviewStagesPage />
              </RequirePermission>
            }
          />
          {/* One page per interview stage (RW11) — the flat stage menu opens these. */}
          <Route path="stage/:stageId" element={<InterviewStageQueuePage />} />
          <Route path=":id" element={<InterviewDetailPage />} />
        </Route>
        <Route
          path="evaluations"
          element={
            <RequirePermission permission="evaluation.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<EvaluationQueuePage />} />
          <Route
            path="phases"
            element={
              <RequirePermission permission="evaluationPhase.manage">
                <EvaluationPhasesPage />
              </RequirePermission>
            }
          />
          {/* One page per evaluation phase (RW6a) — independent phases, independent pages. */}
          <Route path="phase/:phaseId" element={<EvaluationPhaseQueuePage />} />
          <Route path=":id" element={<EvaluationDetailPage />} />
        </Route>
        {/* Security / Driving batches (RW8) — the group form of the external checks. Sight is
            per phase (RW7), so the pages authorize themselves rather than gating the subtree on
            one permission. */}
        <Route path="evaluation-batches">
          <Route index element={<EvaluationBatchesPage />} />
          <Route path=":id" element={<EvaluationBatchDetailPage />} />
        </Route>
        <Route
          path="job-offers"
          element={
            <RequirePermission permission="jobOffer.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<JobOffersListPage />} />
          <Route
            path="new"
            element={
              <RequirePermission permission="jobOffer.create">
                <JobOfferFormPage mode="create" />
              </RequirePermission>
            }
          />
          <Route path=":id" element={<JobOfferDetailPage />} />
          <Route
            path=":id/edit"
            element={
              <RequirePermission permission="jobOffer.edit">
                <JobOfferFormPage mode="revise" />
              </RequirePermission>
            }
          />
        </Route>
        <Route
          path="hiring-documents"
          element={
            <RequirePermission permission="hiringDocuments.view">
              <Outlet />
            </RequirePermission>
          }
        >
          <Route index element={<HiringDocsListPage />} />
          <Route path=":id" element={<HiringDocsDetailPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
