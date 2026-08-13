// Payroll route subtree (lazy-loaded). The catalog (PY-1), the runs (PY-6) and the employee's own
// payslips (PY-11) — and nothing else: no unshipped surface is reachable (the owner rule carried
// from Fleet FW-1). There is no tax route and no run-calculation route, because neither exists.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { MyPayslipsPage } from './pages/MyPayslipsPage';
import { PayItemsPage } from './pages/PayItemsPage';
import { PayrollRunsPage } from './pages/PayrollRunsPage';

export default function PayrollRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/*
          PY-11 — my own payslips, and the ONLY route here with no permission. The rows are
          resolved from the caller's login link on the server, so there is no wider reach a key
          could gate; this is the posture My Attendance already has as its module's index.
        */}
        <Route index element={<MyPayslipsPage />} />
        <Route path="payslips/me" element={<MyPayslipsPage />} />
        <Route
          path="pay-items"
          element={
            <RequirePermission permission="payItem.view">
              <PayItemsPage />
            </RequirePermission>
          }
        />
        <Route
          path="runs"
          element={
            <RequirePermission permission="payrollRun.view">
              <PayrollRunsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
