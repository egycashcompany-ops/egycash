// «لوحة تحكم» on «محصنات الخزينة» (Round 16 — «أنا عايز يكون فيها لوحة تحكم اللي هي داشبورد جنب
// الإحصائيات») — the dashboard's decisions, pinned directly: the tiles off the rows shown, the five
// alerts, «جدول التسليم» on the server's Cairo day, «مدة البقاء في الخزينة» on the Cairo calendar,
// «بيان الشحنات لكل بنك» in the banks' order, and the line of filters at the top.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type OperationsCurrencyDto } from '@ecms/contracts';
import { EMPTY_DAY_BOARD_FILTERS } from './day-board';
import {
  AGING_BUCKETS,
  DASHBOARD_ALERTS,
  agingBucketOf,
  dashboardAlertDay,
  dashboardBankRows,
  dashboardFilterChips,
  dashboardTotals,
  isUnplacedToday,
  scheduleHeights,
  securedDispatchDashboard,
  type DashboardPackages,
  type DashboardRow,
} from './secured-dispatch-dashboard';

const currency = (
  id: string,
  code: string,
  name: string,
  sortOrder: number,
): OperationsCurrencyDto => ({
  id,
  code,
  name,
  legacyAliases: [],
  sortOrder,
  isActive: true,
  version: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
// Production's catalog: legacy numeric codes — the pound is «1», never `EGP`.
const CATALOG = [
  currency('egp', '1', 'مصري', 0),
  currency('usd', '2', 'دولار', 1),
  currency('eur', '3', 'يورو', 2),
  currency('sar', '4', 'ريال سعودي', 3),
];
const BANKS = [
  { id: 'b-misr', code: 2, sortOrder: 2, opsName: 'مصر' },
  { id: 'b-ahly', code: 1, sortOrder: 1, opsName: 'الأهلي' },
  { id: 'b-cairo', code: 3, sortOrder: null, opsName: 'القاهرة' },
];

const TODAY = '2026-11-14';
const CREW = {
  crewAssignmentId: 'ca-1',
  vehicleId: 'v-150',
  vehicleCode: '150',
  captainEmployeeId: 'e-1',
  captainName: 'محمود حسن',
  captainCode: null,
  captainPhone: null,
  captainBranchId: null,
};

const row = (
  id: string,
  over: Partial<DashboardRow> & { due?: string | null } = {},
): DashboardRow => {
  const { due = TODAY, ...rest } = over;
  return {
    id,
    mainBankId: 'b-ahly',
    lines: [{ currencyId: 'egp', amount: 1_000_000 }],
    deliveryDate: due === null ? null : `${due}T00:00:00.000Z`,
    overdue: due !== null && due < TODAY,
    crew: null,
    vaultReceivedAt: `${TODAY}T08:00:00.000Z`,
    ...rest,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the rows rolled up — a report total, as «تقرير الخزينة» reads one', () => {
  it('counts each محصنة once, its packages once, and every currency on its own', () => {
    const packaging = new Map<string, DashboardPackages>([
      ['a', { bags: 3, cartons: 1, boxes: 0 }],
      ['b', { bags: 2, cartons: 0, boxes: 1 }],
    ]);
    const totals = dashboardTotals(
      [
        // Three currencies on one محصنة: its 3 bags are still 3 (Q26 — never once per currency).
        row('a', {
          lines: [
            { currencyId: 'egp', amount: 500 },
            { currencyId: 'usd', amount: 20 },
            { currencyId: 'eur', amount: 7 },
          ],
        }),
        row('b', { lines: [{ currencyId: 'egp', amount: 250 }] }),
        // Not in the custody list (yet): counted, no packages guessed.
        row('c', { lines: [{ currencyId: 'zzz', amount: 9 }] }),
      ],
      CATALOG,
      packaging,
    );
    expect(totals.shipmentCount).toBe(3);
    expect([totals.bagCount, totals.cartonCount, totals.boxCount]).toEqual([5, 1, 1]);
    expect(totals.currencies).toEqual([
      { currencyId: 'egp', currencyName: 'مصري', amount: 750 },
      { currencyId: 'usd', currencyName: 'دولار', amount: 20 },
      { currencyId: 'eur', currencyName: 'يورو', amount: 7 },
      { currencyId: 'zzz', currencyName: '', amount: 9 },
    ]);
  });

  it('reads no packages at all before the custody list is in', () => {
    const totals = dashboardTotals([row('a'), row('b')], CATALOG);
    expect([totals.shipmentCount, totals.bagCount, totals.cartonCount, totals.boxCount]).toEqual([
      2, 0, 0, 0,
    ]);
  });
});

describe('the figure tiles — the rows SHOWN, split by the boards’ classifier', () => {
  it('splits the pound coded «1», the dollar and «عملات أخرى» kept apart per currency', () => {
    const dash = securedDispatchDashboard({
      rows: [
        row('a', {
          lines: [
            { currencyId: 'egp', amount: 4_500_000 },
            { currencyId: 'usd', amount: 120_000 },
          ],
        }),
        row('b', {
          lines: [
            { currencyId: 'sar', amount: 60_000 },
            { currencyId: 'eur', amount: 20_000 },
          ],
        }),
      ],
      today: TODAY,
      catalog: CATALOG,
      banks: BANKS,
      packaging: new Map([['a', { bags: 4, cartons: 2, boxes: 1 }]]),
    });
    expect(dash.tiles.count).toBe(2);
    expect(dash.tiles.money.egp).toBe(4_500_000);
    expect(dash.tiles.money.usd).toBe(120_000);
    expect(dash.tiles.money.othersSum).toBe(80_000);
    // In the reference list's order, as the breakdown lists them.
    expect(dash.tiles.money.others.map((line) => line.name)).toEqual(['يورو', 'ريال سعودي']);
    expect([dash.tiles.bags, dash.tiles.cartons, dash.tiles.boxes]).toEqual([4, 2, 1]);
    // The tiles and «الإجمالي» are one total.
    expect(dash.grandTotal.shipmentCount).toBe(dash.tiles.count);
  });

  it('keeps every section at zero when no row is shown — «على الاقل الاشكال موجودة»', () => {
    const dash = securedDispatchDashboard({
      rows: [],
      today: TODAY,
      catalog: CATALOG,
      banks: BANKS,
    });
    expect(dash.tiles).toMatchObject({ count: 0, bags: 0, cartons: 0, boxes: 0 });
    expect(dash.tiles.money).toMatchObject({ egp: 0, usd: 0, othersSum: 0 });
    for (const alert of DASHBOARD_ALERTS) expect(dash.alerts[alert]).toEqual({ count: 0, egp: 0 });
    expect(dash.schedule).toHaveLength(10);
    expect(dash.schedule.every((bucket) => bucket.count === 0 && bucket.egp === 0)).toBe(true);
    for (const bucket of AGING_BUCKETS) expect(dash.aging[bucket]).toEqual({ count: 0, egp: 0 });
    expect(dash.undated).toEqual({ count: 0, egp: 0 });
    expect(dash.bankRows).toEqual([]);
  });
});

describe('the alerts — five, each a count and its pound', () => {
  const ROWS = [
    // Overdue: the server says so, or the day says so — the board's own mark (`dispatchDue`).
    row('late-flag', { due: '2026-11-12', lines: [{ currencyId: 'egp', amount: 100 }] }),
    row('late-day', {
      due: '2026-11-13',
      overdue: false,
      crew: CREW,
      lines: [{ currencyId: 'egp', amount: 200 }],
    }),
    // Today: one on a van of today, one on none.
    row('today-van', { crew: CREW, lines: [{ currencyId: 'egp', amount: 400 }] }),
    row('today-none', {
      lines: [
        { currencyId: 'egp', amount: 800 },
        { currencyId: 'usd', amount: 5 },
      ],
    }),
    // Tomorrow, on no van yet — not «لم تُوزَّع»: today's vans are what that counts.
    row('tomorrow', { due: '2026-11-15', lines: [{ currencyId: 'egp', amount: 1_600 }] }),
    row('later', { due: '2026-11-20', lines: [{ currencyId: 'egp', amount: 3_200 }] }),
    row('undated', { due: null, lines: [{ currencyId: 'egp', amount: 6_400 }] }),
  ];
  const dash = securedDispatchDashboard({
    rows: ROWS,
    today: TODAY,
    catalog: CATALOG,
    banks: BANKS,
  });

  it('in the order they are read', () => {
    expect(DASHBOARD_ALERTS).toEqual(['overdue', 'today', 'tomorrow', 'undated', 'unplaced']);
  });

  it('counts the late ones — the server’s flag or a day gone — and their pound', () => {
    expect(dash.alerts.overdue).toEqual({ count: 2, egp: 300 });
  });

  it('counts today’s and tomorrow’s, and the ones with no delivery day', () => {
    // The dollar on «today-none» is not the pound.
    expect(dash.alerts.today).toEqual({ count: 2, egp: 1_200 });
    expect(dash.alerts.tomorrow).toEqual({ count: 1, egp: 1_600 });
    expect(dash.alerts.undated).toEqual({ count: 1, egp: 6_400 });
  });

  it('«لم تُوزَّع على سيارة»: every late one (its van, if any, is a past day’s) and today’s on no van', () => {
    expect(dash.alerts.unplaced).toEqual({ count: 3, egp: 100 + 200 + 800 });
    expect(isUnplacedToday(row('x', { due: '2026-11-10', crew: CREW }), TODAY)).toBe(true);
    expect(isUnplacedToday(row('x', { crew: CREW }), TODAY)).toBe(false);
    expect(isUnplacedToday(row('x'), TODAY)).toBe(true);
    expect(isUnplacedToday(row('x', { due: '2026-11-15' }), TODAY)).toBe(false);
    expect(isUnplacedToday(row('x', { due: null }), TODAY)).toBe(false);
  });

  it('says which alerts the board’s own «تاريخ التسليم» can show — today and tomorrow, no other', () => {
    expect(dashboardAlertDay('today', TODAY)).toBe('2026-11-14');
    expect(dashboardAlertDay('tomorrow', TODAY)).toBe('2026-11-15');
    // Across a month's end, on the calendar.
    expect(dashboardAlertDay('tomorrow', '2026-11-30')).toBe('2026-12-01');
    for (const alert of ['overdue', 'undated', 'unplaced'] as const)
      expect(dashboardAlertDay(alert, TODAY)).toBeNull();
    // No day to count from: nothing to filter to.
    expect(dashboardAlertDay('tomorrow', '')).toBeNull();
  });
});

describe('«جدول التسليم» — late, today, the next seven days, later', () => {
  it('draws every column in order, zeros included, the days named', () => {
    const dash = securedDispatchDashboard({
      rows: [],
      today: TODAY,
      catalog: CATALOG,
      banks: BANKS,
    });
    expect(dash.schedule.map((bucket) => bucket.key)).toEqual([
      'overdue',
      'today',
      'day:2026-11-15',
      'day:2026-11-16',
      'day:2026-11-17',
      'day:2026-11-18',
      'day:2026-11-19',
      'day:2026-11-20',
      'day:2026-11-21',
      'later',
    ]);
    expect(dash.schedule.map((bucket) => bucket.kind)).toEqual([
      'overdue',
      'today',
      ...Array<string>(7).fill('day'),
      'later',
    ]);
    expect(dash.schedule[1]?.day).toBe(TODAY);
    expect(dash.schedule[0]?.day).toBeNull();
    expect(dash.schedule[9]?.day).toBeNull();
  });

  it('puts the seventh day in its own column and the eighth in «لاحقًا»; no day is said under it', () => {
    const rows = [
      row('a', { due: '2026-11-01' }),
      row('b'),
      row('c', { due: '2026-11-15' }),
      row('d', { due: '2026-11-15' }),
      row('e', { due: '2026-11-21' }),
      row('f', { due: '2026-11-22' }),
      row('g', { due: '2027-01-05' }),
      row('h', { due: null }),
    ];
    const dash = securedDispatchDashboard({ rows, today: TODAY, catalog: CATALOG, banks: BANKS });
    const count = Object.fromEntries(dash.schedule.map((bucket) => [bucket.key, bucket.count]));
    expect(count).toMatchObject({
      overdue: 1,
      today: 1,
      'day:2026-11-15': 2,
      'day:2026-11-21': 1,
      later: 2,
    });
    expect(dash.undated.count).toBe(1);
    // Every dated row is in exactly one column.
    expect(dash.schedule.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(rows.length - 1);
    expect(dash.schedule.find((bucket) => bucket.key === 'day:2026-11-15')?.egp).toBe(2_000_000);
  });

  it('judges the day on the SERVER’s Cairo today, never the browser’s clock', () => {
    // 22:30 UTC on the 13th is 00:30 on the 14th in Cairo: the server's today is the 14th while a
    // UTC clock still says the 13th. The row due the 14th is today's; the one due the 13th is late.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T22:30:00.000Z'));
    const dash = securedDispatchDashboard({
      rows: [row('due-13', { due: '2026-11-13', overdue: true }), row('due-14')],
      today: '2026-11-14',
      catalog: CATALOG,
      banks: BANKS,
    });
    expect(dash.schedule[0]?.count).toBe(1);
    expect(dash.schedule[1]?.count).toBe(1);
    expect(dash.alerts.tomorrow.count).toBe(0);
  });

  it('rolls its seven days over a month’s end', () => {
    const dash = securedDispatchDashboard({
      rows: [row('a', { due: '2026-12-02', overdue: false })],
      today: '2026-11-30',
      catalog: CATALOG,
      banks: BANKS,
    });
    expect(dash.schedule.slice(2, 4).map((bucket) => bucket.key)).toEqual([
      'day:2026-12-01',
      'day:2026-12-02',
    ]);
    expect(dash.schedule[3]?.count).toBe(1);
  });

  it('draws each column against the tallest, all at the baseline when nothing is due', () => {
    expect(scheduleHeights([{ count: 0 }, { count: 0 }])).toEqual([0, 0]);
    expect(scheduleHeights([{ count: 2 }, { count: 4 }, { count: 0 }])).toEqual([0.5, 1, 0]);
  });
});

describe('«مدة البقاء في الخزينة» — the Cairo day it was received, against today', () => {
  const at = (iso: string): DashboardRow => row('x', { vaultReceivedAt: iso });

  it('buckets today, 1–2, 3–6, 7 and more', () => {
    expect(AGING_BUCKETS).toEqual(['today', 'days1to2', 'days3to6', 'days7plus']);
    expect(agingBucketOf(at('2026-11-14T08:00:00.000Z'), TODAY)).toBe('today');
    expect(agingBucketOf(at('2026-11-13T08:00:00.000Z'), TODAY)).toBe('days1to2');
    expect(agingBucketOf(at('2026-11-12T08:00:00.000Z'), TODAY)).toBe('days1to2');
    expect(agingBucketOf(at('2026-11-11T08:00:00.000Z'), TODAY)).toBe('days3to6');
    expect(agingBucketOf(at('2026-11-08T08:00:00.000Z'), TODAY)).toBe('days3to6');
    expect(agingBucketOf(at('2026-11-07T08:00:00.000Z'), TODAY)).toBe('days7plus');
    expect(agingBucketOf(at('2026-09-01T08:00:00.000Z'), TODAY)).toBe('days7plus');
  });

  it('reads the day on Cairo’s calendar across midnight — never the UTC day', () => {
    // 00:30 Cairo on the 14th is 22:30 UTC on the 13th: received TODAY.
    expect(agingBucketOf(at('2026-11-13T22:30:00.000Z'), TODAY)).toBe('today');
    // 23:59 Cairo on the 13th is 21:59 UTC: yesterday.
    expect(agingBucketOf(at('2026-11-13T21:59:00.000Z'), TODAY)).toBe('days1to2');
    // A receipt stamped after today (a clock ahead) is today's, never a negative wait.
    expect(agingBucketOf(at('2026-11-16T08:00:00.000Z'), TODAY)).toBe('today');
  });

  it('never guesses a wait the row does not say — counted apart', () => {
    expect(agingBucketOf(row('x', { vaultReceivedAt: null }), TODAY)).toBeNull();
    expect(agingBucketOf(at('not a time'), TODAY)).toBeNull();
    const dash = securedDispatchDashboard({
      rows: [
        row('a', { vaultReceivedAt: null }),
        row('b', { vaultReceivedAt: '2026-11-05T10:00:00.000Z' }),
        row('c', { vaultReceivedAt: '2026-11-05T10:00:00.000Z' }),
      ],
      today: TODAY,
      catalog: CATALOG,
      banks: BANKS,
    });
    expect(dash.agingUnknown).toBe(1);
    expect(dash.aging.days7plus).toEqual({ count: 2, egp: 2_000_000 });
    expect(dash.aging.today.count).toBe(0);
  });
});

describe('«بيان الشحنات لكل بنك» — the rows shown, per main bank, in the banks’ order', () => {
  const packaging = new Map([
    ['a', { bags: 1, cartons: 0, boxes: 0 }],
    ['b', { bags: 2, cartons: 1, boxes: 0 }],
    ['c', { bags: 4, cartons: 0, boxes: 1 }],
  ]);
  const rows = dashboardBankRows(
    [
      row('a', { mainBankId: 'b-misr' }),
      row('b', { mainBankId: 'b-ahly', lines: [{ currencyId: 'usd', amount: 50 }] }),
      row('c', { mainBankId: 'b-ahly' }),
      row('d', { mainBankId: 'b-gone' }),
      row('e', { mainBankId: 'b-cairo' }),
    ],
    BANKS,
    CATALOG,
    packaging,
  );

  it('orders the banks by their place (Q31), an unplaced one after, an unknown one last', () => {
    expect(rows.map((r) => r.label)).toEqual(['الأهلي', 'مصر', 'القاهرة', '…']);
    expect(rows.map((r) => r.key)).toEqual(['b-ahly', 'b-misr', 'b-cairo', 'b-gone']);
    expect(rows.every((r) => !r.unattributed)).toBe(true);
  });

  it('rolls each bank’s rows up, packages once per محصنة', () => {
    const ahly = rows[0]?.totals;
    expect(ahly?.shipmentCount).toBe(2);
    expect([ahly?.bagCount, ahly?.cartonCount, ahly?.boxCount]).toEqual([6, 1, 1]);
    expect(ahly?.currencies).toEqual([
      { currencyId: 'usd', currencyName: 'دولار', amount: 50 },
      { currencyId: 'egp', currencyName: 'مصري', amount: 1_000_000 },
    ]);
    // The banks add up to the rows shown — nothing dropped, nothing counted twice.
    expect(rows.reduce((sum, r) => sum + r.totals.shipmentCount, 0)).toBe(5);
  });
});

describe('the line at the top — the filters in force, in the bar’s order', () => {
  it('says nothing is filtered when nothing is', () => {
    expect(dashboardFilterChips(EMPTY_DAY_BOARD_FILTERS, null)).toEqual([]);
    // Blank text narrows nothing on the board, so it is not said here either.
    expect(dashboardFilterChips({ ...EMPTY_DAY_BOARD_FILTERS, bank: '   ' }, null)).toEqual([]);
  });

  it('names each one in force, the delivery day at the date column’s place', () => {
    expect(
      dashboardFilterChips(
        {
          ...EMPTY_DAY_BOARD_FILTERS,
          notes: 'صباحي',
          bank: ' الأهلي ',
          stage: 'inVault',
          vehicle: '150',
        },
        '2026-11-15',
      ),
    ).toEqual([
      { param: 'vehicle', value: '150' },
      { param: 'bank', value: 'الأهلي' },
      { param: 'date', value: '2026-11-15' },
      { param: 'stage', value: 'inVault' },
      { param: 'notes', value: 'صباحي' },
    ]);
  });
});
