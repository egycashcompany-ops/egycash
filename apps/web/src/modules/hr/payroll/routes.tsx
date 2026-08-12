// Payroll route subtree (lazy-loaded). The catalog (PY-1) and the runs (PY-6) — and nothing else:
// no unshipped surface is reachable (the owner rule carried from Fleet FW-1). There is no payslip
// route, no tax route and no run-calculation route, because none of those exist.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { PayItemsPage } from './pages/PayItemsPage';
import { PayrollRunsPage } from './pages/PayrollRunsPage';

export default function PayrollRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
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
