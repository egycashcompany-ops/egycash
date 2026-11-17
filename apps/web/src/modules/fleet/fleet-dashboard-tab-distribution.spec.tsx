// «لوحة تحكم الحركة» — «توزيع السيارات», the owner-approved sample (approved/dist-dark.png and
// dist-branch-dark.png; plan build-dm §6).
//
// What this file pins: every figure reads its field and opens the list that shows the same number
// (or opens nothing when no list shows exactly it: «أخرى», «بلا فرع», «غير مسجّلة»); the branches keep
// the server's order, a branch with no car keeps its card; a branch's operations come from the
// server's `kinds`; one branch in scope (the switcher's branch, or a one-branch reader) draws the
// branch's view, «كل فروعي» the company's; the kilometres are the fixed «هذا الشهر» read, whatever the
// page's filters say, and their links carry that read's echo alone; the supply contracts are this
// year's, company-wide, drawn only for a reader of the contracts screen. It also carries the pins of
// the old tab 3 that still hold (the matrix links, «بلا فرع» only when > 0, the plain ratio, the
// drivers by specialisation and «منهم N بتصنيف قديم», no driver part without the drivers' section).
//
// Rendered through the real page over seeded caches (`renderDashboard`), the fleet-dashboard way.
import { describe, expect, it } from 'vitest';
import {
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetVehicleContractTotalsDto,
} from '@ecms/contracts';
import { fleetDashboardKeys } from './api/fleet-dashboard-queries';
import { vehicleContractSummaryKey } from './api/vehicle-contract-queries';
import { periodLiveness } from './lib/fleet-dashboard-refresh';
import { readPeriodFilters, toPeriodQuery } from './lib/fleet-dashboard-url';
import {
  ALL_KEYS,
  B1,
  B2,
  NOW_DTO,
  OP_ATM,
  OP_CASH,
  PERIOD_DTO,
  PERIOD_KEY,
  SP_ATM,
  SP_CASH,
  T1,
  T2,
  TODAY,
  ar,
  dashboardClient,
  renderDashboard,
} from './fleet-dashboard-fixtures';

const need = <T,>(value: T | null): T => {
  if (value === null) throw new Error('fixture section is null');
  return value;
};

/** A third branch, with no active car: it keeps its card and its column. */
const B3 = '650000000000000000000103';
const T3 = '650000000000000000000203';
const CAIRO = { id: B1, name: { ar: 'القاهرة', en: 'Cairo' } };
const GIZA = { id: B2, name: { ar: 'الجيزة', en: 'Giza' } };
const ASSIUT = { id: B3, name: { ar: 'أسيوط', en: 'Assiut' } };

type Vehicles = NonNullable<FleetDashboardNowDto['distributionVehicles']>;

/**
 * The company: 40 active = 24 cash + 11 ATM + 5 other. The server's order is active cars desc —
 * «الجيزة» 25 before «القاهرة» 14 (not the ids' order), then «أسيوط» 0; one car has no branch.
 * Every branch's kinds add up to its column; Σ kinds (+ «بلا فرع») = each operation.
 */
const VEHICLES: Vehicles = {
  branches: [GIZA, CAIRO, ASSIUT],
  rows: [
    {
      typeId: T1,
      name: { ar: 'مصفحة', en: 'Armoured' },
      counts: { [B2]: 16, [B1]: 8, [B3]: 0 },
      noBranch: 0,
      total: 24,
    },
    {
      typeId: T2,
      name: { ar: 'جيب', en: 'Jeep' },
      counts: { [B2]: 9, [B1]: 6, [B3]: 0 },
      noBranch: 1,
      total: 16,
    },
  ],
  totals: { counts: { [B2]: 25, [B1]: 14, [B3]: 0 }, noBranch: 1, total: 40 },
  branchCount: 2,
  cash: { vehicles: 24, operationIds: [OP_CASH] },
  atm: { vehicles: 11, operationIds: [OP_ATM] },
  kinds: {
    [B2]: { cash: 15, atm: 7, other: 3 },
    [B1]: { cash: 9, atm: 4, other: 1 },
    [B3]: { cash: 0, atm: 0, other: 0 },
  },
  noBranchKinds: { cash: 0, atm: 0, other: 1 },
  other: { vehicles: 5 },
};

/** The registry: 52 drivers, 31 cash (2 of them on the old specialisation only), 15 ATM (none). */
const DRIVERS: NonNullable<FleetDashboardNowDto['distributionDrivers']> = {
  total: 52,
  cash: { drivers: 31, legacy: 2, specializationIds: [SP_CASH] },
  atm: { drivers: 15, legacy: 0, specializationIds: [SP_ATM] },
};

const NOW: FleetDashboardNowDto = {
  ...NOW_DTO,
  branchId: null,
  scopeBranches: null,
  distributionVehicles: VEHICLES,
  distributionDrivers: DRIVERS,
  unavailable: [],
};

/** «المهندسين»-style branch view: the one branch's column of the company, as R1 narrows it. */
const BRANCH_VEHICLES: Vehicles = {
  branches: [CAIRO],
  rows: [
    {
      typeId: T1,
      name: { ar: 'مصفحة', en: 'Armoured' },
      counts: { [B1]: 8 },
      noBranch: 0,
      total: 8,
    },
    { typeId: T2, name: { ar: 'جيب', en: 'Jeep' }, counts: { [B1]: 6 }, noBranch: 0, total: 6 },
    {
      typeId: T3,
      name: { ar: 'ميكروباص', en: 'Minibus' },
      counts: { [B1]: 0 },
      noBranch: 0,
      total: 0,
    },
  ],
  totals: { counts: { [B1]: 14 }, noBranch: 0, total: 14 },
  branchCount: 1,
  cash: { vehicles: 9, operationIds: [OP_CASH] },
  atm: { vehicles: 4, operationIds: [OP_ATM] },
  kinds: { [B1]: { cash: 9, atm: 4, other: 1 } },
  noBranchKinds: { cash: 0, atm: 0, other: 0 },
  other: { vehicles: 1 },
};
const NOW_BRANCH: FleetDashboardNowDto = {
  ...NOW,
  branchId: B1,
  scopeBranches: [CAIRO],
  distributionVehicles: BRANCH_VEHICLES,
  distributionDrivers: {
    total: 17,
    cash: { drivers: 10, legacy: 0, specializationIds: [SP_CASH] },
    atm: { drivers: 5, legacy: 0, specializationIds: [SP_ATM] },
  },
};
/** A reader whose grant holds one branch, no switcher: the same branch view. */
const NOW_ONE: FleetDashboardNowDto = { ...NOW_BRANCH, branchId: null };
/** «كل فروعي»: two of the reader's branches, no switcher. */
const NOW_MINE: FleetDashboardNowDto = {
  ...NOW,
  scopeBranches: [GIZA, CAIRO],
  distributionVehicles: {
    ...VEHICLES,
    branches: [GIZA, CAIRO],
    totals: { counts: { [B2]: 25, [B1]: 14 }, noBranch: 0, total: 39 },
    rows: [
      { ...need(VEHICLES.rows[0] ?? null), counts: { [B2]: 16, [B1]: 8 } },
      { ...need(VEHICLES.rows[1] ?? null), counts: { [B2]: 9, [B1]: 6 }, noBranch: 0, total: 15 },
    ],
    kinds: { [B2]: { cash: 15, atm: 7, other: 3 }, [B1]: { cash: 9, atm: 4, other: 1 } },
    noBranchKinds: { cash: 0, atm: 0, other: 0 },
    other: { vehicles: 4 },
    atm: { vehicles: 11, operationIds: [OP_ATM] },
  },
};

const COMPANY_SCOPE: FleetDashboardPeriodDto['vehicleScope'] = {
  count: null,
  typeIds: [],
  operationIds: [],
  vehicleCodes: [],
  branchId: null,
  scopeBranches: null,
};

/**
 * R2 «هذا الشهر» with no page filter — the km block's own read. R2's order is km desc: «القاهرة»
 * before «الجيزة» (the cards' order is the other way round); the cars with no branch and the rows of
 * no registered car close the list. 3,000 + 1,500 + 296 + 100 = 4,896. Today is the month's first
 * day: no day is closed yet.
 */
const MONTH: FleetDashboardPeriodDto = {
  ...PERIOD_DTO,
  range: { preset: 'thisMonth', from: TODAY, to: TODAY, days: 1, granularity: 'day' },
  vehicleScope: COMPANY_SCOPE,
  km: {
    ...need(PERIOD_DTO.km),
    total: 4896,
    confirmedThrough: null,
    closedDays: 0,
    average: null,
    byBranch: [
      { branchId: B1, name: CAIRO.name, km: 3000 },
      { branchId: B2, name: GIZA.name, km: 1500 },
      { branchId: null, name: null, km: 296 },
    ],
    byType: null,
    unregistered: 100,
  },
  unavailable: [],
};
const MONTH_BRANCH: FleetDashboardPeriodDto = {
  ...MONTH,
  vehicleScope: { ...COMPANY_SCOPE, branchId: B1, scopeBranches: [CAIRO] },
  km: {
    ...need(MONTH.km),
    total: 3000,
    byBranch: [{ branchId: B1, name: CAIRO.name, km: 3000 }],
    byType: [
      { typeId: T1, name: { ar: 'مصفحة', en: 'Armoured' }, km: 2000 },
      { typeId: T2, name: { ar: 'جيب', en: 'Jeep' }, km: 1000 },
    ],
    unregistered: null,
  },
};

/** This year's contracts (`/summary` over 2026-01-01 … 2026-12-31): 3 contracts, 50 cars, 30 in. */
const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const SUPPLY: FleetVehicleContractTotalsDto = {
  count: 3,
  value: 900000,
  contracted: 50,
  received: 30,
};
const SUPPLY_RED: FleetVehicleContractTotalsDto = {
  count: 1,
  value: 300000,
  contracted: 20,
  received: 5,
};
const SUPPLY_YELLOW: FleetVehicleContractTotalsDto = {
  count: 2,
  value: 400000,
  contracted: 20,
  received: 15,
};
const SUPPLY_KEYS = [...ALL_KEYS, 'fleetVehicleContract.view'];

const client = ({
  now = NOW,
  month = MONTH,
  supply = [SUPPLY, SUPPLY_RED, SUPPLY_YELLOW],
}: {
  now?: FleetDashboardNowDto;
  month?: FleetDashboardPeriodDto | null;
  supply?:
    | readonly [
        FleetVehicleContractTotalsDto,
        FleetVehicleContractTotalsDto,
        FleetVehicleContractTotalsDto,
      ]
    | null;
} = {}) => {
  const qc = dashboardClient({ now, period: month });
  if (supply !== null) {
    qc.setQueryData(vehicleContractSummaryKey(YEAR), supply[0]);
    qc.setQueryData(vehicleContractSummaryKey({ ...YEAR, alarm: ['red'] }), supply[1]);
    qc.setQueryData(vehicleContractSummaryKey({ ...YEAR, alarm: ['yellow'] }), supply[2]);
  }
  return qc;
};

const tab = (
  seed: Parameters<typeof client>[0] = {},
  permissions: readonly string[] = ALL_KEYS,
  url = '/fleet?tab=distribution',
): string => renderDashboard({ url, client: client(seed), permissions });

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ');
/** Every link the markup holds: its target and the figure it carries. */
const links = (html: string): { href: string; metric: string }[] =>
  [...html.matchAll(/<a\b[^>]*>/gu)].map((m) => ({
    href: (/href="([^"]*)"/u.exec(m[0])?.[1] ?? '').replace(/&amp;/gu, '&'),
    metric: /data-metric="([^"]*)"/u.exec(m[0])?.[1] ?? '',
  }));
const hrefOf = (html: string, metric: string): string[] =>
  links(html)
    .filter((l) => l.metric === metric)
    .map((l) => l.href);
const parse = (href: string): { pathname: string; params: URLSearchParams } => {
  const [pathname = '', search = ''] = href.split('?');
  return { pathname, params: new URLSearchParams(search) };
};
/** The markup from the tag holding `marker` to the tag holding the next match of `next`. */
const part = (html: string, marker: string, next: RegExp): string => {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const end = html.slice(at + marker.length).search(next);
  return end < 0
    ? html.slice(start)
    : html.slice(start, html.lastIndexOf('<', at + marker.length + end));
};
const block = (html: string, id: string): string =>
  part(html, `data-dist-block="${id}"`, /data-dist-block="/u);
const card = (html: string, id: string): string =>
  part(html, `data-op-card="${id}"`, /data-op-card="|data-dist-drivers-note=|data-dist-block="/u);
const branchCard = (html: string, id: string): string =>
  part(html, `data-branch-card="${id}"`, /data-branch-card="|data-dist-block="/u);
const head = (html: string): string => part(html, 'data-tab-head="true"', /data-op-card="/u);

// ── The operation row ─────────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — the heading and the operation row', () => {
  const html = tab();

  it('names the tab as approved, its line saying only what this reader is shown', () => {
    expect(text(head(html))).toContain('توزيع السيارات على التشغيل والفروع');
    expect(text(head(html))).toContain(
      'السيارات النشطة حسب التشغيل والفرع والنوع، مقارنةً بسجل السائقين، وكيلومترات هذا الشهر بالفروع.',
    );
    // The contracts' clause only for a reader of the contracts screen.
    expect(text(head(tab({}, SUPPLY_KEYS)))).toContain('بالفروع، وعقود التوريد.');
    // No km clause without the odometer key, no drivers clause without the drivers.
    const plain = tab(
      { now: { ...NOW, distributionDrivers: null } },
      ALL_KEYS.filter((key) => key !== 'fleetOdometer.view'),
    );
    expect(text(head(plain))).toContain('السيارات النشطة حسب التشغيل والفرع والنوع.');
  });

  it('draws «كل السيارات النشطة», «نقل الأموال», «ATM» in that order, each figure opening its list', () => {
    const order = ['all', 'cash', 'atm'].map((id) => html.indexOf(`data-op-card="${id}"`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(card(html, 'all'))).toContain('كل السيارات النشطة');
    expect(hrefOf(card(html, 'all'), 'distributionVehicles.total')).toContain(
      '/fleet/vehicles?status=active',
    );
    expect(hrefOf(card(html, 'cash'), 'distributionVehicles.cash')).toContain(
      `/fleet/vehicles?status=active&operation=${OP_CASH}`,
    );
    expect(hrefOf(card(html, 'atm'), 'distributionVehicles.atm')).toContain(
      `/fleet/vehicles?status=active&operation=${OP_ATM}`,
    );
  });

  it('splits the active cars into cash · ATM · «أخرى» from the server — «أخرى» opens nothing', () => {
    const legend = part(html, 'data-op-legend="all"', /data-dash-box=/u);
    expect(text(legend)).toMatch(/نقل الأموال 24 ATM 11 أخرى 5/u);
    expect(hrefOf(legend, 'distributionVehicles.cash')).toHaveLength(1);
    expect(hrefOf(legend, 'distributionVehicles.atm')).toHaveLength(1);
    expect(links(legend)).toHaveLength(2);
  });

  it('writes each operation’s share of the active cars, and of how many', () => {
    expect(text(card(html, 'cash'))).toContain('60% من النشطة');
    expect(text(card(html, 'cash'))).toContain('من 40 سيارة نشطة');
    expect(text(card(html, 'atm'))).toContain('27.5% من النشطة');
  });

  it('puts the drivers in each card’s band: the registry and the specialisations, a plain ratio, the gap', () => {
    expect(hrefOf(card(html, 'all'), 'distributionDrivers.total')).toEqual([
      '/fleet/drivers?sort=employeeCode:asc',
    ]);
    expect(hrefOf(card(html, 'cash'), 'distributionDrivers.cash')).toEqual([
      `/fleet/drivers?spec=${SP_CASH}`,
    ]);
    expect(hrefOf(card(html, 'atm'), 'distributionDrivers.atm')).toEqual([
      `/fleet/drivers?spec=${SP_ATM}`,
    ]);
    // 52 ÷ 40, 31 ÷ 24, 15 ÷ 11 — the tabs' two decimals at most, no target.
    expect(text(part(html, 'data-dist-ratio="all"', /<\/span>/u))).toContain('1.3');
    expect(text(part(html, 'data-dist-ratio="cash"', /<\/span>/u))).toContain('1.29');
    expect(text(part(html, 'data-dist-ratio="atm"', /<\/span>/u))).toContain('1.36');
    expect(text(card(html, 'all'))).toContain('السائقون أكثر من السيارات بـ 12');
    expect(text(html)).not.toContain('توازن مثالي');
    expect(text(html)).not.toContain('تصدير');
  });

  it('says how many cash drivers hold only the old specialisation — and nothing when none do (R-08)', () => {
    expect(text(card(html, 'cash'))).toContain('منهم 2 بتصنيف قديم');
    expect(card(html, 'atm')).not.toContain('data-dist-legacy');
  });

  it('shows no driver part at all without the drivers’ section — absent, not 0', () => {
    const none = tab({ now: { ...NOW, distributionDrivers: null } });
    expect(links(none).filter((l) => l.metric.startsWith('distributionDrivers.'))).toEqual([]);
    expect(text(none)).not.toContain(ar('fleet.dash.distribution.perVehicle'));
    expect(none).not.toContain('data-dist-tile=');
    expect(none).not.toContain('data-dist-drivers-note');
  });

  it('keeps a drivers-only reader’s figures: the three cards with their drivers', () => {
    const drivers = tab(
      { now: { ...NOW, distributionVehicles: null } },
      ALL_KEYS.filter((key) => key !== 'fleetVehicle.view'),
    );
    expect(hrefOf(card(drivers, 'all'), 'distributionDrivers.total')).toHaveLength(1);
    expect(text(card(drivers, 'cash'))).toContain('31');
    expect(text(card(drivers, 'cash'))).toContain('منهم 2 بتصنيف قديم');
    expect(drivers).not.toContain('data-fleet-matrix');
    expect(drivers).not.toContain('data-dist-block="branches"');
  });
});

// ── «الفروع» ──────────────────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — the branches', () => {
  const html = tab();
  const branches = block(html, 'branches');

  it('draws a card per branch in the server’s order — the zero branch too — «الأكبر» on the first', () => {
    const order = [B2, B1, B3].map((id) => branches.indexOf(`data-branch-card="${id}"`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(branchCard(html, B2))).toContain(ar('fleet.dash.distribution.biggest'));
    expect(text(branchCard(html, B1))).not.toContain(ar('fleet.dash.distribution.biggest'));
    expect(text(branchCard(html, B3))).toMatch(/أسيوط 0 نشطة/u);
    // Its zeros open nothing: an empty list is not a figure's list.
    expect(links(branchCard(html, B3))).toEqual([]);
    expect(text(branchCard(html, B3))).toMatch(/نقل الأموال 0 · ATM 0 · أخرى 0/u);
    expect(text(branches)).toContain(
      'السيارات النشطة في كل فرع، ونصيبه منها، وتفصيلها حسب التشغيل.',
    );
  });

  it('splits each branch by operation from the server’s kinds: cash and ATM open the branch and the operation', () => {
    const giza = branchCard(html, B2);
    expect(text(giza)).toMatch(/نقل الأموال 15 · ATM 7 · أخرى 3/u);
    expect(text(giza)).toContain('62.5%');
    expect(hrefOf(giza, 'distributionVehicles.branch')).toEqual([
      `/fleet/vehicles?status=active&branch=${B2}`,
    ]);
    expect(hrefOf(giza, 'distributionVehicles.branchCash')).toEqual([
      `/fleet/vehicles?status=active&branch=${B2}&operation=${OP_CASH}`,
    ]);
    expect(hrefOf(giza, 'distributionVehicles.branchAtm')).toEqual([
      `/fleet/vehicles?status=active&branch=${B2}&operation=${OP_ATM}`,
    ]);
    // «أخرى» has no list of its own: three links, none for it.
    expect(links(giza)).toHaveLength(3);
  });

  it('adds the red «بلا فرع» card only when a car has no branch — and it opens nothing', () => {
    const none = branchCard(html, 'none');
    expect(text(none)).toMatch(/بلا فرع 1 نشطة/u);
    expect(links(none)).toEqual([]);
    const plain = tab({
      now: {
        ...NOW,
        distributionVehicles: {
          ...VEHICLES,
          totals: { ...VEHICLES.totals, noBranch: 0 },
          noBranchKinds: { cash: 0, atm: 0, other: 0 },
        },
      },
    });
    expect(plain).not.toContain('data-branch-card="none"');
  });
});

// ── The matrix ────────────────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — the type × branch matrix', () => {
  const html = tab();
  const matrix = block(html, 'matrix');

  it('is the approved full-width block: its title, its count chip, its note', () => {
    expect(matrix).toContain('data-fleet-matrix="true"');
    expect(text(matrix)).toContain('توزيع السيارات حسب النوع والفرع');
    expect(text(matrix)).toContain('السيارات النشطة حسب نوعها في سجل السيارات وفرعها.');
    expect(text(part(matrix, 'data-dist-chip="matrix"', /<\/span>\s*<\/div>/u))).toContain(
      '40 سيارة نشطة',
    );
    expect(text(matrix)).toContain('كل رقم يفتح السيارات مرشّحة عليه.');
  });

  it('lays the branches out as columns in the server’s order, «بلا فرع» only when a car has none — unlinked', () => {
    expect(text(part(matrix, '<thead', /<\/thead>/u))).toMatch(
      /نوع السيارة الجيزة القاهرة أسيوط بلا فرع الإجمالي/u,
    );
    expect(text(matrix)).toContain('عمود «بلا فرع» لسيارات قديمة لم يُسجَّل لها فرع');
    const plain = block(
      tab({
        now: {
          ...NOW,
          distributionVehicles: {
            ...VEHICLES,
            rows: VEHICLES.rows.map((row) => ({ ...row, noBranch: 0 })),
            totals: { ...VEHICLES.totals, noBranch: 0 },
          },
        },
      }),
      'matrix',
    );
    expect(text(part(plain, '<thead', /<\/thead>/u))).not.toContain('بلا فرع');
    expect(text(plain)).not.toContain('عمود «بلا فرع»');
    expect(links(matrix).filter((l) => l.href.includes('branch=none'))).toEqual([]);
  });

  it('opens every cell on its type and branch, a row on its type, a column on its branch, the corner on all', () => {
    expect(hrefOf(matrix, 'distributionVehicles.cell')).toContain(
      `/fleet/vehicles?status=active&type=${T1}&branch=${B2}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.typeTotal')).toContain(
      `/fleet/vehicles?status=active&type=${T1}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.branch')).toContain(
      `/fleet/vehicles?status=active&branch=${B1}`,
    );
    expect(hrefOf(matrix, 'distributionVehicles.total')).toEqual(['/fleet/vehicles?status=active']);
  });

  it('writes «—» for an empty cell — never a 0, never a link', () => {
    const tbody = part(matrix, '<tbody', /<\/tbody>/u);
    expect(links(tbody).filter((l) => l.href.includes(`branch=${B3}`))).toEqual([]);
    // «مصفحة»: «الجيزة» 16, «القاهرة» 8, «أسيوط» none, «بلا فرع» none — then its total and share.
    const armoured = part(tbody, `data-dist-type="${T1}"`, /data-dist-type="|<\/tbody>/u);
    expect(text(armoured)).toMatch(/مصفحة 16 8 — — 24 60%/u);
    expect(armoured).not.toMatch(/>0</u);
    // The zero branch's column is dashes to its foot, unlinked.
    const foot = part(matrix, '<tfoot', /<\/tfoot>/u);
    expect(links(foot).filter((l) => l.href.includes(`branch=${B3}`))).toEqual([]);
    expect(text(foot)).toMatch(/إجمالي الفرع 25 14 — 1 40/u);
  });

  it('writes each row’s share of the active cars, with no lead tint', () => {
    const tbody = part(matrix, '<tbody', /<\/tbody>/u);
    const jeep = part(tbody, `data-dist-type="${T2}"`, /data-dist-type="|<\/tbody>/u);
    expect(text(jeep)).toContain('40%');
    expect(matrix).not.toContain('bg-brand-50/70');
    expect(matrix).not.toContain('bg-brand-950/40');
  });

  it('says so when no car is active', () => {
    const empty = tab({
      now: {
        ...NOW,
        distributionVehicles: {
          ...VEHICLES,
          rows: [],
          totals: { counts: { [B2]: 0, [B1]: 0, [B3]: 0 }, noBranch: 0, total: 0 },
        },
      },
    });
    expect(text(block(empty, 'matrix'))).toContain(ar('fleet.dash.distribution.empty'));
  });
});

// ── The month's kilometres ────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — the kilometres by branch (the fixed «هذا الشهر» read)', () => {
  const html = tab();
  const km = block(html, 'km');

  it('sits under the matrix, the month named on its chip, the month’s total opening the readings', () => {
    expect(html.indexOf('data-dist-block="km"')).toBeGreaterThan(
      html.indexOf('data-dist-block="matrix"'),
    );
    expect(text(km)).toContain('الكيلومترات حسب الفرع');
    expect(text(km)).toContain('ما قطعته سيارات كل فرع منذ أول الشهر.');
    expect(text(part(km, 'data-dash-range=', /<\/span>/u))).toContain('هذا الشهر · نوفمبر 2026');
    expect(text(km)).toContain('إجمالي الكيلومترات');
    expect(hrefOf(km, 'km.total')).toEqual([`/fleet/odometer?from=${TODAY}&to=${TODAY}`]);
  });

  it('draws R2’s own order; «بلا فرع» and «غير مسجّلة» muted and unlinked', () => {
    const cols = ['B1', 'B2', 'none', 'unregistered'].map((key) =>
      km.indexOf(`data-dash-col="${key === 'B1' ? B1 : key === 'B2' ? B2 : key}"`),
    );
    expect(cols.every((at) => at >= 0)).toBe(true);
    expect([...cols].sort((a, b) => a - b)).toEqual(cols);
    expect(hrefOf(km, 'km.byBranch')).toEqual([
      `/fleet/odometer?from=${TODAY}&to=${TODAY}&branch=${B1}`,
      `/fleet/odometer?from=${TODAY}&to=${TODAY}&branch=${B2}`,
    ]);
    expect(km.match(/data-dash-col-muted="true"/gu)).toHaveLength(2);
    // 3,000 of 4,896.
    expect(text(km)).toContain('61.3%');
  });

  it('says no day is closed yet on the month’s first day, and writes the average once one is', () => {
    expect(text(km)).toContain(ar('fleet.dash.km.legend.noAverage'));
    expect(text(km)).toContain(ar('fleet.dash.km.byBranchNote'));
    const closed = block(
      tab({
        month: {
          ...MONTH,
          km: { ...need(MONTH.km), closedDays: 1, average: 4896, confirmedThrough: TODAY },
        },
      }),
      'km',
    );
    expect(text(closed)).toMatch(/المتوسط اليومي للأيام المؤكدة حتى 2026\/11\/01\s*:\s*4,896 كم/u);
    expect(text(closed)).not.toContain(ar('fleet.dash.km.legend.noAverage'));
  });

  it('reads the month under any page filter, and its links carry none of the page’s', () => {
    const url = `/fleet?tab=distribution&period=lastMonth&type=${T1}`;
    const query = toPeriodQuery(readPeriodFilters(new URLSearchParams(url.split('?')[1])));
    const pageKey = fleetDashboardKeys.period(periodLiveness(query, TODAY), query);
    expect(pageKey).not.toEqual(PERIOD_KEY);
    const qc = client();
    qc.setQueryData(pageKey, {
      ...MONTH,
      range: {
        preset: 'lastMonth',
        from: '2026-10-01',
        to: '2026-10-31',
        days: 31,
        granularity: 'day',
      },
      vehicleScope: { ...COMPANY_SCOPE, typeIds: [T1] },
      km: { ...need(MONTH.km), total: 999, byBranch: [] },
    } satisfies FleetDashboardPeriodDto);
    const filtered = block(renderDashboard({ url, client: qc, permissions: ALL_KEYS }), 'km');
    expect(text(filtered)).toContain('4,896');
    expect(text(filtered)).not.toContain('999');
    const kmLinks = links(filtered).filter((l) => l.metric.startsWith('km.'));
    expect(kmLinks.length).toBeGreaterThan(0);
    for (const l of kmLinks) {
      const { params } = parse(l.href);
      expect(params.get('from'), l.href).toBe(TODAY);
      expect(params.get('type'), l.href).toBeNull();
      expect(params.get('period'), l.href).toBeNull();
    }
  });

  it('shows its own skeleton while the month read is on its way', () => {
    const pending = tab({ month: null });
    expect(block(pending, 'km')).toContain('data-dist-loading="true"');
    // The rest of the tab is R1's and stands.
    expect(pending).toContain('data-fleet-matrix="true"');
  });

  it('draws no km block — not even a skeleton — without fleetOdometer.view', () => {
    const permissions = ALL_KEYS.filter((key) => key !== 'fleetOdometer.view');
    expect(tab({}, permissions)).not.toContain('data-dist-block="km"');
    expect(tab({ month: null }, permissions)).not.toContain('data-dist-block="km"');
    expect(links(tab({}, permissions)).filter((l) => l.href.startsWith('/fleet/odometer'))).toEqual(
      [],
    );
  });

  it('shows the section’s error when the month read could not compute the kilometres', () => {
    const failed = tab({ month: { ...MONTH, km: null, unavailable: ['km'] } });
    expect(block(failed, 'km')).toContain('data-section-error="km"');
  });
});

// ── One branch in scope ───────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — one branch in scope', () => {
  for (const [who, now] of [
    ['the switcher’s branch', NOW_BRANCH],
    ['a one-branch reader with no switcher', NOW_ONE],
  ] as const) {
    describe(who, () => {
      const html = tab({
        now,
        month: {
          ...MONTH_BRANCH,
          vehicleScope: { ...MONTH_BRANCH.vehicleScope, branchId: now.branchId },
        },
      });

      it('draws neither the branches, nor the matrix, nor the km by branch', () => {
        expect(html).not.toContain('data-dist-block="branches"');
        expect(html).not.toContain('data-fleet-matrix');
        expect(html).not.toContain('data-dist-block="km"');
        expect(text(head(html))).toContain(
          'سيارات الفرع النشطة حسب التشغيل والنوع، مقارنةً بسائقي الفرع، وكيلومترات هذا الشهر حسب النوع.',
        );
        expect(text(card(html, 'cash'))).toContain('من نشطة الفرع');
        expect(text(card(html, 'cash'))).toContain('من 14 سيارة نشطة في الفرع');
        expect(html).toContain('data-dist-drivers-note="true"');
      });

      it('draws the branch’s cars by type as bars, each opening its type in the branch', () => {
        const types = block(html, 'branch-types');
        expect(text(types)).toContain('سيارات الفرع حسب النوع');
        expect(text(types)).toContain('السيارات النشطة في الفرع');
        expect(hrefOf(types, 'distributionVehicles.branch')).toEqual([
          `/fleet/vehicles?status=active&branch=${B1}`,
        ]);
        expect(hrefOf(types, 'distributionVehicles.typeInBranch')).toEqual([
          `/fleet/vehicles?status=active&type=${T1}&branch=${B1}`,
          `/fleet/vehicles?status=active&type=${T2}&branch=${B1}`,
        ]);
        expect(types).toContain('data-bars-columns="2"');
        // A type with no car in the branch has no bar.
        expect(types).not.toContain(`data-bar="${T3}"`);
        expect(text(types)).toContain('طول كل شريط بالنسبة إلى أكبرها');
      });

      it('draws the branch’s kilometres by type from the month read, each opening its type', () => {
        const km = block(html, 'branch-km');
        expect(text(km)).toContain('كيلومترات الفرع هذا الشهر حسب النوع');
        expect(text(part(km, 'data-dash-month=', /<\/span>/u))).toContain('نوفمبر 2026');
        expect(text(km)).toContain('إجمالي كيلومترات الفرع');
        for (const href of hrefOf(km, 'km.byType')) {
          const { pathname, params } = parse(href);
          expect(pathname).toBe('/fleet/odometer');
          expect(params.get('from')).toBe(TODAY);
          expect(params.get('branch')).toBe(B1);
        }
        expect(hrefOf(km, 'km.byType').map((href) => parse(href).params.get('type'))).toEqual([
          T1,
          T2,
        ]);
        expect(text(km)).toContain(ar('fleet.dash.distribution.notClosedYet'));
      });
    });
  }
});

// ── «كل فروعي» ────────────────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — «كل فروعي»', () => {
  const html = tab({
    now: NOW_MINE,
    month: { ...MONTH, vehicleScope: { ...COMPANY_SCOPE, scopeBranches: [GIZA, CAIRO] } },
  });

  it('keeps the company’s layout over the reader’s branches, and says where the drivers sit', () => {
    expect(html).toContain('data-dist-block="branches"');
    expect(html).toContain('data-fleet-matrix="true"');
    expect(html).toContain('data-dist-block="km"');
    expect(html).not.toContain('data-dist-block="branch-types"');
    expect(text(html)).toContain(
      'السائقون حسب فرعهم في بيانات الموظفين، والسيارات حسب فرعها في سجل السيارات.',
    );
  });

  it('draws no drivers’ note for the whole company', () => {
    expect(tab()).not.toContain('data-dist-drivers-note');
  });

  it('says on «كل السيارات النشطة» whose cars and drivers it counts: the reader’s branches', () => {
    const all = card(html, 'all');
    expect(text(all)).toContain('كل تشغيلات فروعك، وسائقو فروعك');
    expect(text(all)).not.toContain('سجل السائقين كله');
    // Without the drivers' section: the cars alone.
    const carsOnly = card(tab({ now: { ...NOW_MINE, distributionDrivers: null } }), 'all');
    expect(text(carsOnly)).toContain('كل تشغيلات فروعك');
    expect(text(carsOnly)).not.toContain('سائقو فروعك');
    // The company's and one branch's keep their own words.
    expect(text(card(tab(), 'all'))).toContain('كل التشغيلات، وسجل السائقين كله');
    expect(text(card(tab({ now: NOW_BRANCH }), 'all'))).toContain('كل تشغيلات الفرع، وسائقو الفرع');
  });
});

// ── «عقود توريد السيارات» ─────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — this year’s supply contracts', () => {
  const html = tab({}, SUPPLY_KEYS);
  const supply = block(html, 'supply');

  it('is drawn only for a reader of the contracts screen', () => {
    const without = tab();
    expect(without).not.toContain('data-dist-block="supply"');
    expect(links(without).filter((l) => l.href.startsWith('/fleet/vehicle-contracts'))).toEqual([]);
    expect(supply).not.toBe('');
  });

  it('says whose contracts they are: the year’s, by the contract date', () => {
    expect(text(supply)).toContain(ar('fleet.vehicleContracts.title'));
    expect(text(supply)).toContain('عقود 2026');
    expect(text(supply)).toContain('الأرقام لعقود التوريد المؤرخة في عام 2026 وحدها.');
  });

  it('counts cars received of cars contracted, the cars still owed, and the alarms in contracts', () => {
    const received = part(supply, 'data-supply-tile="received"', /data-supply-tile="/u);
    expect(text(received)).toContain('المستلمة');
    expect(text(received)).toMatch(/30 من 50 سيارة متعاقد عليها/u);
    const remaining = part(supply, 'data-supply-tile="remaining"', /data-supply-tile="/u);
    expect(text(remaining)).toMatch(/المتبقية 20 سيارة/u);
    // A difference with no list of its own: plain, as the approved sample draws it.
    expect(remaining).not.toContain('<a');
    expect(text(part(supply, 'data-supply-alarm="red"', /data-supply-alarm="/u))).toMatch(
      /أحمر 1 عقد/u,
    );
    expect(text(part(supply, 'data-supply-alarm="yellow"', /<\/div>\s*<\/div>/u))).toMatch(
      /أصفر 2 عقود/u,
    );
  });

  it('opens every figure on the contracts of the year — never a bare list — the alarms on their level', () => {
    const supplyLinks = links(supply);
    expect(supplyLinks.map((l) => l.metric).sort()).toEqual(
      [
        'supplyContracts.contracted',
        'supplyContracts.open',
        'supplyContracts.received',
        'supplyContracts.red',
        'supplyContracts.yellow',
      ].sort(),
    );
    for (const l of supplyLinks) {
      const { pathname, params } = parse(l.href);
      expect(pathname, l.metric).toBe('/fleet/vehicle-contracts');
      expect(params.get('from'), l.metric).toBe(YEAR.from);
      expect(params.get('to'), l.metric).toBe(YEAR.to);
      const level =
        l.metric === 'supplyContracts.red'
          ? 'red'
          : l.metric === 'supplyContracts.yellow'
            ? 'yellow'
            : null;
      expect(params.get('alarm'), l.metric).toBe(level);
    }
    expect(text(supply)).toContain(ar('fleet.dash.distribution.supply.open'));
  });

  it('wears «الشركة كلها» while the rest is narrowed to the reader’s branches — never for the company', () => {
    expect(supply).not.toContain('data-company-wide');
    for (const now of [NOW_BRANCH, NOW_MINE]) {
      expect(block(tab({ now }, SUPPLY_KEYS), 'supply')).toContain('data-company-wide="true"');
    }
  });

  it('says so when no contract is dated this year', () => {
    const empty = block(
      tab(
        {
          supply: [
            { count: 0, value: 0, contracted: 0, received: 0 },
            { count: 0, value: 0, contracted: 0, received: 0 },
            { count: 0, value: 0, contracted: 0, received: 0 },
          ],
        },
        SUPPLY_KEYS,
      ),
      'supply',
    );
    expect(text(empty)).toContain('لا توجد عقود توريد مؤرخة في عام 2026.');
    expect(empty).not.toContain('data-supply-tile=');
    expect(hrefOf(empty, 'supplyContracts.open')).toHaveLength(1);
  });

  it('a summary that failed: the contracts’ own error and retry; the rest of the tab stands', () => {
    // Any one of the three (all, red, yellow) failing with nothing to show fails the part: a
    // tile of the three cannot be drawn from two.
    const keys = [
      vehicleContractSummaryKey(YEAR),
      vehicleContractSummaryKey({ ...YEAR, alarm: ['red'] }),
      vehicleContractSummaryKey({ ...YEAR, alarm: ['yellow'] }),
    ];
    for (const key of keys) {
      const qc = client();
      qc.removeQueries({ queryKey: key, exact: true });
      // A read the cache holds as a rejected request leaves it.
      qc.setQueryDefaults(key, { retryOnMount: false });
      const query = qc.getQueryCache().build(qc, { queryKey: key });
      query.setState({
        ...query.state,
        status: 'error',
        error: new Error('read down'),
        errorUpdatedAt: 1,
        fetchStatus: 'idle',
      });
      const html2 = renderDashboard({
        url: '/fleet?tab=distribution',
        client: qc,
        permissions: SUPPLY_KEYS,
      });
      const failedPart = block(html2, 'supply');
      expect(failedPart, JSON.stringify(key)).toContain('data-section-error="supplyContracts"');
      expect(failedPart).not.toContain('data-supply-tile=');
      expect(failedPart).not.toContain('data-dist-loading="true"');
      // Its head stays: the reader sees which part failed, and can still open the contracts.
      expect(text(failedPart)).toContain(ar('fleet.vehicleContracts.title'));
      expect(hrefOf(failedPart, 'supplyContracts.open')).toHaveLength(1);
      // R1's parts and the month's kilometres are not this read's.
      expect(html2).toContain('data-op-card="all"');
      expect(html2).toContain('data-fleet-matrix="true"');
      expect(block(html2, 'km')).not.toContain('data-section-error');
    }
  });

  it('shows its own skeleton while the summaries are on their way', () => {
    const pending = block(tab({ supply: null }, SUPPLY_KEYS), 'supply');
    expect(pending).toContain('data-dist-loading="true"');
    expect(pending).not.toContain('data-supply-tile=');
  });
});

// ── The bar and the source ────────────────────────────────────────────────────────────────────

describe('«توزيع السيارات» — the bar', () => {
  it('carries no count on its pill (the approved bar has none)', () => {
    expect(tab()).not.toContain('data-dash-badge="distribution"');
  });

  it('draws no sample marker', () => {
    expect(tab({}, SUPPLY_KEYS)).not.toMatch(/data-zz-/u);
  });
});
