// Payroll route subtree (lazy-loaded). PY-1 routes the pay-item catalog and nothing else — no
// unshipped surface is reachable (the owner rule carried from Fleet FW-1).
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { PayItemsPage } from './pages/PayItemsPage';

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
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
