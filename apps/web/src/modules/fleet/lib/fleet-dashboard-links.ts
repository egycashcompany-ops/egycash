// «لوحة تحكم الحركة» — ONE builder for the link behind every figure of the dashboard's tabs (plan R-28,
// unified.md §6.2): «نظرة عامة» · «الحركة اليوم» · «توزيع السيارات» · «الصيانة والورش» ·
// «العدادات والكيلومترات» · «الحوادث ومطالبات التأمين» · «المخالفات المرورية والتسويات» ·
// «الوقود والمصروفات» and the three old tabs («أرقام الفترة» · «ملخصات» · «التراخيص»). A
// figure on the dashboard opens the screen that shows the same number: this file knows each screen's OWN
// parameter names and fills them from the server's echo only — `today`, the `range` of a period, the
// `vehicleScope` filters, the active `branchId` and the reader's `scopeBranches` — never from the
// browser clock and never from a list the browser assembled.
//
// THREE RULES THE LINK CENSUS HOLDS IT TO:
//   · NO BARE LIST LINK. A list screen opened without a query restores the reader's remembered
//     filters, so it would show another number. Every list link names at least one parameter. The
//     exceptions are not lists: a record (`/fleet/vehicles/:id`), and the two screens that keep no
//     filter to remember — «لوحة تحكم العهدة» and «مطابقة أرصدة الكروت» (`PATH_ONLY` below).
//   · FILTERS TRAVEL AS FILTERS. A type, an operation or a branch goes as `type` / `operation` /
//     `branch` — never turned into a list of codes, so a 60-car type still has its link. The branch
//     is the switcher's branch when it names one, else the reader's own branches (one, or «كل فروعي»
//     as `branch=a,b`), else none — the whole company (plan D12).
//   · A FIGURE WITH NO EXACT LIST HAS NO LINK. The builder returns `null` (the named exceptions,
//     unified.md §8.2), and the tab shows the figure as plain text.
//
// A TAB LINK (`tabLink`) opens another tab of this page with the page's own filters as they stand
// (`period/from/to/type/operation/vehicleCodes`) — never a period of its own — and is `null` when the
// reader cannot see that tab. The one exception is a figure read over a slice of its OWN (the
// overview's «هذا الشهر», no page filter): its tab link names that slice from the read's echo
// (`echoTabFilters`), so the tab opens on the same number.
import {
  FLEET_LICENCE_GREY_DAYS,
  addDaysYmd,
  type FleetDashboardNowAlarmDto,
  type FleetDashboardNowFuelCardRowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardTab,
  type FleetDashboardVehicleScopeDto,
  type FleetDealershipWorkKind,
} from '@ecms/contracts';

/** A figure's link: where it goes, and which figure it is (`data-metric="<section>.<field>"`). */
export interface DashLink {
  to: string;
  metric: string;
}

type Param = string | number | boolean | readonly string[] | null | undefined;

/** A comma list stays readable (`type=a,b`), and so does a sort's colon (`employeeCode:asc`); everything
 *  else is encoded. Empty values are dropped. */
const query = (params: Record<string, Param>): string => {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      parts.push(`${key}=${raw.map((v: string) => encodeURIComponent(v)).join(',')}`);
      continue;
    }
    parts.push(`${key}=${encodeURIComponent(String(raw)).replace(/%3A/gu, ':')}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};

/**
 * A list screen's link. `screen` is the route under `/fleet` («vehicles», «fuel-cards/charging»):
 * this file names SCREENS for the browser to open, never an API endpoint — the registry's API is
 * reached only through `api/fleet-api.ts`.
 */
const at = (screen: string, params: Record<string, Param>, metric: string): DashLink => ({
  to: `/fleet/${screen}${query(params)}`,
  metric,
});

/** The screens a link may name without a query: they read no parameter and remember none. */
export const PATH_ONLY: readonly string[] = [
  '/fleet/custody/dashboard',
  '/fleet/fuel-cards/reconcile',
];

/** The cap every screen's `vehicleCodes` takes (`vehicleCodesQuery`, 50). */
export const LINK_CODES_CAP = 50;

/** A list of cars as a `vehicleCodes` link, or `null` when it is empty or over the screens' cap. */
const codesOrNull = (codes: readonly string[]): readonly string[] | null =>
  codes.length === 0 || codes.length > LINK_CODES_CAP ? null : codes;

/** T1.11 / T5.6–T5.9 — the custody dashboard has no filters: its link is its path (no R1 needed). */
export const custodyDashboardLink = (metric: string): DashLink => ({
  to: '/fleet/custody/dashboard',
  metric,
});

/** The page's own filter params — the ones a tab link carries over as they stand (plan D15). */
export const TAB_LINK_PARAMS = [
  'period',
  'from',
  'to',
  'type',
  'operation',
  'vehicleCodes',
] as const;

/** The page filters a tab link names, by their address-bar names. */
export type TabLinkFilters = Partial<Record<(typeof TAB_LINK_PARAMS)[number], string>>;

/**
 * The page filters an R2 read was asked over, from its OWN echo (`range`, `vehicleScope`) — for the
 * tab link of a figure that read a slice of its own rather than the page's (the overview's «هذا
 * الشهر»): the tab then opens on exactly what the figure counted.
 */
export const echoTabFilters = (
  dto: Pick<FleetDashboardPeriodDto, 'range' | 'vehicleScope'>,
): TabLinkFilters => {
  const own: TabLinkFilters = { period: dto.range.preset };
  if (dto.range.preset === 'custom') {
    own.from = dto.range.from;
    own.to = dto.range.to;
  }
  const { typeIds, operationIds, vehicleCodes } = dto.vehicleScope;
  if (typeIds.length > 0) own.type = typeIds.join(',');
  if (operationIds.length > 0) own.operation = operationIds.join(',');
  if (vehicleCodes.length > 0) own.vehicleCodes = vehicleCodes.join(',');
  return own;
};

/**
 * A link to another tab of this page (`/fleet?tab=<tab>`), keeping the page's filters exactly as the
 * address bar holds them — never a period of its own — or `null` when the reader cannot see `tab`.
 * `own` replaces the page's filters with a figure's own slice (`echoTabFilters`): every filter it
 * does not name is left off, so the page's period, type or codes never ride along.
 */
export const tabLink = (
  tab: FleetDashboardTab,
  metric: string,
  sp: Pick<URLSearchParams, 'get'>,
  visible: readonly FleetDashboardTab[],
  own?: TabLinkFilters,
): DashLink | null => {
  if (!visible.includes(tab)) return null;
  const params: Record<string, Param> = { tab };
  for (const name of TAB_LINK_PARAMS) params[name] = own === undefined ? sp.get(name) : own[name];
  return { to: `/fleet${query(params)}`, metric };
};

/**
 * The branch a company+set figure covers (plan D12): the switcher's branch when the echo names one,
 * else the reader's own branches, else `null` — the
 * whole company. A reader whose branch grant holds no branch (`[]`) gets no param: the screens
 * narrow that reader to nothing by the same rule, so the list still shows the figure's zero.
 */
const branchOf = (
  branchId: string | null,
  scopeBranches: readonly { id: string }[] | null | undefined,
): string | readonly string[] | null =>
  branchId ?? (scopeBranches == null ? null : scopeBranches.map((b) => b.id));

// ── The R1 tabs: today and the reader's branches ─────────────────────────────────────────────────

export interface NowEcho {
  /** Cairo today, as R1 echoes it. */
  today: string;
  /** The active branch (X-Active-Branch), as R1 echoes it — set only inside the reader's branches. */
  branchId: string | null;
  /** The branches the figures cover: `null` = the whole company, one, or several («كل فروعي»). */
  scopeBranches: readonly { id: string }[] | null;
}

/** The roster's five reasons a driver is not available today («غير المتاحين»), its own order. */
const UNAVAILABLE_ALL = [
  'profileInactive',
  'notEmployed',
  'fleetUnavailability',
  'hrLeave',
  'licenceExpired',
] as const;

export const nowLinks = ({ today, branchId, scopeBranches }: NowEcho) => {
  /** `{br}` — the figures' branch (plan D12), on the screens that read `branch`. */
  const br = { branch: branchOf(branchId, scopeBranches) };
  const licence = (metric: string, from: string | null, before: string) =>
    at('vehicles', { status: 'active', licExpFrom: from, licExpBefore: before }, metric);
  const driverLicence = (metric: string, from: string | null, before: string) =>
    at('drivers', { licExpFrom: from, licExpBefore: before, ...br }, metric);
  const roster = (metric: string, extra: Record<string, Param>) =>
    at('roster', { date: today, ...extra }, metric);
  return {
    // «نظرة عامة» — the action centre (the retired «التنبيهات» lines).
    /** T1.1: the alarms board, narrowed to the branch's cars when a branch is chosen (D19). */
    alarm: (level: 'red' | 'yellow', codes: readonly string[] | null): DashLink | null => {
      if (codes === null) return at('maintenance-alarms', { level }, `maintenanceAlarm.${level}`);
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('maintenance-alarms', { level, vehicleCodes: narrowed }, `maintenanceAlarm.${level}`);
    },
    /** «فتح» on a row of «إنذارات الصيانة بالكيلومتر»: the alarms board on that one car. */
    alarmRow: (level: 'red' | 'yellow', code: string): DashLink =>
      at('maintenance-alarms', { level, vehicleCodes: [code] }, 'maintenanceAlarm.row'),
    /**
     * «كل إنذارات الصيانة (N)», N = red + yellow: the alarms board on both levels. Under a branch, the
     * branch's cars by code — only when every level that has cars sent its codes (a level over the
     * cap comes back `[]`) and the two together fit the screens' cap; else no link (the count stands).
     */
    alarmsAll: (alarm: FleetDashboardNowAlarmDto): DashLink | null => {
      const level = ['red', 'yellow'] as const;
      if (alarm.codes === null) return at('maintenance-alarms', { level }, 'maintenanceAlarm.all');
      const { red, yellow } = alarm.codes;
      if ((alarm.red > 0 && red.length === 0) || (alarm.yellow > 0 && yellow.length === 0)) {
        return null;
      }
      const narrowed = codesOrNull([...new Set([...red, ...yellow])]);
      return narrowed === null
        ? null
        : at('maintenance-alarms', { level, vehicleCodes: narrowed }, 'maintenanceAlarm.all');
    },
    /** T1.2 / T4.1: expired = on or before today (R-02). */
    vehicleLicencesExpired: (): DashLink => licence('licenceVehicles.expired', null, today),
    /** T4.2: today+1 … today+W. */
    vehicleLicencesExpiring: (warnDays: number): DashLink =>
      licence('licenceVehicles.expiring', addDaysYmd(today, 1), addDaysYmd(today, warnDays)),
    /** T4.3: today+W+1 … today+60 (empty, so no link, when W ≥ 60). */
    vehicleLicencesSoon: (warnDays: number): DashLink | null =>
      warnDays >= FLEET_LICENCE_GREY_DAYS
        ? null
        : licence(
            'licenceVehicles.soon',
            addDaysYmd(today, warnDays + 1),
            addDaysYmd(today, FLEET_LICENCE_GREY_DAYS),
          ),
    /** T4.4 «+N»: every active car expired or expiring up to today+60. */
    vehicleLicencesWithin60: (): DashLink =>
      licence('licenceVehicles.more', null, addDaysYmd(today, FLEET_LICENCE_GREY_DAYS)),
    vehicle: (vehicleId: string, metric: string): DashLink => ({
      to: `/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
      metric,
    }),
    /** T1.3 / T4.5. */
    driverLicencesExpired: (): DashLink => driverLicence('licenceDrivers.expired', null, today),
    driverLicencesExpiring: (warnDays: number): DashLink =>
      driverLicence('licenceDrivers.expiring', addDaysYmd(today, 1), addDaysYmd(today, warnDays)),
    driverLicencesSoon: (warnDays: number): DashLink | null =>
      warnDays >= FLEET_LICENCE_GREY_DAYS
        ? null
        : driverLicence(
            'licenceDrivers.soon',
            addDaysYmd(today, warnDays + 1),
            addDaysYmd(today, FLEET_LICENCE_GREY_DAYS),
          ),
    /** «بلا تاريخ» (D18). «غير مسجّلين» has no list (named exception): no builder. */
    driverLicencesNotRecorded: (): DashLink =>
      at('drivers', { licExp: 'none', ...br }, 'licenceDrivers.notRecorded'),
    /**
     * T1.4. The fuel cards follow the branch of each card's CURRENT car (plan D10): every fuel link
     * carries the figures' branch, which the cards and charging screens read (a card on no car is in
     * no branch, so it is listed in the company view only — as it is counted).
     */
    fuelCardsExpired: (): DashLink =>
      at('fuel-cards', { expiresBefore: today, ...br }, 'fuelCards.expired'),
    /** T4.7: today+1 … today+N, expired cards excluded. */
    fuelCardsExpiring: (warnDays: number): DashLink =>
      at(
        'fuel-cards',
        { expiresFrom: addDaysYmd(today, 1), expiresBefore: addDaysYmd(today, warnDays), ...br },
        'fuelCards.expiring',
      ),
    /**
     * «كروت تحتاج متابعة» foot «كل ما ينتهي خلال N يومًا»: every card expired or expiring up to
     * today+N (the table's expiry states, expired ones included).
     */
    fuelCardsDue: (warnDays: number): DashLink =>
      at(
        'fuel-cards',
        { expiresBefore: addDaysYmd(today, warnDays), ...br },
        'fuelCardList.expiry',
      ),
    /**
     * «فتح» on a row of «كروت تحتاج متابعة» (plan D17) — never the branch (a card on no car is in
     * none): a card on no car, or on a car deleted since (the screens find live cars only by code),
     * opens the cards list by its full number; a card led by an expiry state opens the cards list on
     * its car and company; a card led by a balance or a request opens the charging screen on them.
     */
    fuelCardRow: (row: FleetDashboardNowFuelCardRowDto): DashLink => {
      if (row.vehicleId === null || row.code === null || row.vehicleDeleted) {
        return at('fuel-cards', { number: row.number }, 'fuelCardList.row');
      }
      const lead = row.states[0];
      const own = { vehicleCodes: [row.code], company: row.company };
      return lead === 'expired' || lead === 'expiring'
        ? at('fuel-cards', own, 'fuelCardList.row')
        : at('fuel-cards/charging', own, 'fuelCardList.row');
    },
    /** T1.6. */
    crewGap: (): DashLink => roster('roster.crewGap', { view: 'crewGap' }),
    /** T1.7 / T5.3, T1.8 / T5.4, T5.5 — the figures' branch (D10). */
    charging: (state: 'requested' | 'low' | 'charged'): DashLink =>
      at('fuel-cards/charging', { state, ...br }, `fuelCharging.${state}`),
    /** T5.1 / T5.2. */
    chargingCompany: (company: 'wataniya' | 'chillout'): DashLink =>
      at('fuel-cards/charging', { company, ...br }, `fuelCharging.${company}`),
    /** «كروت تحتاج متابعة» foot «كل الطلبات والأرصدة المنخفضة»: the charging screen on both states. */
    chargingStates: (
      states: readonly ('requested' | 'low')[],
      metric = 'fuelCardList.chargingStates',
    ): DashLink => at('fuel-cards/charging', { state: states, ...br }, metric),
    /** T1.9. */
    dealershipPending: (): DashLink =>
      at('dealership', { state: 'pending', ...br }, 'dealershipPending.rows'),
    /**
     * T1.10: the union headline is a named exception (D16) — the open notices, its closest list. The
     * notices follow the car's branch (a notice with no car is the whole company's alone), so every
     * notices link carries the figures' branch.
     */
    noticesOpen: (): DashLink => at('notices', { status: 'open', ...br }, 'notices.missingAny'),
    noticesCheckImage: (): DashLink =>
      at('notices', { status: 'open', checkImage: 'missing', ...br }, 'notices.missingCheckImage'),
    /** «إخطارات تأمين مفتوحة» and «كل الإخطارات المفتوحة (N)»: the open notices of the branch. */
    noticesOpenAll: (metric = 'notices.open'): DashLink =>
      at('notices', { status: 'open', ...br }, metric),
    /**
     * «فتح» on a row of «إخطارات ينقصها مرفق»: the open notices by what the row carries — its car,
     * its number and its day (the screen's `number` is a substring match, so a notice sharing them
     * opens beside it). A notice with none of the three has no exact list: no link.
     */
    noticeRow: (n: {
      code: string | null;
      number: string | null;
      date: string | null;
    }): DashLink | null =>
      n.code === null && n.number === null && n.date === null
        ? null
        : at(
            'notices',
            {
              status: 'open',
              vehicleCodes: n.code === null ? null : [n.code],
              number: n.number,
              from: n.date,
              to: n.date,
              ...br,
            },
            'notices.row',
          ),
    custodyDashboard: custodyDashboardLink,
    /** T5.9: the spend screen over the last 30 days. */
    custodyExpenses: (): DashLink =>
      at('custody-expenses', { from: addDaysYmd(today, -29), to: today }, 'custodyFund.expenses'),
    /** T1.12: the stale cars' whole history (`period=all`), at most 50 of them. */
    noReading: (codes: readonly string[]): DashLink | null => {
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('odometer', { vehicleCodes: narrowed, period: 'all' }, 'noReading.stale');
    },
    /** «فتح» on a row of «بلا قراءة حديثة»: that car's whole odometer history. */
    noReadingCar: (code: string): DashLink =>
      at('odometer', { vehicleCodes: [code], period: 'all' }, 'noReading.row'),
    neverRead: (codes: readonly string[]): DashLink | null => {
      const narrowed = codesOrNull(codes);
      return narrowed === null
        ? null
        : at('vehicles', { vehicleCodes: narrowed }, 'noReading.neverRead');
    },

    // «الحركة اليوم» (and the overview's KPIs).
    vehiclesActive: (): DashLink => at('vehicles', { status: 'active' }, 'vehicles.active'),
    vehiclesOutOfService: (): DashLink =>
      at('vehicles', { status: 'outOfService' }, 'vehicles.outOfService'),
    rosterReady: (): DashLink => roster('roster.ready', { view: 'ready' }),
    rosterUnmanned: (metric = 'roster.unmanned'): DashLink => roster(metric, { view: 'unmanned' }),
    rosterWorkshop: (): DashLink => roster('roster.inWorkshop', { view: 'workshop' }),
    /**
     * The roster's available panel, whose heading counts the licensed drivers the day's board seats
     * on NO car — T2.6's «بلا سيارة», not its headline. «المتاحون» counts the seated too, and no
     * screen lists the two together, so the headline has no link (a named exception).
     */
    rosterAvailable: (metric = 'roster.availableWithoutVehicle'): DashLink => roster(metric, {}),
    rosterAbsent: (reason: 'fleetUnavailability' | 'hrLeave'): DashLink =>
      roster(reason === 'hrLeave' ? 'roster.absent.leave' : 'roster.absent.attendance', {
        unavailable: reason,
      }),
    rosterUnavailable: (
      reason: 'profileInactive' | 'notEmployed' | 'licenceExpired',
      metric: string,
    ): DashLink => roster(metric, { unavailable: reason }),
    /** «فتح» on a row of «سيارات بلا سائق اليوم»: the day's board, searched for that car. */
    rosterCar: (code: string): DashLink => roster('roster.unmannedRows', { q: code }),
    /** «عرض الكل (N)» of «الغائبون اليوم»: the two absence reasons (N = attendance + leave). */
    rosterAbsentAll: (): DashLink =>
      roster('roster.absent', { unavailable: ['fleetUnavailability', 'hrLeave'] }),
    /** «غير المتاحين في تعيين السيارات»: the board's five unavailable reasons. */
    rosterUnavailableAll: (): DashLink =>
      roster('roster.unavailable', { unavailable: UNAVAILABLE_ALL }),
    /** A secondary link (its own page guard, `fleetAvailability.view`). */
    attendance: (): DashLink => at('attendance', { date: today }, 'roster.absent.attendanceSheet'),
    /** T2.4 — open visits of any status. */
    workshopOpen: (metric = 'workshop.open'): DashLink =>
      at('maintenance', { state: 'open', ...br }, metric),
    /** «فتح» on a row of «أطول بقاء في الورشة الآن»: that car's open visit. */
    workshopCar: (code: string): DashLink =>
      at('maintenance', { state: 'open', vehicleCodes: [code], ...br }, 'workshop.longest'),

    // «توزيع السيارات».
    vehiclesBy: (
      cell: { typeId?: string; branchId?: string; operationIds?: readonly string[] },
      metric: string,
    ): DashLink =>
      at(
        'vehicles',
        {
          status: 'active',
          type: cell.typeId,
          branch: cell.branchId,
          operation: cell.operationIds,
        },
        metric,
      ),
    /** T3.4: the registry, never bare (a bare URL restores remembered filters, CR-11). */
    drivers: (): DashLink =>
      at('drivers', { sort: 'employeeCode:asc', ...br }, 'distributionDrivers.total'),
    /** T3.6 / T3.8: the catalog specialisations (the legacy-only profiles are a sub-line). */
    driversBySpec: (specializationIds: readonly string[], metric: string): DashLink | null =>
      specializationIds.length === 0
        ? null
        : at('drivers', { spec: specializationIds, ...br }, metric),
    /**
     * «عقود توريد السيارات»: the contracts DATED in today's Cairo year (contracts carry no branch, so
     * the company's always), with one alarm level for the red / yellow counts.
     */
    supplyContracts: (metric: string, alarm?: 'red' | 'yellow'): DashLink => {
      const year = today.slice(0, 4);
      return at('vehicle-contracts', { from: `${year}-01-01`, to: `${year}-12-31`, alarm }, metric);
    },

    // Tab 4 — licences and recent records.
    /** T4.6 (D17): the licensing board's own stats bar, never the bare page. */
    licensing: (paper: 'insurance' | 'tax'): DashLink =>
      at('licensing', { sort: 'asc' }, `papers.${paper}`),
    /**
     * T4.8: the visit's business day on the maintenance screen (R-12) — its check-in day while open,
     * its check-out day once closed (`outFrom`/`outTo`, the bounds that filter on the check-out).
     */
    visitDay: (code: string, day: string, open: boolean): DashLink =>
      at(
        'maintenance',
        open
          ? { vehicleCodes: [code], from: day, to: day }
          : { vehicleCodes: [code], outFrom: day, outTo: day },
        'recentWorkshop.row',
      ),
    /** T4.9 / T10.1: the accident's day on the accidents screen. */
    accidentDay: (code: string, day: string, metric = 'recentAccidents.row'): DashLink =>
      at('accidents', { vehicleCodes: [code], from: day, to: day }, metric),
    /**
     * The two «سجل …» foot links of «آخر ما سُجّل» — the 30-day window the list shows, and its
     * branch: the lists are narrowed to the chosen branch on the server, so the screens are too.
     */
    accidentsRecent: (days: number): DashLink =>
      at(
        'accidents',
        { from: addDaysYmd(today, 1 - days), to: today, ...br },
        'recentAccidents.all',
      ),
    visitsRecent: (days: number): DashLink =>
      at(
        'maintenance',
        { from: addDaysYmd(today, 1 - days), to: today, ...br },
        'recentWorkshop.all',
      ),

    // Tab 5 — summaries.
    /** T5.10. */
    accidentsOpen: (): DashLink =>
      at('accidents', { status: 'open', ...br }, 'accidentsOpen.count'),
    /** «عرض الملفات المفتوحة» (the foot of «ملفات حوادث مفتوحة»): the same list. */
    accidentsOpenAll: (): DashLink =>
      at('accidents', { status: 'open', ...br }, 'accidentsOpen.all'),
    /**
     * T5.11: company statements and the drivers' ledger of the Cairo year, unpaid. The drivers'
     * half has its own year (`dyear`): without it the ledger listed every year's unpaid fines
     * under a figure that counts one.
     */
    violationsCompany: (year: number): DashLink =>
      at('violations', { year: String(year), cset: 'false', ...br }, 'violationsYear.company'),
    violationsDrivers: (year: number): DashLink =>
      at(
        'violations',
        { year: String(year), dyear: String(year), dset: 'false', ...br },
        'violationsYear.drivers',
      ),
    /** T5.12 «مجهول». «اسم غير مربوط» has no list parameter (named exception). */
    violationsUnknown: (year: number): DashLink =>
      at(
        'violations',
        { year: String(year), dyear: String(year), dunknown: 'true', dset: 'false', ...br },
        'violationsYear.unknown',
      ),
    /**
     * «إجمالي المخالفات القائمة» («المخالفات المرورية والتسويات»): every year's fines still owed —
     * the company statements and the drivers' ledger both unpaid, no `year` / `dyear` (every year).
     */
    violationsOpen: (metric = 'violationsOpen.total'): DashLink =>
      at('violations', { cset: 'false', dset: 'false', ...br }, metric),
    /** «قائمة على الشركة»: the company statements still unpaid, every year. */
    violationsOpenCompany: (metric = 'violationsOpen.company'): DashLink =>
      at('violations', { cset: 'false', ...br }, metric),
    /** «قائمة على السائقين»: the drivers' ledger still owed, every year. */
    violationsOpenDrivers: (metric = 'violationsOpen.drivers'): DashLink =>
      at('violations', { dset: 'false', ...br }, metric),
    /** «مجهول ←»: the drivers' owed fines on no known driver, every year. */
    violationsOpenUnknown: (): DashLink =>
      at('violations', { dunknown: 'true', dset: 'false', ...br }, 'violationsOpen.unknown'),
    /** «مطابقة أرصدة الكروت» — a quick link to an existing screen that keeps no filters. */
    reconcile: (metric = 'fuelCharging.reconcile'): DashLink => ({
      to: '/fleet/fuel-cards/reconcile',
      metric,
    }),
  };
};
export type NowLinks = ReturnType<typeof nowLinks>;

// ── The R2 tabs (and the overview's «هذا الشهر»): the range and the vehicle set ────────────────

export interface PeriodEcho {
  range: { from: string; to: string };
  vehicleScope: FleetDashboardVehicleScopeDto;
}

export const periodLinks = ({ range, vehicleScope }: PeriodEcho) => {
  /** `{set}` — the filters as each period screen reads them (D10). */
  const set = {
    type: vehicleScope.typeIds,
    operation: vehicleScope.operationIds,
    branch: branchOf(vehicleScope.branchId, vehicleScope.scopeBranches),
    vehicleCodes: vehicleScope.vehicleCodes,
  };
  const dates = { from: range.from, to: range.to };
  const over = (screen: string, metric: string, extra: Record<string, Param> = {}) =>
    at(screen, { ...dates, ...set, ...extra }, metric);
  return {
    /** T6.1 and «العدادات والكيلومترات»: the odometer register over the range and the set. */
    km: (metric = 'km.total'): DashLink => over('odometer', metric),
    /** T8.x: one car's readings over the period. */
    carKm: (code: string, metric: string): DashLink =>
      at('odometer', { vehicleCodes: [code], ...dates }, metric),
    /** «فتح» on a row of «قراءات تحتاج مراجعة»: that car's readings on that ONE day. */
    carKmDay: (code: string, day: string, metric: string): DashLink =>
      at('odometer', { vehicleCodes: [code], from: day, to: day }, metric),
    /**
     * «فتح» on a review row whose car was DELETED since: the register's code filter finds live cars
     * only, so that ONE day under the period's types, operations and branches (which do reach a
     * deleted car's history, D10) and without the codes — the row is among them.
     */
    kmDay: (day: string, metric: string): DashLink =>
      at(
        'odometer',
        { from: day, to: day, type: set.type, operation: set.operation, branch: set.branch },
        metric,
      ),
    /**
     * «سيارات بلا مسافة في الفترة» (and «منها N لم تُقرأ أبدًا»): those cars on the vehicles list, by
     * the codes the server sent — `null` when there are none or more than the screens' cap (the
     * server sends `[]` then), so the figure stands plain.
     */
    vehiclesByCodes: (codes: readonly string[], metric: string): DashLink | null => {
      const narrowed = codesOrNull(codes);
      return narrowed === null ? null : at('vehicles', { vehicleCodes: narrowed }, metric);
    },
    vehicle: (vehicleId: string, metric: string): DashLink => ({
      to: `/fleet/vehicles/${encodeURIComponent(vehicleId)}`,
      metric,
    }),
    /** T6.3 / T6.4 — «أرقام الفترة»: the visits that ENTERED in the range (check-in day). */
    visits: (metric = 'visits.count', extra: { state?: 'open' | 'closed' } = {}): DashLink =>
      over('maintenance', metric, extra),
    /**
     * The visits that LEFT the workshop in the range — the screen's check-out bounds (`outFrom` /
     * `outTo`), never `from` / `to` (the check-in day): «زيارات الصيانة» of the overview's month and
     * every period figure of «الصيانة والورش». A bar adds its work type or workshop; a ranked car's
     * code REPLACES the set's codes (the rest of the set stays).
     */
    exits: (
      metric = 'exits.count',
      extra: {
        workTypes?: readonly string[];
        workshops?: readonly string[];
        vehicleCodes?: readonly string[];
      } = {},
    ): DashLink =>
      at('maintenance', { outFrom: range.from, outTo: range.to, ...set, ...extra }, metric),
    /** T6.5 / T6.6 / T10.2. */
    accidents: (metric = 'accidents.count', status?: 'open'): DashLink =>
      over('accidents', metric, { status }),
    accidentDay: (code: string, day: string, metric = 'accidentList.row'): DashLink =>
      at('accidents', { vehicleCodes: [code], from: day, to: day }, metric),
    /** T6.7 / T6.8 (`custody`: the custody part for a reader without the custody screen, D20). */
    opex: (metric = 'opex.total', source?: 'card' | 'custody'): DashLink =>
      over('receipts', metric, { source }),
    /** «مصروف الوقود»: the fuel receipts (card + custody) of the range. */
    opexFuel: (): DashLink => over('receipts', 'opex.fuel', { kind: 'fuel' }),
    /** D20: the custody part — the spend screen when nothing but codes narrows, else the receipts. */
    opexCustody: (): DashLink =>
      vehicleScope.typeIds.length === 0 &&
      vehicleScope.operationIds.length === 0 &&
      vehicleScope.branchId === null &&
      vehicleScope.scopeBranches === null
        ? at(
            'custody-expenses',
            { ...dates, vehicleCodes: vehicleScope.vehicleCodes },
            'opex.custody',
          )
        : over('receipts', 'opex.custody', { source: 'custody' }),
    /** T6.9 (+ «بانتظار تسجيل القيمة»: `state=pending`). */
    dealership: (metric = 'dealership.amount', state?: 'pending'): DashLink =>
      over('dealership', metric, { state }),
    /** «مصروف التشغيل حسب النوع»: the receipts of one kind (and, for fuel, one source). */
    opexKind: (
      metric: string,
      kind: 'fuel' | 'tyres' | 'wash' | 'maintenance',
      source?: 'card' | 'custody',
    ): DashLink => over('receipts', metric, { kind, source }),
    /**
     * «فتح» on a row of «فواتير التوكيل في الفترة»: that car's rows of that work on that exit day. A
     * row no code names (`code: null`) opens that day's rows of the work under the period's types,
     * operations and branches — the row is among them.
     */
    dealershipRow: (
      row: { code: string | null; date: string; workKind: FleetDealershipWorkKind },
      metric = 'dealershipList.row',
    ): DashLink =>
      at(
        'dealership',
        row.code === null
          ? {
              from: row.date,
              to: row.date,
              work: row.workKind,
              type: set.type,
              operation: set.operation,
              branch: set.branch,
            }
          : { vehicleCodes: [row.code], from: row.date, to: row.date, work: row.workKind },
        metric,
      ),
    /**
     * «مخالفات السائقين في الفترة» (plan D9): the register's DRIVERS' half reads its own names — the
     * fine's day as `dfrom` / `dto` and the cars as `dcodes` — beside the set's type, operation and
     * branch. «قائمة» adds `dset=false`, a type bar `dtype=<id>`.
     */
    violations: (metric: string, extra: { dset?: 'false'; dtype?: string } = {}): DashLink =>
      at(
        'violations',
        {
          dfrom: range.from,
          dto: range.to,
          dcodes: vehicleScope.vehicleCodes,
          type: set.type,
          operation: set.operation,
          branch: set.branch,
          ...extra,
        },
        metric,
      ),
    /**
     * «فتح» on a row of «مخالفات السائقين في الفترة»: that car's fines of that type on that day —
     * this fine and any that share them (the register's code filter reaches a deleted car and an
     * old-book code alike). A row no code names (`code: null`) opens that day's fines of the type
     * under the period's types, operations and branches — the fine is among them.
     */
    violationRow: (
      row: { code: string | null; date: string; violationTypeId: string },
      metric = 'violationList.row',
    ): DashLink =>
      at(
        'violations',
        row.code === null
          ? {
              dfrom: row.date,
              dto: row.date,
              dtype: row.violationTypeId,
              type: set.type,
              operation: set.operation,
              branch: set.branch,
            }
          : { dcodes: [row.code], dfrom: row.date, dto: row.date, dtype: row.violationTypeId },
        metric,
      ),
  };
};
export type PeriodLinks = ReturnType<typeof periodLinks>;
