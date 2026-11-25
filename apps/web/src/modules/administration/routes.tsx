// Administrative Affairs route subtree «الشئون الإدارية», lazy-loaded as one chunk from App.tsx —
// the same route-based code splitting every module uses (design §13.4).
//
// OWNER RULE: no placeholder surface is ever reachable. A screen is routed here in the SAME slice
// that ships it and joins the navigation catalog at the same moment; until then its URL falls
// through to the module's 404. P1a.W ships the Phase 1 screens, each route behind the key its
// endpoint takes:
//   /administration                 none (the page decides what to show from the grants)  P1a.W
//   /administration/warehouses      administrationWarehouse.view                          P1a.W
//   /administration/items           administrationItem.view                               P1a.W
//   /administration/items/:id       administrationItem.view   (opened from the register)  P1a.W
//   /administration/catalogs        administrationCatalog.manage                          P1a.W
// Creating and editing a warehouse, an item, a unit or a category are dialogs on the screen, never
// routes (§13.4 rule 2). Every key is this module's own: no route gates on another module's key.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { AdministrationHomePage } from './pages/AdministrationHomePage';
import { CatalogsPage } from './pages/CatalogsPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { ItemsPage } from './pages/ItemsPage';
import { WarehousesPage } from './pages/WarehousesPage';

export default function AdministrationRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<AdministrationHomePage />} />
        <Route
          path="warehouses"
          element={
            <RequirePermission permission="administrationWarehouse.view">
              <WarehousesPage />
            </RequirePermission>
          }
        />
        <Route
          path="items"
          element={
            <RequirePermission permission="administrationItem.view">
              <ItemsPage />
            </RequirePermission>
          }
        />
        <Route
          path="items/:id"
          element={
            <RequirePermission permission="administrationItem.view">
              <ItemDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="catalogs"
          element={
            <RequirePermission permission="administrationCatalog.manage">
              <CatalogsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
