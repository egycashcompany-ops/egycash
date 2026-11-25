export { buildAdministrationItemsRouter } from './item.routes';
export {
  administrationItemService,
  ensureItemCodeCounter,
  itemSnapsOf,
  type AdministrationItemSnap,
} from './item.service';
// What a document reads of an item (P2.2): whether a retired one may be named — a new line no, a
// kept line yes (OD-70 A) — and the snapshot its line copies.
export { activeFor as itemActiveFor } from './item-rules';
// What a feature whose lines name an item registers at module load, so a unit change asks it
// (design §2.3.4, §3.6).
export {
  itemUnitLocks,
  registerItemReferenceChecker,
  type ItemReferenceChecker,
} from './item-unit-lock';
