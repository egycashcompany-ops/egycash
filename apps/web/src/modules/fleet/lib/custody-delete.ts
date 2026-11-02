// «حذف العملية» and «العمليات المحذوفة» as rules the node suite reads directly — no React, no words
// of its own (the screens hand in their `t` through `LedgerWordsKit`).
//
// What a delete does, by kind and status (the API does the same, in one locked transaction):
//
//   charge                     the fund − its amount; nothing else is touched
//   replenish done / legacy    the fund − its amount; its memos back to «لم تُستعَض بعد»
//   replenish held             the fund unchanged; its reserved memos back to «لم تُستعَض بعد»
//   replenish cancelled        nothing moves — its memos were freed when it was cancelled
//   settle                     the fund + its amount; its licence parts back to «لم تُسوَّ بعد»
//
// The operation leaves «سجل العهدة» and every figure, and lives on in «العمليات المحذوفة» with who
// deleted it, when (Cairo time), why, and the fund just before and after.
import {
  FLEET_CUSTODY_OPERATION_KINDS,
  FLEET_LICENSE_EXPENSE_KINDS,
  type DeleteFleetCustodyOperation,
  type FleetCustodyDeletionDto,
  type FleetCustodyLedgerRowDto,
  type FleetCustodyOperationDto,
  type FleetCustodyOperationKind,
  type FleetCustodySource,
  type FleetLicenseExpenseKind,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { cairoDayOf, operationStatusOf } from './custody-hold';

const DELETE = 'fleet.custody.delete';
const REASON_MAX = 500;
const piastres = (value: number): number => Math.round(value * 100);
const pounds = (cents: number): number => cents / 100;

/** What a delete does: how the fund moves, and whether memos or licence parts go back. */
export interface DeletionEffect {
  /** Added to «إجمالي العهدة» — negative for a charge or a counted replenishment. */
  fundDelta: number;
  /** Its memos go back to «لم تُستعَض بعد». */
  memos: boolean;
  /** Its licence parts go back to «لم تُسوَّ بعد». */
  parts: boolean;
}

/** The plan's table, per kind and status — a legacy replenishment (no status) reads as done. */
export const deletionEffectOf = (
  op: Pick<FleetCustodyOperationDto, 'kind' | 'status' | 'amount' | 'memos' | 'parts'>,
): DeletionEffect => {
  const status = operationStatusOf(op);
  switch (op.kind) {
    case 'charge':
      return { fundDelta: pounds(-piastres(op.amount)), memos: false, parts: false };
    case 'settle':
      return { fundDelta: pounds(piastres(op.amount)), memos: false, parts: op.parts.length > 0 };
    case 'replenish':
      if (status === 'cancelled') return { fundDelta: 0, memos: false, parts: false };
      return {
        fundDelta: status === 'held' ? 0 : pounds(-piastres(op.amount)),
        memos: op.memos.length > 0,
        parts: false,
      };
  }
};

/** «إجمالي العهدة» after the delete — summed in piastres, never in floating pounds. */
export const fundAfterDelete = (fundNow: number, effect: DeletionEffect): number =>
  pounds(piastres(fundNow) + piastres(effect.fundDelta));

/** The body of «حذف العملية» — the reason optional (trimmed, at most 500), the version read. */
export const deleteBody = (reason: string, version: number): DeleteFleetCustodyOperation => ({
  reason: reason.trim().slice(0, REASON_MAX),
  version,
});

/**
 * Why the server refused the delete, when the dialog says it in words: `taken` — 409 / 404, the
 * operation changed (confirmed, cancelled, edited) or was deleted since the dialog read it. `null`
 * for anything else, which keeps its usual message.
 */
export type DeleteRefusal = 'taken';
export const deleteRefusalOf = (error: unknown): DeleteRefusal | null =>
  error instanceof ApiError && (error.status === 409 || error.status === 404) ? 'taken' : null;

/** The dialog's title key — a held replenishment says so. */
export const deleteTitleKey = (op: Pick<FleetCustodyOperationDto, 'kind' | 'status'>): string =>
  op.kind === 'replenish' && operationStatusOf(op) === 'held'
    ? `${DELETE}.title.replenishHeld`
    : `${DELETE}.title.${op.kind}`;

/** The rose sentence's key — what the click does, by kind and status. */
export const deleteBodyKey = (op: Pick<FleetCustodyOperationDto, 'kind' | 'status'>): string => {
  if (op.kind !== 'replenish') return `${DELETE}.body.${op.kind}`;
  const status = operationStatusOf(op);
  return status === 'held'
    ? `${DELETE}.body.replenishHeld`
    : status === 'cancelled'
      ? `${DELETE}.body.replenishCancelled`
      : `${DELETE}.body.replenish`;
};

/**
 * How many operations the log holds after this one — read from the log filtered to the three
 * operations from its day on, oldest first (`page` 1). `null` while it is unknown (not read, or the
 * operation not on that page).
 */
export const laterOperationsOf = (
  page:
    | {
        items: readonly Pick<FleetCustodyLedgerRowDto, 'id' | 'op'>[];
        meta: { totalItems: number };
      }
    | undefined,
  id: string,
): number | null => {
  if (page === undefined) return null;
  const at = page.items.findIndex((row) => row.op !== 'spend' && row.id === id);
  if (at < 0) return null;
  return Math.max(0, page.meta.totalItems - (at + 1));
};

/** The query that finds them: the three operations, from the operation's day, oldest first. */
export const laterOperationsQuery = (
  op: Pick<FleetCustodyOperationDto, 'date'>,
): {
  op: FleetCustodyOperationKind[];
  from: string;
  page: number;
  pageSize: number;
  sort: string;
} => ({
  op: [...FLEET_CUSTODY_OPERATION_KINDS],
  from: op.date.slice(0, 10),
  page: 1,
  pageSize: 100,
  sort: 'date:asc',
});

// ── «العمليات المحذوفة» ──────────────────────────────────────────────────────────────────────────

const CAIRO_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * `{ day: '2026/11/01', time: '09:12' }` — an instant the API stamps, on Cairo's clock and
 * calendar (24-hour, Western digits). A value that is not an instant keeps its day and no time.
 */
export const cairoAt = (iso: string): { day: string; time: string } => {
  const instant = new Date(iso);
  const day = cairoDayOf(iso).replace(/-/gu, '/');
  return Number.isNaN(instant.getTime())
    ? { day, time: '' }
    : { day, time: CAIRO_CLOCK.format(instant) };
};

/** What the delete did to the fund: after − before, in piastres; 0 when nothing moved. */
export const deletionDeltaOf = (
  deletion: Pick<FleetCustodyDeletionDto, 'fundBefore' | 'fundAfter'>,
): number => pounds(piastres(deletion.fundAfter) - piastres(deletion.fundBefore));

/** «العملية» as the address holds it, kept to the three the server knows. */
export const deletedKindsOf = (raw: string | null): FleetCustodyOperationKind[] =>
  (raw ?? '')
    .split(',')
    .filter((v): v is FleetCustodyOperationKind =>
      (FLEET_CUSTODY_OPERATION_KINDS as readonly string[]).includes(v),
    );

/**
 * A deleted operation as «سجل العهدة» read it — so `ledgerWords` gives the same title and note it
 * had in the log. The running figures are not its any more: zero, never shown.
 */
export const deletedLedgerRow = (op: FleetCustodyOperationDto): FleetCustodyLedgerRowDto => {
  const kinds = [...op.memos]
    .sort((a, b) => a.no - b.no)
    .reduce<FleetCustodySource[]>(
      (all, memo) => (all.includes(memo.kind) ? all : [...all, memo.kind]),
      [],
    );
  const licence = Object.fromEntries(
    FLEET_LICENSE_EXPENSE_KINDS.map((kind) => {
      const parts = op.parts.filter((part) => part.part === kind);
      return [kind, { count: parts.length, cars: parts.reduce((sum, part) => sum + part.cars, 0) }];
    }),
  ) as Record<FleetLicenseExpenseKind, { count: number; cars: number }>;
  return {
    id: op.id,
    op: op.kind,
    status: op.status,
    date: op.date,
    dateTo: null,
    letterDate: null,
    amount: op.kind === 'settle' ? -op.amount : op.amount,
    before: 0,
    after: 0,
    latest: false,
    reason: op.kind === 'charge' ? op.reason : null,
    from: op.from,
    to: op.to,
    memos: op.kind === 'replenish' ? { count: op.memos.length, kinds } : null,
    licence: op.kind === 'settle' ? licence : null,
    receipts: null,
    byKind: null,
    memoNos: null,
    transfer: op.transfer,
    cancellation: op.cancellation,
  };
};
