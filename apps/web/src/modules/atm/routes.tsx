// ATM module route subtree, lazy-loaded as one chunk from App.tsx — the same route-based code
// splitting every module uses.
//
// OWNER RULE (inherited from Fleet FW-1): no placeholder surface is ever reachable. Every route
// here shipped with its screen in the ATM Operations port. Live routes, each behind its
// permission (port doc §7.2):
//   /atm/replenishments        atmReplenishment.view   (legacy /atm_replenishment)
//   /atm/replenishments/done   atmReplenishment.view   (legacy /atm_replenishment_done)
//   /atm/maintenance           atmMaintenance.view     (legacy /atm_maintenance)
//   /atm/maintenance/done      atmMaintenance.view     (legacy /atm_maintenance_done)
//   /atm/mail-tickets          atmMailTicket.view      (legacy /mail_maintenance)
//   /atm/mail-tickets/log      atmMailTicket.viewLog   (legacy /mail_maintenance_log)
//   /atm/machines              atmMachine.view         (legacy /all_atm)
//   /atm/data-edit             atmMachine.manage       (legacy /data_edit_atm)
import { Route, Routes } from 'react-router-dom';
import { RequirePermission } from '../../platform/router/RequirePermission';
import { NotFoundPage } from '../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../platform/layout/AppShell';
import { AtmOverviewPage } from './pages/AtmOverviewPage';
import { ReplenishmentsPage } from './pages/ReplenishmentsPage';
import { ReplenishmentsDonePage } from './pages/ReplenishmentsDonePage';
import { MaintenancePage } from './pages/MaintenancePage';
import { MaintenanceDonePage } from './pages/MaintenanceDonePage';
import { MailTicketsPage } from './pages/MailTicketsPage';
import { MailLogPage } from './pages/MailLogPage';
import { MachinesPage } from './pages/MachinesPage';
import { DataEditPage } from './pages/DataEditPage';

export default function AtmRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<AtmOverviewPage />} />
        <Route
          path="replenishments"
          element={
            <RequirePermission permission="atmReplenishment.view">
              <ReplenishmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="replenishments/done"
          element={
            <RequirePermission permission="atmReplenishment.view">
              <ReplenishmentsDonePage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance"
          element={
            <RequirePermission permission="atmMaintenance.view">
              <MaintenancePage />
            </RequirePermission>
          }
        />
        <Route
          path="maintenance/done"
          element={
            <RequirePermission permission="atmMaintenance.view">
              <MaintenanceDonePage />
            </RequirePermission>
          }
        />
        <Route
          path="mail-tickets"
          element={
            <RequirePermission permission="atmMailTicket.view">
              <MailTicketsPage />
            </RequirePermission>
          }
        />
        <Route
          path="mail-tickets/log"
          element={
            <RequirePermission permission="atmMailTicket.viewLog">
              <MailLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="machines"
          element={
            <RequirePermission permission="atmMachine.view">
              <MachinesPage />
            </RequirePermission>
          }
        />
        <Route
          path="data-edit"
          element={
            <RequirePermission permission="atmMachine.manage">
              <DataEditPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
