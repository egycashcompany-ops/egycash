// «لوحة تحكم الحركة» — which tabs a reader sees, what each tab's badge says, the order of the alert
// lines, and the few display sums the tabs draw. Pure functions over the server's answers.
//
// WHO SEES WHAT (R-28, §5.5). A section exists for a reader only with EVERY key of its gate (the
// data's API key and the linked screen's guard, `FLEET_DASHBOARD_GATES`). A tab is visible while one
// of its sections may still show: permission first, then the DTO's nulls once it has answered. A
// section the server could not compute (`unavailable`) keeps its tab, with an error and a retry.
//
// NOTHING IS COUNTED HERE THAT THE SERVER COUNTED. The alert lines are the server's (`alerts`, count
// > 0 only) plus the custody fund's banner lines, which the browser counts from the custody screen's
// own hooks (D3, the one documented exception). Every other number below is display arithmetic on
// server figures: a share, a ratio, the sum of two parts the card draws side by side.
import {
  FLEET_DASHBOARD_ALERTS,
  FLEET_DASHBOARD_GATES,
  FLEET_DASHBOARD_TABS,
  FLEET_DASHBOARD_TAB_SECTIONS,
  fleetDashboardGateKeys,
  type FleetDashboardAlertDto,
  type FleetDashboardAlertId,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardSection,
  type FleetDashboardTab,
} from '@ecms/contracts';

export interface DashboardAnswers {
  can: (permission: string) => boolean;
  now: FleetDashboardNowDto | undefined;
  period: FleetDashboardPeriodDto | undefined;
}

export type SectionState = 'hidden' | 'pending' | 'shown' | 'failed';

/** The reader holds every key of the section's gate. */
export const sectionPermitted = (
  section: FleetDashboardSection,
  can: (permission: string) => boolean,
): boolean => fleetDashboardGateKeys(section).every((key) => can(key));

export const sectionState = (
  section: FleetDashboardSection,
  answers: DashboardAnswers,
): SectionState => {
  if (!sectionPermitted(section, answers.can)) return 'hidden';
  if (section === 'custodyFund') return 'shown';
  const gate = FLEET_DASHBOARD_GATES[section];
  if (gate.read === 'now') {
    const dto = answers.now;
    if (dto === undefined) return 'pending';
    if ((dto.unavailable as readonly string[]).includes(section)) return 'failed';
    return dto[section as keyof FleetDashboardNowDto] === null ? 'hidden' : 'shown';
  }
  const dto = answers.period;
  if (dto === undefined) return 'pending';
  if ((dto.unavailable as readonly string[]).includes(section)) return 'failed';
  return dto[section as keyof FleetDashboardPeriodDto] === null ? 'hidden' : 'shown';
};

/** The tabs in their bar order, each while one of its sections may still show. */
export const visibleTabs = (answers: DashboardAnswers): FleetDashboardTab[] =>
  FLEET_DASHBOARD_TABS.filter((tab) =>
    FLEET_DASHBOARD_TAB_SECTIONS[tab].some((section) => sectionState(section, answers) !== 'hidden'),
  );

// ── The alert lines (tab 1) ───────────────────────────────────────────────────────────────────

export type AlertCategory = 'cars' | 'drivers' | 'fuel';
export type AlertLineId = FleetDashboardAlertId | 'custody';
export interface AlertLine {
  id: AlertLineId;
  level: 'red' | 'orange';
  count: number;
  category: AlertCategory;
}

/** The filter chips' three families, as the approved sample groups the lines. */
export const ALERT_CATEGORY: Readonly<Record<AlertLineId, AlertCategory>> = {
  maintenanceRed: 'cars',
  vehicleLicenceExpired: 'cars',
  driverLicenceExpired: 'drivers',
  fuelCardExpired: 'fuel',
  crewAbsent: 'drivers',
  fuelRequests: 'fuel',
  fuelLow: 'fuel',
  dealershipPending: 'fuel',
  noticesMissing: 'cars',
  custody: 'fuel',
  noReading: 'cars',
};

/** Display order: the contracts' order, with the custody line after the notices (T1.11). */
const ORDER: readonly AlertLineId[] = FLEET_DASHBOARD_ALERTS.flatMap(
  (alert): AlertLineId[] => (alert.id === 'noticesMissing' ? [alert.id, 'custody'] : [alert.id]),
);

/**
 * The lines that fired: the server's, and the custody line when the fund's banner has any line
 * (`custodyLines` = `useCustodyFundAlerts(...).length`; `null` = the reader has no custody grant).
 */
export const alertLines = (
  alerts: readonly FleetDashboardAlertDto[],
  custodyLines: number | null,
): AlertLine[] => {
  const lines: AlertLine[] = alerts
    .filter((alert) => alert.count > 0)
    .map((alert) => ({ ...alert, category: ALERT_CATEGORY[alert.id] }));
  if (custodyLines !== null && custodyLines > 0) {
    lines.push({ id: 'custody', level: 'orange', count: custodyLines, category: 'fuel' });
  }
  return lines.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
};

export interface AlertSummary {
  total: number;
  red: number;
  orange: number;
  byCategory: Record<AlertCategory, number>;
}

/** How many LINES fired — the badge, the «إجمالي التنبيهات الآن» chip and the filter chips. */
export const alertSummary = (lines: readonly AlertLine[]): AlertSummary => {
  const summary: AlertSummary = {
    total: 0,
    red: 0,
    orange: 0,
    byCategory: { cars: 0, drivers: 0, fuel: 0 },
  };
  for (const line of lines) {
    summary.total += 1;
    summary[line.level] += 1;
    summary.byCategory[line.category] += 1;
  }
  return summary;
};

// ── The tab badges (plan §5.10): each equals a figure its tab shows, and hides with it ────────

export interface TabBadge {
  n: number;
  tone: 'red' | 'amber' | 'plain';
}

export const tabBadges = (
  answers: DashboardAnswers,
  alerts: AlertSummary | null,
): Partial<Record<FleetDashboardTab, TabBadge>> => {
  const { now, period } = answers;
  const badges: Partial<Record<FleetDashboardTab, TabBadge>> = {};
  if (alerts !== null && alerts.total > 0) {
    badges.alerts = { n: alerts.total, tone: alerts.red > 0 ? 'red' : 'amber' };
  }
  if (now?.roster != null) {
    badges.now = { n: now.roster.unmanned, tone: now.roster.unmanned > 0 ? 'amber' : 'plain' };
  }
  if (now?.distributionVehicles != null) {
    badges.distribution = { n: now.distributionVehicles.totals.total, tone: 'plain' };
  }
  const vehicles = now?.licenceVehicles?.expired;
  const drivers = now?.licenceDrivers?.expired;
  if (vehicles !== undefined || drivers !== undefined) {
    const n = (vehicles ?? 0) + (drivers ?? 0);
    badges.licences = { n, tone: n > 0 ? 'red' : 'plain' };
  }
  if (period?.visits != null) badges.maintenance = { n: period.visits.count, tone: 'plain' };
  if (period?.accidents != null) badges.accidents = { n: period.accidents.count, tone: 'plain' };
  return badges;
};

// ── Display arithmetic ────────────────────────────────────────────────────────────────────────

const ONE_DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const TWO_DECIMALS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A part's share of a whole, 0–100; `null` when there is no whole to share. */
export const share = (part: number, whole: number): number | null =>
  whole > 0 ? (part / whole) * 100 : null;

/** «95.2%» — one decimal at most; «—» when there is no whole. */
export const shareText = (part: number, whole: number): string => {
  const value = share(part, whole);
  return value === null ? '—' : `${ONE_DECIMAL.format(value)}%`;
};

/** Drivers per vehicle, two decimals at most («1.29»); «—» with no vehicle. No target (D5-4). */
export const ratioText = (top: number, bottom: number): string =>
  bottom > 0 ? TWO_DECIMALS.format(top / bottom) : '—';

/** The first index holding the largest value, or −1 when every value is zero. */
export const leadIndex = (values: readonly number[]): number => {
  let lead = -1;
  let best = 0;
  values.forEach((value, i) => {
    if (value > best) {
      best = value;
      lead = i;
    }
  });
  return lead;
};

/** The earliest of the server's dates ('YYYY-MM-DD'), or `null` for none. */
export const earliestDay = (days: readonly string[]): string | null =>
  days.length === 0 ? null : [...days].sort()[0] ?? null;

/** 'YYYY-MM-DD' → «2026/10/22», as the boards write a day. */
export const slashDay = (ymd: string): string => ymd.slice(0, 10).replace(/-/gu, '/');

const CAIRO_TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Africa/Cairo',
});
/** «09:12» — when a record was written, on Cairo's clock (R-12). */
export const cairoTime = (iso: string): string => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '—' : CAIRO_TIME.format(at);
};
