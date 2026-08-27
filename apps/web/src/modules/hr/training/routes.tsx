// Training route subtree (lazy-loaded). Two screens and nothing else: the deliveries somebody
// works daily, and the catalogue behind them.
//
// No nominations route, no enrollment route, no certificate route — those are T3 and T4, and a
// route to an unbuilt screen is the owner rule carried from Fleet FW-1: nothing unshipped is
// reachable.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { TrainingCoursesPage } from './pages/TrainingCoursesPage';
import { TrainingSessionsPage } from './pages/TrainingSessionsPage';

export default function TrainingRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="sessions"
          element={
            <RequirePermission permission="trainingSession.view">
              <TrainingSessionsPage />
            </RequirePermission>
          }
        />
        {/*
          The catalogue is gated by the key that ADMINISTERS it. Reading a course is not gated on
          the server — somebody scheduling a delivery must be able to pick one — but this SCREEN is
          administration, and offering it to somebody who cannot save anything would be a page of
          disabled buttons.
        */}
        <Route
          path="courses"
          element={
            <RequirePermission permission="trainingCourse.manage">
              <TrainingCoursesPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
