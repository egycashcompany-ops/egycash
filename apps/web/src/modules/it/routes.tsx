// IT module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based code
// splitting every module uses.
//
// OWNER RULE (carried from the Fleet FW-1 review): no placeholder surface is ever reachable. A
// screen is routed here in the SAME slice that ships it and joins the navigation catalog at the
// same moment; until then its URL falls through to the standard 404. ITW-1 ships the IT-1
// surface, each route behind its §7 permission:
//   /it                    any IT grant (the page itself decides what to show)  ITW-1
//   /it/assets             itAsset.view                                          ITW-1
//   /it/assets/scan        itAsset.view                                          ITW-1
//   /it/assets/:id         itAsset.view                                          ITW-1
//   /it/catalogs           itCatalog.manage                                      ITW-1
//   /it/vendors            itVendor.view                                         ITW-1
// Custody, tickets, maintenance, software and dashboards get their routes with IT-2…IT-6.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { ItHomePage } from './pages/ItHomePage';
import { AssetsListPage } from './pages/AssetsListPage';
import { AssetDetailPage } from './pages/AssetDetailPage';
import { AssetScanPage } from './pages/AssetScanPage';
import { ItCatalogsPage } from './pages/ItCatalogsPage';
import { VendorsPage } from './pages/VendorsPage';

export default function ItRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ItHomePage />} />
        <Route
          path="assets"
          element={
            <RequirePermission permission="itAsset.view">
              <AssetsListPage />
            </RequirePermission>
          }
        />
        {/* Before ':id' so the literal segment is not swallowed by the id matcher. */}
        <Route
          path="assets/scan"
          element={
            <RequirePermission permission="itAsset.view">
              <AssetScanPage />
            </RequirePermission>
          }
        />
        <Route
          path="assets/:id"
          element={
            <RequirePermission permission="itAsset.view">
              <AssetDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="catalogs"
          element={
            <RequirePermission permission="itCatalog.manage">
              <ItCatalogsPage />
            </RequirePermission>
          }
        />
        <Route
          path="vendors"
          element={
            <RequirePermission permission="itVendor.view">
              <VendorsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
