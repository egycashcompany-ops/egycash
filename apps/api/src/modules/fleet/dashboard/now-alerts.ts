// Tab 1 «التنبيهات» — the alert lines, DERIVED LAST from the section values (plan §5.2).
//
// No alert has a query of its own: each line is one figure a section already computed, so the line
// and the tab that shows the same figure cannot disagree, and a section the reader may not see (or
// that failed) simply has no line. Order = `FLEET_DASHBOARD_ALERTS` (red first); a line fires only
// when its count is above zero. The custody line (T1.11) is added by the browser from the custody
// screen's own banner (D3) — never here.
import {
  FLEET_DASHBOARD_ALERTS,
  type FleetDashboardAlertDto,
  type FleetDashboardAlertId,
  type FleetDashboardNowDto,
} from '@ecms/contracts';

/** The sections the alerts read — exactly the ones `FLEET_DASHBOARD_ALERTS` names. */
export type AlertSources = Pick<
  FleetDashboardNowDto,
  | 'maintenanceAlarm'
  | 'licenceVehicles'
  | 'licenceDrivers'
  | 'fuelCards'
  | 'roster'
  | 'fuelCharging'
  | 'dealershipPending'
  | 'notices'
  | 'noReading'
>;

/** Each line's figure, or `null` when its section is absent. */
const FIGURE: Record<FleetDashboardAlertId, (s: AlertSources) => number | null> = {
  // T1.1 — cars at or over the red threshold (of which overdue is the line's sub-figure).
  maintenanceRed: (s) => s.maintenanceAlarm?.red ?? null,
  // T1.2 — active cars whose licence expired on or before today (R-02).
  vehicleLicenceExpired: (s) => s.licenceVehicles?.expired ?? null,
  // T1.3 — seat-holders whose licence expired on or before today.
  driverLicenceExpired: (s) => s.licenceDrivers?.expired ?? null,
  // T1.4 — fuel cards expired on or before today.
  fuelCardExpired: (s) => s.fuelCards?.expired ?? null,
  // T1.6 — ready cars with a crew gap whose reason is an ABSENCE (التمامات / leave), R-06.
  crewAbsent: (s) => s.roster?.crewGap.vehicles ?? null,
  // T1.7 — pending balance requests.
  fuelRequests: (s) => s.fuelCharging?.requested.count ?? null,
  // T1.8 — cards below the yellow line (below red is the sub-figure).
  fuelLow: (s) => s.fuelCharging?.low.belowYellow ?? null,
  // T1.9 — dealership rows still waiting for an amount.
  dealershipPending: (s) => s.dealershipPending?.rows ?? null,
  // T1.10 — open notices missing ANY attachment, each once (D16): never the two parts added.
  noticesMissing: (s) => s.notices?.missingAny ?? null,
  // T1.12 — active cars with no reading for N days. The never-read cars are its own sub-line and
  // are never mixed into the count (R-07).
  noReading: (s) => (s.noReading === null ? null : s.noReading.stale.length),
};

export const deriveNowAlerts = (sources: AlertSources): FleetDashboardAlertDto[] =>
  FLEET_DASHBOARD_ALERTS.flatMap((line) => {
    const count = FIGURE[line.id](sources);
    return count === null || count <= 0 ? [] : [{ id: line.id, level: line.level, count }];
  });
