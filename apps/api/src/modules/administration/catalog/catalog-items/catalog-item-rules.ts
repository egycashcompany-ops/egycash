// A unit's pure rules (design §5.3, §5.16): what a retired unit still allows, and what keeps one
// from retiring. No database and no clock — the shape every master-data feature's rules take, so
// the warehouse's real deactivation rule (P1a.3, OD-70) lands beside the units' empty one.

/**
 * The acts that name a unit. Retiring a unit hides it from NEW references; an item that already
 * names it keeps it (§2.3.2), so an edit that leaves the unit alone is never refused for it.
 */
export type CatalogItemAct = 'newReference' | 'existingReference';

/** May `act` name this unit? Items (P1a.2) are the first to ask. */
export const activeFor = (unit: { isActive: boolean }, act: CatalogItemAct): boolean =>
  act === 'existingReference' || unit.isActive;

/**
 * Why this unit may not retire: never. A unit has no deactivation rule (§5.3) — the items that name
 * it keep it — so a unit deactivates freely, and this answers no problem.
 */
export const deactivationProblem = (_unit: { isActive: boolean }): null => null;
