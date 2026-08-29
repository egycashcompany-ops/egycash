// Medical route subtree (lazy-loaded). Two screens: the records list, and the employee's own.
//
// M3 (medical events) and M4 (insurance) have no routes here yet, and a spec asserts they do not:
// a row or a route for either would lead to a screen that does not exist, and the fastest way for
// that to happen is somebody adding it while the API is in flight.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { MedicalProfilesPage } from './pages/MedicalProfilesPage';
import { MyMedicalPage } from './pages/MyMedicalPage';
import { InsuranceCardsPage } from './pages/InsuranceCardsPage';

export default function MedicalRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/*
          D5 — self-service, and deliberately NOT wrapped in `RequirePermission`. Gating your own
          health record behind `medicalRecord.view` would mean you could read it only if you could
          also read everybody's, which is the opposite of what that key is for.
        */}
        <Route path="me" element={<MyMedicalPage />} />
        {/*
          D3 — and this one IS gated, on the medical key alone. Not `employee.view`: a line manager
          who may read somebody's personnel file may not read their blood type.
        */}
        <Route
          path="profiles"
          element={
            <RequirePermission permission="medicalRecord.view">
              <MedicalProfilesPage />
            </RequirePermission>
          }
        />
        {/*
          M4 — its OWN key, not the clinical one. The card is scoped by branch because benefits
          administration is delegable (D4); gating it on `medicalRecord.view` would mean delegating
          it hands out clinical access, and whoever files a card number could read conditions.
        */}
        <Route
          path="insurance"
          element={
            <RequirePermission permission="medicalInsurance.view">
              <InsuranceCardsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
