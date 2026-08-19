// Gold module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based code
// splitting every module uses.
//
// The routes ARE the gold system's own sidebar, minus the four screens ECMS already owns: users,
// roles, branches and the audit log. Each one is behind the permission its screen enforces, so the
// menu never offers a page that then refuses:
//   /gold                    goldReport.view      لوحة التحكم
//   /gold/vaults             goldVault.view       الخزائن
//   /gold/vault-settings     goldVault.edit       إعدادات الخزائن
//   /gold/bars               goldBar.view         السبائك
//   /gold/receiving          goldReceiving.view   عمليات الدخول
//   /gold/delivery           goldDelivery.view    عمليات الخروج
//   /gold/transfers          goldTransfer.view    عمليات التحويل
//   /gold/keys               goldKey.view         المفاتيح
//   /gold/companies          goldCompany.view     الشركات والصناديق
//   /gold/representatives    goldRepresentative.view  المندوبون
//   /gold/reports            goldReport.view      التقارير
//   /gold/portal-accounts    goldPortalAccount.view  حسابات بوابة العملاء
//
// The receipt, delivery, transfer and key ACTIONS are not routes — they are dialogs on the record,
// which is where the decision is actually taken. That is how the gold system worked too.
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { GoldDashboardPage } from './pages/GoldDashboardPage';
import { GoldVaultsBoardPage } from './pages/GoldVaultsBoardPage';
import { GoldVaultSettingsPage } from './pages/GoldVaultSettingsPage';
import { GoldBarsPage } from './pages/GoldBarsPage';
import { GoldReceivingPage } from './pages/GoldReceivingPage';
import { GoldDeliveryPage } from './pages/GoldDeliveryPage';
import { GoldTransfersPage } from './pages/GoldTransfersPage';
import { GoldKeysPage } from './pages/GoldKeysPage';
import { GoldCompaniesPage } from './pages/GoldCompaniesPage';
import { GoldRepresentativesPage } from './pages/GoldRepresentativesPage';
import { GoldReportsPage } from './pages/GoldReportsPage';
import { GoldPortalAccountsPage } from './pages/GoldPortalAccountsPage';

export default function GoldRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          index
          element={
            <RequirePermission permission="goldReport.view">
              <GoldDashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="vaults"
          element={
            <RequirePermission permission="goldVault.view">
              <GoldVaultsBoardPage />
            </RequirePermission>
          }
        />
        <Route
          path="vault-settings"
          element={
            <RequirePermission permission="goldVault.edit">
              <GoldVaultSettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="bars"
          element={
            <RequirePermission permission="goldBar.view">
              <GoldBarsPage />
            </RequirePermission>
          }
        />
        <Route
          path="receiving"
          element={
            <RequirePermission permission="goldReceiving.view">
              <GoldReceivingPage />
            </RequirePermission>
          }
        />
        <Route
          path="delivery"
          element={
            <RequirePermission permission="goldDelivery.view">
              <GoldDeliveryPage />
            </RequirePermission>
          }
        />
        <Route
          path="transfers"
          element={
            <RequirePermission permission="goldTransfer.view">
              <GoldTransfersPage />
            </RequirePermission>
          }
        />
        <Route
          path="keys"
          element={
            <RequirePermission permission="goldKey.view">
              <GoldKeysPage />
            </RequirePermission>
          }
        />
        <Route
          path="companies"
          element={
            <RequirePermission permission="goldCompany.view">
              <GoldCompaniesPage />
            </RequirePermission>
          }
        />
        <Route
          path="representatives"
          element={
            <RequirePermission permission="goldRepresentative.view">
              <GoldRepresentativesPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="goldReport.view">
              <GoldReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="portal-accounts"
          element={
            <RequirePermission permission="goldPortalAccount.view">
              <GoldPortalAccountsPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
