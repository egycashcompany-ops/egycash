// The store's two pure rules (ADR-024). No database, no request, no clock — so the arithmetic that
// decides whether a technician is stopped mid-repair is checkable in milliseconds.

/** Everything the rules below need from a part. Structural, so a test needs no document. */
export interface StockLevel {
  onHandQty: number;
  minQty: number | null;
}

/**
 * Did this movement take the part to or below its minimum, having been ABOVE it before?
 *
 * The edge, not the state. Firing on every consumption of an already-low part turns a warning into
 * noise, and `it.sparePart.belowMin` is meant to be actionable — it is a reorder prompt, never a
 * block: a technician mid-repair must not be stopped by a threshold (ADR-024).
 *
 * A part with no `minQty` has no minimum to be below, which is the intended reading of "not set"
 * rather than a silent zero.
 */
export const crossedBelowMin = (before: StockLevel, after: StockLevel): boolean =>
  after.minQty !== null && before.onHandQty > after.minQty && after.onHandQty <= after.minQty;

/**
 * May `qty` be issued from this level?
 *
 * The service does NOT rely on this to decide — the real guard is in the update filter, so two
 * concurrent consumptions of the last part cannot both pass. This states the same rule in a form a
 * reader (and a test) can check, and the two must agree.
 */
export const canIssue = (level: StockLevel, qty: number): boolean =>
  qty > 0 && level.onHandQty >= qty;
