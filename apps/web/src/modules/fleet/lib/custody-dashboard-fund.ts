// «العهدة الآن» on «لوحة تحكم العهدة» — the fund over its whole history, whatever the board's
// filters — as arithmetic the node suite reads directly: how old a day is, what still waits for
// «استعاضة العهدة» and for «تسوية العهدة», where a line of «سجل العهدة» leads, which of the fund's
// alert lines fire, and how the filtered spend splits by its memos' state.
//
// React-free. Every figure is one the API sends; nothing here estimates. A day is counted in whole
// UTC days from the board's day, the same cut the API makes for a receipt that waits in no memo:
// 30 days old is not late, 31 is (`FLEET_CUSTODY_STALE_DAYS`).
import {
  FLEET_CUSTODY_MEMO_STATES,
  FLEET_CUSTODY_STALE_DAYS,
  type FleetCustodyDashboardDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyMemoRowDto,
  type FleetCustodyMemoState,
  type FleetCustodyOutsideKindDto,
  type FleetCustodySettleCandidateDto,
  type FleetCustodySource,
} from '@ecms/contracts';
import { sumMoney } from './custody-fund-forms';

const DAY_MS = 86_400_000;

/**
 * Whole UTC days from the board's day (the UTC start of `now`) back to `day` (YYYY-MM-DD, or an ISO
 * date whose first ten letters are one) — 0 for today, never below 0, 0 for what is not a day.
 */
export const custodyAgeDays = (day: string, now: number = Date.now()): number => {
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const at = Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.round((start - at) / DAY_MS));
};

/** Past the owner's threshold: 30 days is not late, 31 is — the API's own cut for a receipt. */
export const custodyIsLate = (days: number): boolean => days > FLEET_CUSTODY_STALE_DAYS;

// ── What waits ──────────────────────────────────────────────────────────────────────────────────

/** «مبالغ صُرفت ولم تُستعَض بعد» — its two parts and what they make. */
export interface CustodyWaiting {
  /** In memos not replenished yet — the fund's `memos.pendingTotal`. */
  inMemos: number;
  /** In no memo yet — Σ the outside kinds. */
  outside: number;
  /** The headline: always the fund's spent less its replenished. */
  total: number;
  /** The receipts behind it: the pending memos' and the outside ones. */
  receipts: number;
}

export const custodyWaiting = (
  memos: readonly Pick<FleetCustodyMemoRowDto, 'receipts'>[],
  outside: readonly Pick<FleetCustodyOutsideKindDto, 'count' | 'total'>[],
  pendingTotal: number,
): CustodyWaiting => {
  const out = sumMoney(outside.map((line) => line.total));
  return {
    inMemos: pendingTotal,
    outside: out,
    total: sumMoney([pendingTotal, out]),
    receipts:
      memos.reduce((sum, memo) => sum + memo.receipts, 0) +
      outside.reduce((sum, line) => sum + line.count, 0),
  };
};

/** «مصروفات تراخيص لم تُسوَّ بعد» — every licensing memo waiting, to the piastre. */
export const custodySettleWaiting = (
  parts: readonly Pick<FleetCustodySettleCandidateDto, 'total'>[],
): number => sumMoney(parts.map((part) => part.total));

// ── Where a line of «سجل العهدة» leads ─────────────────────────────────────────────────────────

/**
 * An operation opens its drawer in «سجل العهدة» (with its letter); a receipts line names its days,
 * which the dashboard sets as the board's own «من» / «إلى» (it stays open, its filtered part follows).
 */
export type CustodyLedgerTarget =
  | { kind: 'operation'; to: string }
  | { kind: 'period'; from: string; to: string };

export const custodyLedgerTarget = (
  row: Pick<FleetCustodyLedgerRowDto, 'id' | 'op' | 'date' | 'dateTo'>,
): CustodyLedgerTarget =>
  row.op === 'spend'
    ? { kind: 'period', from: row.date, to: row.dateTo ?? row.date }
    : { kind: 'operation', to: `/fleet/custody/log?open=${encodeURIComponent(row.id)}` };

/** The receipts of a period on «العهدة» — the board over those days. */
export const custodyPeriodLink = (from: string, to: string): string =>
  `/fleet/custody?from=${from}&to=${to}`;

// ── The fund's alert lines ──────────────────────────────────────────────────────────────────────

export type CustodyFundAlert =
  /** (a) the fund below zero. */
  | { type: 'negative'; key: string; amount: number }
  /** (b) a kind's receipts in no memo past the threshold (the API's `stale`). */
  | {
      type: 'stale';
      key: string;
      kind: FleetCustodySource;
      count: number;
      total: number;
      oldest: string;
    }
  /** (c) a memo not replenished past the threshold. */
  | { type: 'memo'; key: string; memo: FleetCustodyMemoRowDto; days: number }
  /** (d) a licensing memo waiting for «تسوية العهدة» past the threshold. */
  | { type: 'licence'; key: string; part: FleetCustodySettleCandidateDto; days: number }
  /** (e) the settlements waiting are more than the fund holds now. */
  | { type: 'settleOver'; key: string; total: number; fund: number };

/**
 * Which of the fund's lines fire, in the banner's order — each from data the dashboard already
 * reads, none on a guess. A read still on its way raises nothing.
 */
export const custodyFundAlerts = (input: {
  fundTotal: number;
  outside?: readonly FleetCustodyOutsideKindDto[] | undefined;
  memos?: readonly FleetCustodyMemoRowDto[] | undefined;
  parts?: readonly FleetCustodySettleCandidateDto[] | undefined;
  now?: number;
}): CustodyFundAlert[] => {
  const now = input.now ?? Date.now();
  const lines: CustodyFundAlert[] = [];
  if (input.fundTotal < 0) lines.push({ type: 'negative', key: 'negative', amount: input.fundTotal });
  for (const line of input.outside ?? []) {
    if (line.stale.count <= 0 || line.oldest === null) continue;
    lines.push({
      type: 'stale',
      key: `stale-${line.kind}`,
      kind: line.kind,
      count: line.stale.count,
      total: line.stale.total,
      oldest: line.oldest,
    });
  }
  for (const memo of input.memos ?? []) {
    const days = custodyAgeDays(memo.date, now);
    if (custodyIsLate(days)) lines.push({ type: 'memo', key: `memo-${memo.id}`, memo, days });
  }
  for (const part of input.parts ?? []) {
    const days = custodyAgeDays(part.date, now);
    if (custodyIsLate(days)) {
      lines.push({ type: 'licence', key: `licence-${part.expenseId}-${part.part}`, part, days });
    }
  }
  if (input.parts !== undefined) {
    const total = custodySettleWaiting(input.parts);
    if (total > 0 && total > input.fundTotal) {
      lines.push({ type: 'settleOver', key: 'settleOver', total, fund: input.fundTotal });
    }
  }
  return lines;
};

// ── The filtered spend by its memos' state ──────────────────────────────────────────────────────

export const CUSTODY_MEMO_STATES = FLEET_CUSTODY_MEMO_STATES;

/**
 * The spend's three parts — replenished, waiting in a memo, in no memo yet — over the whole card or
 * one kind; `null` from an older server that sends none.
 */
export const custodyMemoStateParts = (
  states: FleetCustodyDashboardDto['memoStates'] | undefined,
  kind?: FleetCustodySource,
): Record<FleetCustodyMemoState, number> | null => {
  if (states === undefined || states === null) return null;
  const parts = {} as Record<FleetCustodyMemoState, number>;
  for (const state of FLEET_CUSTODY_MEMO_STATES) {
    const part = states[state];
    parts[state] = kind === undefined ? (part?.amount ?? 0) : (part?.byKind[kind]?.amount ?? 0);
  }
  return parts;
};

/** What of it is not replenished yet — waiting in a memo or in none. */
export const custodyNotReplenished = (parts: Record<FleetCustodyMemoState, number>): number =>
  sumMoney([parts.pending, parts.outside]);
