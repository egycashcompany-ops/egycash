// The customer portal's route subtree, lazy-loaded as its own chunk.
//
// Its layout element is `PortalShell`, not `AppShell` — which is the whole reason a customer never
// sees an icon rail, a launcher or a command palette over a catalog they hold no permissions for.
// Because AppShell is a route element each module chooses, there is nothing to switch off.
import { Route, Routes } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { PortalShell } from './PortalShell';
import { RequirePortal } from './RequirePortal';
import { PortalOverviewPage } from './pages/PortalOverviewPage';
import { PortalBarsPage } from './pages/PortalBarsPage';
import { PortalDrawersPage } from './pages/PortalDrawersPage';
import { PortalDeliveryPage, PortalReceivingPage } from './pages/PortalReceiptsPage';
import { PortalTransfersPage } from './pages/PortalTransfersPage';
import { PortalKeysPage } from './pages/PortalKeysPage';
import { PortalRepresentativesPage } from './pages/PortalRepresentativesPage';
import { PortalReportsPage } from './pages/PortalReportsPage';

/** A wrong path INSIDE the portal stays inside it — the staff 404 links to a home they cannot open. */
const PortalNotFound = (): JSX.Element => {
  const t = useT();
  return <EmptyState title={t('gold.portal.notFound')} />;
};

export default function GoldPortalRoutes(): JSX.Element {
  return (
    <Routes>
      <Route
        element={
          <RequirePortal>
            <PortalShell />
          </RequirePortal>
        }
      >
        <Route index element={<PortalOverviewPage />} />
        <Route path="bars" element={<PortalBarsPage />} />
        <Route path="drawers" element={<PortalDrawersPage />} />
        <Route path="receiving" element={<PortalReceivingPage />} />
        <Route path="delivery" element={<PortalDeliveryPage />} />
        <Route path="transfers" element={<PortalTransfersPage />} />
        <Route path="keys" element={<PortalKeysPage />} />
        <Route path="representatives" element={<PortalRepresentativesPage />} />
        <Route path="reports" element={<PortalReportsPage />} />
        <Route path="*" element={<PortalNotFound />} />
      </Route>
    </Routes>
  );
}
