// Payroll route subtree (lazy-loaded). The catalog (PY-1), the runs (PY-6), the employee's own
// payslips (PY-11), the adjustments queue (P-HR-06-A) and the loans administration (P-HR-06-B) —
// and nothing else: no unshipped surface is reachable (the owner rule carried from Fleet FW-1).
// There is no tax route and no run-calculation route, because neither exists.
//
// The last one belongs to another feature's folder on purpose. Lending is its own module — its
// contract, its cache keys and its profile tab all live under `employee-loans/` — but the SCREEN is
// where the money is administered, which is here. So this file mounts it and owns nothing of it.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { EmployeeLoansAdminPage } from '../employee-loans/pages/EmployeeLoansAdminPage';
import { MyLoansPage } from '../employee-loans/pages/MyLoansPage';
import { MyAdjustmentsPage } from './pages/MyAdjustmentsPage';
import { MyPayslipsPage } from './pages/MyPayslipsPage';
import { PayItemsPage } from './pages/PayItemsPage';
import { PayrollAdjustmentsPage } from './pages/PayrollAdjustmentsPage';
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
        {/*
          P-HR-18 — the employee's own loans, and the second route here with no permission, for the
          same reason as the first: the rows are resolved from the caller's login link on the
          server, so there is no wider reach a key could gate. It closes the loop on P-HR-07, which
          told the employee their loan was disbursed and left them nowhere to look.
        */}
        <Route path="employee-loans/me" element={<MyLoansPage />} />
        {/*
          P-HR-19 — the employee's own bonuses and penalties. Third of the own-scope routes, for
          the same reason as the two above it, and it closes the loop on P-HR-07's decision notice.
        */}
        <Route path="adjustments/me" element={<MyAdjustmentsPage />} />
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
        {/*
          P-HR-06 — the queue for a decision P-HR-04 already defined. Gated on `view`, which is the
          key the server requires for the list this screen reads; the approve/reject buttons and
          the navigation row are narrower, on `payrollAdjustment.approve`. Gating the route itself
          on `approve` would hand a `view` holder a screen the API answers, which is the one thing
          a route guard exists to prevent.
        */}
        <Route
          path="adjustments"
          element={
            <RequirePermission permission="payrollAdjustment.view">
              <PayrollAdjustmentsPage />
            </RequirePermission>
          }
        />
        {/*
          P-HR-06-B — the loans administration. Same posture as the queue above it, for the same
          reason: gated on `view`, which is the key the server requires for the list this screen
          reads, while the decide/disburse buttons and the navigation row are on
          `employeeLoan.approve`.
        */}
        <Route
          path="employee-loans"
          element={
            <RequirePermission permission="employeeLoan.view">
              <EmployeeLoansAdminPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
