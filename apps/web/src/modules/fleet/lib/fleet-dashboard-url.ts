// «لوحة تحكم الحركة» — the address bar is the dashboard's only state (plan §5.4, D14):
//
//   /fleet?tab=<tab>&period=<preset>&from&to&type=<id,…>&operation=<id,…>&vehicleCodes=<code,…>
//
// `tab` names the panel and is never remembered (a link names its tab). The rest is ONE filter state
// shared by «أرقام الفترة» and the period parts of «الصيانة والورش», «العدادات والكيلومترات»,
// «الحوادث ومطالبات التأمين», «المخالفات المرورية والتسويات», «الوقود والمصروفات», «العهدة» and
// «التراخيص والتجديدات» (each draws the filter bar — «التراخيص والتجديدات» its period choices only):
// switching tabs keeps it (it stays in the address bar), the R1 tabs ignore it, and only R2's query
// key carries it. Of it, only type / operation / codes are remembered across visits; the period
// opens on «هذا الشهر» on every visit (DECISIONS §0c). The overview and «توزيع السيارات» read «هذا
// الشهر» apart, with no page filter at all (the month card; the km by branch). «توزيع السيارات»,
// «الصيانة والورش», «العدادات والكيلومترات» (`km`), «الحوادث ومطالبات التأمين» (`accidents`) and
// «التراخيص والتجديدات» (`licences`) were rebuilt under their own keys, so an old link to any of them
// opens the new body — no entry in LEGACY_TABS for them; «المخالفات المرورية والتسويات»
// (`violations`), «الوقود والمصروفات» (`fuel`) and «العهدة» (`custody`) are new tabs with no old key.
import {
  FLEET_DASHBOARD_DEFAULT_PRESET,
  FLEET_DASHBOARD_MAX_CUSTOM_DAYS,
  FLEET_DASHBOARD_PRESETS,
  daysBetweenYmd,
  isYmd,
  type FleetDashboardPeriodQuery,
  type FleetDashboardPreset,
  type FleetDashboardTab,
} from '@ecms/contracts';
import { LINK_CODES_CAP } from './fleet-dashboard-links';

export interface PeriodFilters {
  preset: FleetDashboardPreset;
  /** 'YYYY-MM-DD' — read only with `custom` ('' otherwise). */
  from: string;
  to: string;
  typeIds: string[];
  operationIds: string[];
  vehicleCodes: string[];
}

const list = (raw: string | null): string[] =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

const isPreset = (raw: string | null): raw is FleetDashboardPreset =>
  raw !== null && (FLEET_DASHBOARD_PRESETS as readonly string[]).includes(raw);

/** The filters as the address bar holds them: an unknown preset reads as the default one. */
export const readPeriodFilters = (sp: Pick<URLSearchParams, 'get'>): PeriodFilters => {
  const preset = isPreset(sp.get('period'))
    ? (sp.get('period') as FleetDashboardPreset)
    : FLEET_DASHBOARD_DEFAULT_PRESET;
  return {
    preset,
    from: preset === 'custom' ? (sp.get('from') ?? '') : '',
    to: preset === 'custom' ? (sp.get('to') ?? '') : '',
    typeIds: list(sp.get('type')),
    operationIds: list(sp.get('operation')),
    vehicleCodes: list(sp.get('vehicleCodes')),
  };
};

/**
 * The URL patch for a new filter state — every filter param named, so a cleared one is removed. The
 * default preset leaves `period` out (a clean address), and `from`/`to` travel only with `custom`.
 */
export const periodFiltersPatch = (next: PeriodFilters): Record<string, string | null> => {
  const custom = next.preset === 'custom';
  const join = (values: readonly string[]): string | null =>
    values.length === 0 ? null : values.join(',');
  return {
    period: next.preset === FLEET_DASHBOARD_DEFAULT_PRESET ? null : next.preset,
    from: custom && next.from !== '' ? next.from : null,
    to: custom && next.to !== '' ? next.to : null,
    type: join(next.typeIds),
    operation: join(next.operationIds),
    vehicleCodes: join(next.vehicleCodes),
  };
};

/** A custom range the server accepts: two real days, in order, at most 366 days. */
export const customRangeValid = (from: string, to: string): boolean =>
  isYmd(from) &&
  isYmd(to) &&
  from <= to &&
  daysBetweenYmd(from, to) + 1 <= FLEET_DASHBOARD_MAX_CUSTOM_DAYS;

/**
 * R2's query. A custom range the server would refuse (half typed, turned round, too long) asks for
 * the default period instead of an error; the filter bar shows the range the server echoes back.
 */
export const toPeriodQuery = (f: PeriodFilters): FleetDashboardPeriodQuery => {
  const lists = {
    ...(f.typeIds.length === 0 ? {} : { typeIds: f.typeIds.slice(0, LINK_CODES_CAP) }),
    ...(f.operationIds.length === 0
      ? {}
      : { operationIds: f.operationIds.slice(0, LINK_CODES_CAP) }),
    ...(f.vehicleCodes.length === 0
      ? {}
      : { vehicleCodes: f.vehicleCodes.slice(0, LINK_CODES_CAP) }),
  };
  if (f.preset === 'custom') {
    return customRangeValid(f.from, f.to)
      ? { preset: 'custom', from: f.from, to: f.to, ...lists }
      : { preset: FLEET_DASHBOARD_DEFAULT_PRESET, ...lists };
  }
  return { preset: f.preset, ...lists };
};

/**
 * The retired tabs' keys and the tab that took their content (plan D1): an old link to «التنبيهات»
 * opens «نظرة عامة», one to «الحركة الآن» opens «الحركة اليوم», and one to «ترتيب السيارات» opens
 * «العدادات والكيلومترات» (its top 5 and bottom 5 live there now).
 */
export const LEGACY_TABS: ReadonlyMap<string, FleetDashboardTab> = new Map<
  string,
  FleetDashboardTab
>([
  ['alerts', 'overview'],
  ['now', 'today'],
  ['ranking', 'km'],
]);

/** The panel to show: the asked one (an old key mapped first) when visible, else the first visible. */
export const readTab = (
  raw: string | null,
  visible: readonly FleetDashboardTab[],
): FleetDashboardTab => {
  const wanted = raw === null ? null : (LEGACY_TABS.get(raw) ?? raw);
  const asked = visible.find((tab) => tab === wanted);
  return asked ?? visible[0] ?? 'overview';
};
