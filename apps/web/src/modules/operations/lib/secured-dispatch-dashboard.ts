// «لوحة تحكم» on «محصنات الخزينة» (Round 16) — the dashboard's decisions as pure functions, so each
// is asserted directly (`secured-dispatch-dashboard.spec.ts`).
//
// THE OWNER: «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي داشبورد جنب الإحصائيات». He
// knows two of them already: Fleet's custody board, whose «لوحة تحكم» beside «الإحصائيات» opens
// «كل حاجة بالتفصيل» over the board's OWN filters, and «تقرير الخزينة» on «سجل الخزينة». So this one
// is read off the board's own rows — the rows SHOWN, after every filter and before the pages
// (`ShipmentsBoard` hands them to the page's toolbar) — and never asks the server for a second
// answer that could disagree with the table under it. The one thing the rows do not carry is what
// the vault counted on each one (its bags, cartons and boxes — the custody's, counted at the vault's
// receipt): those come from the custody list by shipment (`useVaultPackaging`), as «تسليم المحصنات»
// reads them.
//
// THE MONEY IS SPLIT THE BOARDS' WAY. The rows' currencies are rolled into a report total
// (`OperationsReportTotalsDto`, the shape «تقرير الخزينة» reads) and split by the reports' one
// classifier (`reportMoney` → `currencyKind`: code, name or legacy alias), so «المصري» on a tile, on
// an alert, in «بيان الشحنات لكل بنك» and in «إجمالي قيمة الشحنات» is one figure read four times.
//
// THE DAYS ARE THE SERVER'S. «متأخرة» and «تسليمها اليوم» are the board's own marks (`dispatchDue`,
// judged on the server's `today` — the day it sorted by), and every other day is counted from that
// same `today`: a desk whose clock is off can never move a محصنة from «اليوم» to «غدًا».
import {
  addDaysYmd,
  cairoYmd,
  daysBetweenYmd,
  isYmd,
  type OperationsBankDto,
  type OperationsCurrencyDto,
  type OperationsReportTotalsDto,
  type OperationsSecuredDispatchRowDto,
} from '@ecms/contracts';
import { type DayBoardFilters } from './day-board';
import { bankRank, reportMoney, reportRowsInOrder, type ReportBoardRow } from './report-board';
import { deliveryDayOf, dispatchDue } from './secured-dispatch';
import { heldReportTiles, type HeldReportTiles } from './vault-held-report';

/** The fields of a row the dashboard reads — the specs build rows with no more. */
export type DashboardRow = Pick<
  OperationsSecuredDispatchRowDto,
  'id' | 'mainBankId' | 'lines' | 'deliveryDate' | 'overdue' | 'crew' | 'vaultReceivedAt'
>;

/** What the vault counted on one محصنة at its receipt (`useVaultPackaging`). */
export interface DashboardPackages {
  bags: number;
  cartons: number;
  boxes: number;
}

/** A count of محصنات and their pound — what every alert, bar and bucket says. */
export interface DashboardFigure {
  count: number;
  /** «المصري» of those rows, split by the boards' classifier. */
  egp: number;
}

/**
 * The rows rolled up as a report row is (`OperationsReportTotalsDto`): one count per محصنة, its
 * packages counted once (Q26 — never once per currency), every currency on its own, named by the
 * catalog. A row the custody list does not name (yet) adds no packages — it is still counted.
 */
export const dashboardTotals = (
  rows: readonly DashboardRow[],
  catalog: readonly OperationsCurrencyDto[],
  packaging?: ReadonlyMap<string, DashboardPackages>,
): OperationsReportTotalsDto => {
  const money = new Map<string, number>();
  let bagCount = 0;
  let cartonCount = 0;
  let boxCount = 0;
  for (const row of rows) {
    const own = packaging?.get(row.id);
    bagCount += own?.bags ?? 0;
    cartonCount += own?.cartons ?? 0;
    boxCount += own?.boxes ?? 0;
    for (const line of row.lines) {
      money.set(line.currencyId, (money.get(line.currencyId) ?? 0) + line.amount);
    }
  }
  const nameOf = new Map(catalog.map((currency) => [currency.id, currency.name]));
  return {
    shipmentCount: rows.length,
    bagCount,
    cartonCount,
    boxCount,
    currencies: [...money.entries()].map(([currencyId, amount]) => ({
      currencyId,
      currencyName: nameOf.get(currencyId) ?? '',
      amount,
    })),
  };
};

/** How many rows, and their pound. */
export const dashboardFigure = (
  rows: readonly DashboardRow[],
  catalog: readonly OperationsCurrencyDto[],
): DashboardFigure => ({
  count: rows.length,
  egp: reportMoney(dashboardTotals(rows, catalog).currencies, catalog).egp,
});

// ── The alerts ────────────────────────────────────────────────────────────────────────────────

/**
 * The dashboard's five alerts, in the order they are read:
 *
 *   · `overdue`  — «متأخرة»: its delivery day has passed and it is still in the vault (the board's
 *                  red mark, `dispatchDue`);
 *   · `today`    — «تسليمها اليوم» (the board's amber mark);
 *   · `tomorrow` — «تسليمها غدًا»: due the server's next day;
 *   · `undated`  — «بدون يوم تسليم»: no delivery day at all — nothing will put it on a van until one
 *                  is given;
 *   · `unplaced` — «لم تُوزَّع على سيارة»: of those due today or overdue, the ones on none of TODAY's
 *                  vans — exactly what waits in «توزيع المحصنات»'s unplaced column. The rows say it
 *                  reliably: a row's `crew` is its DELIVERY leg's, and a delivery leg rides a van of
 *                  its row's delivery day — the assign refuses any other day
 *                  (`OPERATIONS_CREW_DAY_MISMATCH`), and moving a delivery day retires the leg. So a
 *                  row due today is on one of today's vans exactly when it has a crew; an overdue
 *                  row's crew, when it has one, is its OLD day's van, which left without it (placing
 *                  it on today's van moves its delivery day to today, and it is no longer overdue).
 *                  Every overdue row is therefore unplaced today.
 */
export const DASHBOARD_ALERTS = ['overdue', 'today', 'tomorrow', 'undated', 'unplaced'] as const;
export type DashboardAlert = (typeof DASHBOARD_ALERTS)[number];

/** Is this row due today or overdue and on none of today's vans? (See `unplaced` above.) */
export const isUnplacedToday = (
  row: Pick<DashboardRow, 'deliveryDate' | 'overdue' | 'crew'>,
  today: string,
): boolean => {
  const due = dispatchDue(row, today);
  return due === 'overdue' || (due === 'today' && row.crew === null);
};

/**
 * The delivery day the board's own filter takes to show an alert's rows — «تسليمها اليوم» is the
 * board's «تاريخ التسليم» set to today, «تسليمها غدًا» to tomorrow — or null where the board's
 * filters cannot say it (late is many days; «no day» and «on no van» have no box): such an alert is
 * read, not clicked.
 */
export const dashboardAlertDay = (alert: DashboardAlert, today: string): string | null => {
  if (alert === 'today') return today;
  if (alert === 'tomorrow') return isYmd(today) ? addDaysYmd(today, 1) : null;
  return null;
};

// ── «جدول التسليم» ────────────────────────────────────────────────────────────────────────────

/** How many days after today the schedule names one by one before «لاحقًا». */
export const SCHEDULE_DAYS = 7;

/** One column of «جدول التسليم». */
export interface ScheduleBucket extends DashboardFigure {
  key: string;
  kind: 'overdue' | 'today' | 'day' | 'later';
  /** The delivery day of a `today` or `day` column, 'YYYY-MM-DD' — null for the two others. */
  day: string | null;
}

// ── «مدة البقاء في الخزينة» ───────────────────────────────────────────────────────────────────

/** Days since the vault received it, on the Cairo calendar: today, 1–2, 3–6, 7 and more. */
export const AGING_BUCKETS = ['today', 'days1to2', 'days3to6', 'days7plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * Which bucket a row's wait falls in — the Cairo DAY it was received, against the server's today,
 * never hours: «منذ 2026-11-08» is what the board prints under «بالخزينة», and a محصنة received at
 * 00:30 Cairo is today's even though it is still yesterday in UTC. Null when the row says no receipt
 * time (or not one that can be read). A receipt dated after today (a clock ahead) is today's.
 */
export const agingBucketOf = (
  row: Pick<DashboardRow, 'vaultReceivedAt'>,
  today: string,
): AgingBucket | null => {
  if (row.vaultReceivedAt === null || !isYmd(today)) return null;
  const at = new Date(row.vaultReceivedAt);
  if (Number.isNaN(at.getTime())) return null;
  const days = daysBetweenYmd(cairoYmd(at), today);
  if (days <= 0) return 'today';
  if (days <= 2) return 'days1to2';
  if (days <= 6) return 'days3to6';
  return 'days7plus';
};

// ── «بيان الشحنات لكل بنك» ────────────────────────────────────────────────────────────────────

/**
 * The rows rolled up per MAIN (billed) bank — the key every per-bank roll-up uses, «تقرير الخزينة»'s
 * included — in the banks' reference order (Q31, `bankRank`), each named as the board names it (the
 * bank's `opsName`). Every row has a main bank, so nothing is unattributed; a bank the catalog does
 * not hold (yet) keeps its row, named «…», after the ones it does.
 */
export const dashboardBankRows = (
  rows: readonly DashboardRow[],
  banks: readonly Pick<OperationsBankDto, 'id' | 'code' | 'sortOrder' | 'opsName'>[],
  catalog: readonly OperationsCurrencyDto[],
  packaging?: ReadonlyMap<string, DashboardPackages>,
): ReportBoardRow[] => {
  const byBank = new Map<string, DashboardRow[]>();
  for (const row of rows) {
    const own = byBank.get(row.mainBankId);
    if (own === undefined) byBank.set(row.mainBankId, [row]);
    else own.push(row);
  }
  const nameOf = new Map(banks.map((bank) => [bank.id, bank.opsName]));
  const rankOf = bankRank(banks);
  return reportRowsInOrder(
    [...byBank.entries()].map(([bankId, own]) => ({
      key: bankId,
      label: nameOf.get(bankId) ?? '…',
      unattributed: false,
      totals: dashboardTotals(own, catalog, packaging),
    })),
    () => false,
    (row) => rankOf(row.key),
  );
};

// ── The whole dashboard ───────────────────────────────────────────────────────────────────────

export interface SecuredDispatchDashboard {
  /** The rows SHOWN rolled up — what the tiles, «الإجمالي» and «إجمالي قيمة الشحنات» read. */
  grandTotal: OperationsReportTotalsDto;
  /** «عدد المحصنات», «المصري», «الدولار», «عملات أخرى», «الحقائب», «الكراتين», «الصناديق». */
  tiles: HeldReportTiles;
  alerts: Record<DashboardAlert, DashboardFigure>;
  /** Overdue, today, the next seven days one by one, then later — every column, zeros included. */
  schedule: ScheduleBucket[];
  /** The rows with no delivery day: the schedule has no column for them, and says so under it. */
  undated: DashboardFigure;
  aging: Record<AgingBucket, DashboardFigure>;
  /** Rows with no receipt time to age them by — said under the buckets, never guessed at. */
  agingUnknown: number;
  bankRows: ReportBoardRow[];
}

/**
 * Everything the dashboard shows, from the board's shown rows alone. With no row every figure is
 * zero and every section keeps its frame — the custody dashboard's rule, «على الاقل الاشكال موجودة».
 */
export const securedDispatchDashboard = ({
  rows,
  today,
  catalog,
  banks,
  packaging,
}: {
  rows: readonly DashboardRow[];
  /** The server's today, 'YYYY-MM-DD' (`OperationsSecuredDispatchBoardDto.today`). */
  today: string;
  catalog: readonly OperationsCurrencyDto[];
  banks: readonly Pick<OperationsBankDto, 'id' | 'code' | 'sortOrder' | 'opsName'>[];
  packaging?: ReadonlyMap<string, DashboardPackages> | undefined;
}): SecuredDispatchDashboard => {
  const grandTotal = dashboardTotals(rows, catalog, packaging);
  const valid = isYmd(today);
  const tomorrow = valid ? addDaysYmd(today, 1) : null;
  const days = valid
    ? Array.from({ length: SCHEDULE_DAYS }, (_, index) => addDaysYmd(today, index + 1))
    : [];

  const alertRows: Record<DashboardAlert, DashboardRow[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    undated: [],
    unplaced: [],
  };
  // The schedule's columns by key, in the order they are drawn.
  const scheduleRows = new Map<string, DashboardRow[]>([
    ['overdue', []],
    ['today', []],
    ...days.map((day): [string, DashboardRow[]] => [`day:${day}`, []]),
    ['later', []],
  ]);
  const agingRows: Record<AgingBucket, DashboardRow[]> = {
    today: [],
    days1to2: [],
    days3to6: [],
    days7plus: [],
  };
  let agingUnknown = 0;

  for (const row of rows) {
    const day = deliveryDayOf(row);
    const due = dispatchDue(row, today);
    if (day === null) alertRows.undated.push(row);
    else if (due === 'overdue') {
      alertRows.overdue.push(row);
      scheduleRows.get('overdue')?.push(row);
    } else if (due === 'today') {
      alertRows.today.push(row);
      scheduleRows.get('today')?.push(row);
    } else {
      if (day === tomorrow) alertRows.tomorrow.push(row);
      (scheduleRows.get(`day:${day}`) ?? scheduleRows.get('later'))?.push(row);
    }
    if (isUnplacedToday(row, today)) alertRows.unplaced.push(row);
    const age = agingBucketOf(row, today);
    if (age === null) agingUnknown += 1;
    else agingRows[age].push(row);
  }

  const figure = (own: readonly DashboardRow[]): DashboardFigure => dashboardFigure(own, catalog);
  return {
    grandTotal,
    tiles: heldReportTiles(grandTotal, catalog),
    alerts: {
      overdue: figure(alertRows.overdue),
      today: figure(alertRows.today),
      tomorrow: figure(alertRows.tomorrow),
      undated: figure(alertRows.undated),
      unplaced: figure(alertRows.unplaced),
    },
    schedule: [...scheduleRows.entries()].map(([key, own]) => {
      const dayKey = key.startsWith('day:') ? key.slice(4) : null;
      return {
        key,
        kind: dayKey !== null ? 'day' : (key as 'overdue' | 'today' | 'later'),
        day: key === 'today' ? today : dayKey,
        ...figure(own),
      };
    }),
    undated: figure(alertRows.undated),
    aging: {
      today: figure(agingRows.today),
      days1to2: figure(agingRows.days1to2),
      days3to6: figure(agingRows.days3to6),
      days7plus: figure(agingRows.days7plus),
    },
    agingUnknown,
    bankRows: dashboardBankRows(rows, banks, catalog, packaging),
  };
};

/**
 * A column's share of the tallest one, 0..1 — its height in «جدول التسليم». Every column of nothing
 * when nothing is due, so the frame keeps its baseline and its labels.
 */
export const scheduleHeights = (buckets: readonly Pick<ScheduleBucket, 'count'>[]): number[] => {
  const tallest = Math.max(0, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => (tallest === 0 ? 0 : bucket.count / tallest));
};

// ── The line at the top: the filters in force ─────────────────────────────────────────────────

/**
 * The board's filters this dashboard was opened over, in the bar's own order (the table's column
 * order, «تاريخ التسليم» at the date column's place): the params the secured board READS
 * (`offeredFilters`) and the screen's one delivery day. Each is the box's name and what is in it;
 * none is «كل المحصنات بالخزينة — بلا فلتر». Blank text narrows nothing on the board, so it is not
 * said here either.
 */
export type DashboardFilterParam = Exclude<
  keyof DayBoardFilters,
  'type' | 'received' | 'pickup' | 'vault'
>;
export const DASHBOARD_FILTER_ORDER: readonly (DashboardFilterParam | 'date')[] = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'date',
  'stage',
  'notes',
];

export const dashboardFilterChips = (
  filters: Pick<DayBoardFilters, DashboardFilterParam>,
  date: string | null,
): { param: DashboardFilterParam | 'date'; value: string }[] =>
  DASHBOARD_FILTER_ORDER.flatMap((param) => {
    const value = (param === 'date' ? (date ?? '') : filters[param]).trim();
    return value === '' ? [] : [{ param, value }];
  });
