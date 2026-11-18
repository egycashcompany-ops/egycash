// «لوحة تحكم الحركة» — which tabs a reader sees, what each tab's badge says, the order of the alert
// lines (the overview's action centre), and the few display sums the tabs draw. Pure functions over
// the server's answers.
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
  const gate = FLEET_DASHBOARD_GATES[section];
  // A screen's own hooks in the browser (the custody board, the supply contracts' summary): shown
  // once permitted — the part draws its own loading and error.
  if (gate.read === 'web') return 'shown';
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
    FLEET_DASHBOARD_TAB_SECTIONS[tab].some(
      (section) => sectionState(section, answers) !== 'hidden',
    ),
  );

// ── The alert lines (the overview's action centre) ────────────────────────────────────────────

export type AlertLineId = FleetDashboardAlertId | 'custody';
export interface AlertLine {
  id: AlertLineId;
  level: 'red' | 'orange';
  count: number;
}

/** Display order: the contracts' order, with the custody line after the notices (T1.11). */
const ORDER: readonly AlertLineId[] = FLEET_DASHBOARD_ALERTS.flatMap((alert): AlertLineId[] =>
  alert.id === 'noticesMissing' ? [alert.id, 'custody'] : [alert.id],
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
    .map((alert) => ({ id: alert.id, level: alert.level, count: alert.count }));
  if (custodyLines !== null && custodyLines > 0) {
    lines.push({ id: 'custody', level: 'orange', count: custodyLines });
  }
  return lines.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
};

export interface AlertSummary {
  total: number;
  red: number;
  orange: number;
}

/** How many LINES fired — the overview's «تنبيهات عاجلة» card and its «عاجل · للمتابعة» tallies. */
export const alertSummary = (lines: readonly AlertLine[]): AlertSummary => {
  const summary: AlertSummary = { total: 0, red: 0, orange: 0 };
  for (const line of lines) {
    summary.total += 1;
    summary[line.level] += 1;
  }
  return summary;
};

// ── The tab badges (plan §5.10): each equals a figure its tab shows, and hides with it ────────

export interface TabBadge {
  n: number;
  tone: 'red' | 'amber' | 'plain';
}

/**
 * «الحركة اليوم» carries the ready cars without a driver today (amber, plain at 0); «الصيانة والورش»
 * the cars that reached the service limit (red, and only when there are some — it hides at 0 and
 * with its section); «التراخيص والتجديدات» the expired car licences plus the expired driver licences
 * (red — its two red KPIs — and only when there are some; a reader with one of the two sections gets
 * that part). «نظرة عامة», «توزيع السيارات», «العدادات والكيلومترات», «الحوادث ومطالبات التأمين»,
 * «المخالفات المرورية والتسويات», «الوقود والمصروفات» and «العهدة» have no count (the approved bar
 * draws none).
 */
export const tabBadges = (
  answers: DashboardAnswers,
): Partial<Record<FleetDashboardTab, TabBadge>> => {
  const { now } = answers;
  const badges: Partial<Record<FleetDashboardTab, TabBadge>> = {};
  if (now?.roster != null) {
    badges.today = { n: now.roster.unmanned, tone: now.roster.unmanned > 0 ? 'amber' : 'plain' };
  }
  const vehicles = now?.licenceVehicles?.expired;
  const drivers = now?.licenceDrivers?.expired;
  const expired = (vehicles ?? 0) + (drivers ?? 0);
  if (expired > 0) badges.licences = { n: expired, tone: 'red' };
  const red = now?.maintenanceAlarm?.red;
  if (red !== undefined && red > 0) badges.maintenance = { n: red, tone: 'red' };
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
  days.length === 0 ? null : ([...days].sort()[0] ?? null);

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
