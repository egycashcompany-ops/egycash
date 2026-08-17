// Operations module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based
// code splitting every module uses.
//
// OWNER RULE (inherited from Fleet FW-1): no placeholder surface is ever reachable by an end user.
// A screen is routed here in the SAME slice that ships it and joins the module home at the same
// moment; until then its URL falls through to the standard 404. Live routes, each behind its
// design §16.2 permission:
//   /operations/shipments  operationsShipment.view    B2  (legacy /main_ops)
//   /operations/catalogs   operationsCatalog.manage   B1  (legacy /data_edit)
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { OperationsOverviewPage } from './pages/OperationsOverviewPage';
import { CatalogsPage } from './pages/CatalogsPage';
import { DailyOperationsPage } from './pages/DailyOperationsPage';

export default function OperationsRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OperationsOverviewPage />} />
        <Route
          path="shipments"
          element={
            <RequirePermission permission="operationsShipment.view">
              <DailyOperationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="catalogs"
          element={
            <RequirePermission permission="operationsCatalog.manage">
              <CatalogsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
