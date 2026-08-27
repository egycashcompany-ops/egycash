// Training route subtree (lazy-loaded). Four screens: the deliveries somebody works daily, the
// requests to attend them, the catalogue behind both, and the permanent records completing a
// session writes.
//
// Attendance and the certificate have no screens of their own, and that is not an omission: both
// are acts ON something that already has one. Marking the room happens inside the session's
// completion roster, and a certificate is attached from the record it belongs to.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { TrainingCoursesPage } from './pages/TrainingCoursesPage';
import { TrainingNominationsPage } from './pages/TrainingNominationsPage';
import { TrainingRecordsPage } from './pages/TrainingRecordsPage';
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
          The queue is gated by `view`, and the DECISION buttons inside it by `decide` — a person
          who may nominate must be able to see what they asked for, and a person who may decide
          sees the same screen with two more buttons on it.
        */}
        <Route
          path="nominations"
          element={
            <RequirePermission permission="trainingNomination.view">
              <TrainingNominationsPage />
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
        {/*
          On `trainingRecord.view` and nothing more. There is no create, edit or delete route here
          because there is none on the server either: a record is written by completing a session,
          and what it says is not revised (D8).
        */}
        <Route
          path="records"
          element={
            <RequirePermission permission="trainingRecord.view">
              <TrainingRecordsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
