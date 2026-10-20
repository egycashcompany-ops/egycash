// The memos' rules that need no database — days, periods, which lines change on an edit, and what
// a receipt on a memo may still change. Pure, so each is pinned by `custody-memo-rules.spec.ts`.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC midnight of `value`'s day — how every memo day is stored. */
export const utcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

/** The day after — a «to» filter counts its whole day. */
export const dayAfter = (day: Date): Date => new Date(utcDay(day).getTime() + DAY_MS);

/** `YYYY-MM-DD` — the only way a memo day leaves the API (the papers split it on '-'). */
export const dayKey = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * A memo's period from its receipts' days: the first and the last. `null` for no days — a memo
 * always has a line, so only a caller with none asks.
 */
export const periodOf = (days: readonly Date[]): { from: Date; to: Date } | null => {
  if (days.length === 0) return null;
  let first = days[0] as Date;
  let last = first;
  for (const day of days) {
    if (day.getTime() < first.getTime()) first = day;
    if (day.getTime() > last.getTime()) last = day;
  }
  return { from: utcDay(first), to: utcDay(last) };
};

/** What an edit does to a memo's receipts: the ones it lets go, and the ones it takes. */
export const lineChanges = (
  before: readonly string[],
  after: readonly string[],
): { release: string[]; take: string[] } => {
  const had = new Set(before.map((id) => id.toLowerCase()));
  const wants = new Set(after.map((id) => id.toLowerCase()));
  return {
    release: before.filter((id) => !wants.has(id.toLowerCase())),
    take: after.filter((id) => !had.has(id.toLowerCase())),
  };
};

/**
 * Lines in their paper order: the receipt's day ascending, then the receipt's own `createdAt`, then
 * its id — the order the clerk entered a day's papers in, and stable when two share a moment.
 */
export const orderLines = <L extends { receiptId: string }>(
  lines: readonly L[],
  receipts: ReadonlyMap<string, { date: Date; createdAt: Date }>,
): L[] => {
  const at = (line: L) => receipts.get(line.receiptId.toLowerCase());
  return [...lines].sort((a, b) => {
    const ra = at(a);
    const rb = at(b);
    const byDay =
      (ra === undefined ? 0 : utcDay(ra.date).getTime()) -
      (rb === undefined ? 0 : utcDay(rb.date).getTime());
    if (byDay !== 0) return byDay;
    const byCreated = (ra?.createdAt.getTime() ?? 0) - (rb?.createdAt.getTime() ?? 0);
    if (byCreated !== 0) return byCreated;
    return a.receiptId.toLowerCase() < b.receiptId.toLowerCase() ? -1 : 1;
  });
};

/** The facts of a receipt a memo depends on — what it is, what paid, when, which car, how much. */
export interface ReceiptMemoFacts {
  date: Date;
  vehicleId: unknown;
  kind: string;
  source: string;
  cardId: unknown;
  amount: number;
}

export type ReceiptChangeVerdict = 'ok' | 'kindOrSource' | 'locked';

const idText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value).toLowerCase();
const piastres = (value: number): number => Math.round(value * 100);

/**
 * May a receipt on a memo change from `live` to `next`? Compared BY VALUE — the day, the ids as
 * text, the amount to the piastre — because the receipts dialog sends the whole receipt back on
 * every save, and a driver-only edit resends the same date, car and amount as new objects.
 *
 *   - on no memo: anything goes;
 *   - on a memo not replenished yet: its kind and what paid for it stay (`kindOrSource`) — the
 *     memo is one kind of the fund's papers; the amount, the day and the car may change, and the
 *     memo's total follows;
 *   - on a replenished memo: its kind, what paid, the day, the car and the amount all stay
 *     (`locked`) — the money already came back into the fund on that figure. The driver, the
 *     photo, the odometer, the fuel type and the company stay editable.
 */
export const receiptChangeVerdict = (
  live: ReceiptMemoFacts,
  next: ReceiptMemoFacts,
  memo: { replenished: boolean } | null,
): ReceiptChangeVerdict => {
  if (memo === null) return 'ok';
  const kindOrSource =
    next.kind !== live.kind ||
    next.source !== live.source ||
    idText(next.cardId) !== idText(live.cardId);
  if (memo.replenished) {
    const moneyFacts =
      utcDay(next.date).getTime() !== utcDay(live.date).getTime() ||
      idText(next.vehicleId) !== idText(live.vehicleId) ||
      piastres(next.amount) !== piastres(live.amount);
    return kindOrSource || moneyFacts ? 'locked' : 'ok';
  }
  return kindOrSource ? 'kindOrSource' : 'ok';
};
