// Performance route subtree (lazy-loaded). Two screens in this phase: the rounds, and the rows a
// round opens.
//
// There is no review DETAIL route, and that is not an omission. A review's page is where an
// evaluator writes an assessment, and the assessment does not exist yet (P4) — a detail screen now
// would be a page showing six fields and no reason to be on it.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { PerformanceCyclesPage } from './pages/PerformanceCyclesPage';
import { PerformanceReviewsPage } from './pages/PerformanceReviewsPage';

export default function PerformanceRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="cycles"
          element={
            <RequirePermission permission="performanceCycle.view">
              <PerformanceCyclesPage />
            </RequirePermission>
          }
        />
        {/*
          Gated by the REVIEW's key, not the cycle's. A round is a company object anybody planning
          one may read; the rows inside it name people, and the two are not the same permission.
          The open/close and assign buttons inside both screens carry `performanceCycle.conduct`.
        */}
        <Route
          path="reviews"
          element={
            <RequirePermission permission="performanceReview.view">
              <PerformanceReviewsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
