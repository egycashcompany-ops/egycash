// The store's arithmetic (FR-20), pure — «أقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك».
//
// No database, no request, no clock: what each movement does to an item's three counters, and the
// one fact the register derives from them. The repository's atomic write, the services and the
// go-live import all take their numbers from here rather than restating them, so «what does a
// replacement count as» has exactly one answer.
import { type ItConsumableIssueReason, type ItConsumableMovementKind } from '@ecms/contracts';

/** An item's three counters — what the register shows, and what only movements move. */
export interface ConsumableCounters {
  onHandQty: number;
  issuedQty: number;
  scrappedQty: number;
}

/** What one movement adds to each counter (a negative `onHand` takes stock out of the store). */
export interface StockEffect {
  onHand: number;
  issued: number;
  scrapped: number;
}

/** A new item's counters, before its first movement. */
export const NO_STOCK: Readonly<ConsumableCounters> = {
  onHandQty: 0,
  issuedQty: 0,
  scrappedQty: 0,
};

/**
 * What one movement of `qty` moves.
 *
 * `received` («توريد») and `returned` («مرتجع») put stock back in the store; `scrapped` («هالك»)
 * takes it out as scrap; `issued` («صرف») takes it out to a person. An issue IN PLACE OF a damaged
 * unit («بدل تالف») ALSO counts that damaged unit as scrap — it is the item's scrap all the same —
 * but the damaged unit came back from the person broken and was never on hand, so on hand moves by
 * the new unit alone. A return does not lower `issuedQty`: that counter is everything EVER issued,
 * and what came back is its own movement on the ledger.
 */
export const stockEffect = (
  kind: ItConsumableMovementKind,
  qty: number,
  reason?: ItConsumableIssueReason | null,
): StockEffect => {
  switch (kind) {
    case 'received':
    case 'returned':
      return { onHand: qty, issued: 0, scrapped: 0 };
    case 'scrapped':
      return { onHand: -qty, issued: 0, scrapped: qty };
    case 'issued':
      return { onHand: -qty, issued: qty, scrapped: reason === 'replacement' ? qty : 0 };
  }
};

/** The counters after a movement — what the atomic `$inc` produces, said as arithmetic. */
export const applyStockEffect = (
  counters: ConsumableCounters,
  effect: StockEffect,
): ConsumableCounters => ({
  onHandQty: counters.onHandQty + effect.onHand,
  issuedQty: counters.issuedQty + effect.issued,
  scrappedQty: counters.scrappedQty + effect.scrapped,
});

/**
 * The counters BEFORE a movement, from the ones after it — exact, and free: the write returns the
 * row as it now stands, and a second read would have to join the transaction to be right.
 */
export const beforeStockEffect = (
  counters: ConsumableCounters,
  effect: StockEffect,
): ConsumableCounters => ({
  onHandQty: counters.onHandQty - effect.onHand,
  issuedQty: counters.issuedQty - effect.issued,
  scrappedQty: counters.scrappedQty - effect.scrapped,
});

/**
 * May `qty` leave a store holding `onHandQty`? The service does NOT decide by this alone — the real
 * guard is the update's filter, so two people taking the last unit at once cannot both pass — but
 * it is the same rule, said where a reader (and a test) can check it, and the two must agree.
 */
export const canTake = (onHandQty: number, qty: number): boolean => qty > 0 && onHandQty >= qty;

/**
 * At or below the item's own minimum — a reorder hint, never a block, and never stored. An item
 * with no minimum has none to be below, which is the reading of «not set» rather than a silent 0.
 */
export const isBelowMin = (onHandQty: number, minQty: number | null): boolean =>
  minQty !== null && onHandQty <= minQty;
