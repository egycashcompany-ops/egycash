// «سجل العهدة» — the fund's running ledger, folded from the operations and the receipts.
//
// Nothing here is stored: the operations are «شحن» / «استعاضة» / «تسوية», and between two of them
// every custody receipt the fund paid collapses into ONE «صرف» row — the sample's «97 إيصالًا صُرفت
// من العهدة». Walking the days oldest first, a day's operations come before that day's receipts (his
// 01/09 charge, then 01/09's spending), and the running «إجمالي العهدة» is carried over the WHOLE
// history in whole piastres — a filter picks rows out of the fold, it never changes a row's
// «بعدها». The last row's «بعدها» is the fund (`readCustodyFundTerms().fundTotal`).
//
// A «استعاضة» waiting for its transfer (`held`) and a cancelled one stay on their letter's day as a
// row of their own, but count nothing: `before === after`, and `amount` is what the row would add.
// A transferred one sits on its transfer's day (`letterDate` keeps the letter's), ordered within
// that day by when the transfer was confirmed. An operation stored before the statuses is `done`
// on its letter's day, ordered by when it was recorded — exactly as before.
//
// Pure: the service reads the operations and the receipts (already grouped per day, kind and memo
// in the database) and hands them here.
import {
  FLEET_CUSTODY_SOURCES,
  FLEET_LICENSE_EXPENSE_KINDS,
  parseFleetSort,
  type FleetCustodyCancellationDto,
  type FleetCustodyKindSpendDto,
  type FleetCustodyLedgerOp,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyLedgerTotalsDto,
  type FleetCustodyOperationKind,
  type FleetCustodyOperationStatus,
  type FleetCustodySource,
  type FleetCustodyTransferDto,
  type FleetLicenseExpenseKind,
  type ListFleetCustodyLedgerQuery,
  type Paginated,
} from '@ecms/contracts';
import {
  cancellationDtoOf,
  operationStatusOf,
  transferDtoOf,
  type FleetCustodyOperationDoc,
} from './custody-operation.model';

/** An operation, as the fold reads it. */
export interface LedgerOperation {
  id: string;
  kind: FleetCustodyOperationKind;
  /** Absent: `done`. */
  status?: FleetCustodyOperationStatus | undefined;
  /** YYYY-MM-DD — where the row sits: the transfer's day once transferred, else the letter's. */
  day: string;
  /** The letter's day, YYYY-MM-DD — only on a transferred replenishment (`day` is the transfer's). */
  letterDay?: string | null | undefined;
  /** Full ISO: the order within `day` — when it was recorded, or its transfer confirmed. */
  at?: string | undefined;
  transfer?: FleetCustodyTransferDto | null | undefined;
  cancellation?: FleetCustodyCancellationDto | null | undefined;
  from: string | null;
  to: string | null;
  /** Positive, in EGP; the sign is the kind's. */
  amount: number;
  reason: string;
  /** A replenishment's memos' kinds, one per memo. */
  memoKinds: readonly FleetCustodySource[];
  /** A settlement's licensing memos. */
  parts: readonly { part: FleetLicenseExpenseKind; cars: number }[];
}

/** The custody receipts of one day, one kind and one memo (`memoNo` null: in no memo yet). */
export interface LedgerReceiptGroup {
  /** YYYY-MM-DD. */
  day: string;
  kind: FleetCustodySource;
  memoNo: number | null;
  count: number;
  /** EGP. */
  amount: number;
}

export interface LedgerFilters {
  op?: readonly FleetCustodyLedgerOp[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

const toPiastres = (pounds: number): number => Math.round(pounds * 100);
const fromPiastres = (piastres: number): number => (piastres === 0 ? 0 : piastres / 100);
const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** A stored operation as the fold reads it. */
export const ledgerOperationOf = (doc: FleetCustodyOperationDoc): LedgerOperation => {
  const status = operationStatusOf(doc);
  const transfer = status === 'done' ? transferDtoOf(doc) : null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    status,
    day: transfer === null ? dayOf(doc.date) : transfer.date,
    letterDay: transfer === null ? null : dayOf(doc.date),
    at: transfer === null ? doc.createdAt.toISOString() : transfer.at,
    transfer,
    cancellation: status === 'cancelled' ? cancellationDtoOf(doc) : null,
    from: doc.from == null ? null : dayOf(doc.from),
    to: doc.to == null ? null : dayOf(doc.to),
    amount: doc.amount,
    reason: doc.reason ?? '',
    memoKinds: (doc.memos ?? []).map((memo) => memo.kind),
    parts: (doc.parts ?? []).map((part) => ({ part: part.part, cars: part.cars })),
  };
};

/** What an operation would do to the fund, in piastres: a charge and a replenishment add. */
const signedPiastres = (op: LedgerOperation): number =>
  op.kind === 'settle' ? -toPiastres(op.amount) : toPiastres(op.amount);

/** What it does: only a `done` operation moves the fund — a held or cancelled one adds nothing. */
const countedPiastres = (op: LedgerOperation): number =>
  (op.status ?? 'done') === 'done' ? signedPiastres(op) : 0;

interface SpendRun {
  from: string;
  to: string;
  receipts: number;
  piastres: number;
  byKind: Record<FleetCustodySource, { count: number; piastres: number; outside: number }>;
  memoNos: Set<number>;
}

const emptyRun = (day: string): SpendRun => ({
  from: day,
  to: day,
  receipts: 0,
  piastres: 0,
  byKind: Object.fromEntries(
    FLEET_CUSTODY_SOURCES.map((kind) => [kind, { count: 0, piastres: 0, outside: 0 }]),
  ) as SpendRun['byKind'],
  memoNos: new Set(),
});

const blankRow = (
  id: string,
  op: FleetCustodyLedgerOp,
  date: string,
  signed: number,
  before: number,
  counted: number = signed,
): FleetCustodyLedgerRowDto => ({
  id,
  op,
  status: 'done',
  date,
  dateTo: null,
  letterDate: null,
  amount: fromPiastres(signed),
  before: fromPiastres(before),
  after: fromPiastres(before + counted),
  latest: false,
  reason: null,
  from: null,
  to: null,
  memos: null,
  licence: null,
  receipts: null,
  byKind: null,
  memoNos: null,
  transfer: null,
  cancellation: null,
});

const operationRow = (op: LedgerOperation, before: number): FleetCustodyLedgerRowDto => {
  const row = {
    ...blankRow(op.id, op.kind, op.day, signedPiastres(op), before, countedPiastres(op)),
    status: op.status ?? 'done',
    letterDate: op.letterDay ?? null,
    transfer: op.transfer ?? null,
    cancellation: op.cancellation ?? null,
  };
  if (op.kind === 'charge') return { ...row, reason: op.reason };
  const period = { from: op.from, to: op.to };
  if (op.kind === 'replenish') {
    const kinds = FLEET_CUSTODY_SOURCES.filter((kind) => op.memoKinds.includes(kind));
    return { ...row, ...period, memos: { count: op.memoKinds.length, kinds } };
  }
  const licence = Object.fromEntries(
    FLEET_LICENSE_EXPENSE_KINDS.map((kind) => {
      const parts = op.parts.filter((part) => part.part === kind);
      return [kind, { count: parts.length, cars: parts.reduce((sum, part) => sum + part.cars, 0) }];
    }),
  ) as Record<FleetLicenseExpenseKind, { count: number; cars: number }>;
  return { ...row, ...period, licence };
};

const spendRow = (run: SpendRun, before: number): FleetCustodyLedgerRowDto => ({
  ...blankRow(`spend:${run.from}:${run.to}`, 'spend', run.from, -run.piastres, before),
  dateTo: run.to,
  receipts: run.receipts,
  byKind: Object.fromEntries(
    FLEET_CUSTODY_SOURCES.map((kind): [FleetCustodySource, FleetCustodyKindSpendDto] => {
      const spent = run.byKind[kind];
      return [
        kind,
        { count: spent.count, amount: fromPiastres(spent.piastres), outside: spent.outside },
      ];
    }),
  ) as Record<FleetCustodySource, FleetCustodyKindSpendDto>,
  memoNos: [...run.memoNos].sort((a, b) => a - b),
});

/**
 * The whole ledger, oldest first. `ops` in the order they were recorded (day, then recorded); the
 * receipt groups in any order.
 */
export const foldCustodyLedger = (
  ops: readonly LedgerOperation[],
  groups: readonly LedgerReceiptGroup[],
): FleetCustodyLedgerRowDto[] => {
  // By day, then by `at` within it; stable, so operations with no `at` keep the order given.
  const operations = [...ops].sort(
    (a, b) => a.day.localeCompare(b.day) || (a.at ?? '').localeCompare(b.at ?? ''),
  );
  const receipts = [...groups].sort((a, b) => a.day.localeCompare(b.day));
  const rows: FleetCustodyLedgerRowDto[] = [];
  let fund = 0;
  let run: SpendRun | null = null;
  let next = 0;

  /** Every receipt dated before `day` (all of them for `null`) joins the open «صرف» run. */
  const spendUntil = (day: string | null): void => {
    while (next < receipts.length) {
      const group = receipts[next] as LedgerReceiptGroup;
      if (day !== null && group.day >= day) return;
      run ??= emptyRun(group.day);
      const piastres = toPiastres(group.amount);
      run.to = group.day;
      run.receipts += group.count;
      run.piastres += piastres;
      const kind = run.byKind[group.kind];
      kind.count += group.count;
      kind.piastres += piastres;
      if (group.memoNo === null) kind.outside += group.count;
      else run.memoNos.add(group.memoNo);
      next += 1;
    }
  };
  /** Close the open run as one «صرف» row. */
  const closeRun = (): void => {
    if (run === null) return;
    rows.push(spendRow(run, fund));
    fund -= run.piastres;
    run = null;
  };

  for (const op of operations) {
    // A day's operations come before that day's receipts: only the days before it are spent.
    spendUntil(op.day);
    closeRun();
    rows.push(operationRow(op, fund));
    fund += countedPiastres(op);
  }
  spendUntil(null);
  closeRun();

  const last = rows[rows.length - 1];
  if (last !== undefined) last.latest = true;
  return rows;
};

/** The rows a filter keeps — by «العملية» and by day overlap. The fold's figures are untouched. */
export const filterCustodyLedger = (
  rows: readonly FleetCustodyLedgerRowDto[],
  filters: LedgerFilters,
): FleetCustodyLedgerRowDto[] => {
  const from = filters.from === undefined ? null : dayOf(filters.from);
  const to = filters.to === undefined ? null : dayOf(filters.to);
  return rows.filter(
    (row) =>
      (filters.op === undefined || filters.op.includes(row.op)) &&
      (from === null || (row.dateTo ?? row.date) >= from) &&
      (to === null || row.date <= to),
  );
};

/** The direction of «التاريخ» — the only column the ledger orders by; newest first by default. */
const directionOf = (query: Pick<ListFleetCustodyLedgerQuery, 'sort' | 'sortBy' | 'sortDir'>) => {
  const chosen = parseFleetSort(query.sort).find((entry) => entry.by === 'date');
  if (chosen !== undefined) return chosen.dir;
  return query.sortBy === 'date' ? query.sortDir : 'desc';
};

/**
 * One page of the ledger. The fold is already in day order, so newest first is the fold reversed —
 * rows of one day keep the order they happened in, turned round.
 */
export const pageCustodyLedger = (
  rows: readonly FleetCustodyLedgerRowDto[],
  query: ListFleetCustodyLedgerQuery,
): Paginated<FleetCustodyLedgerRowDto> => {
  const kept = filterCustodyLedger(rows, query);
  const ordered = directionOf(query) === 'asc' ? kept : [...kept].reverse();
  const start = (query.page - 1) * query.pageSize;
  return {
    items: ordered.slice(start, start + query.pageSize),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: ordered.length,
      totalPages: Math.max(1, Math.ceil(ordered.length / query.pageSize)),
    },
  };
};

/** The count chip: operations and «صرف» rows the filters keep. */
export const custodyLedgerTotals = (
  rows: readonly FleetCustodyLedgerRowDto[],
  filters: LedgerFilters,
): FleetCustodyLedgerTotalsDto => {
  const kept = filterCustodyLedger(rows, filters);
  const spendLines = kept.filter((row) => row.op === 'spend').length;
  return { operations: kept.length - spendLines, spendLines };
};

/** An operation's place in the fund, from the fold — `null` when it is not in it. */
export const ledgerPlaceOf = (
  rows: readonly FleetCustodyLedgerRowDto[],
  operationId: string,
): { before: number; after: number } | null => {
  const row = rows.find((candidate) => candidate.op !== 'spend' && candidate.id === operationId);
  return row === undefined ? null : { before: row.before, after: row.after };
};
