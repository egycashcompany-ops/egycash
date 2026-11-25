// "Does a document line name this item in its unit?" (design §2.3.4, §3.6) — asked by an item edit
// that changes the base unit, answered by the features whose lines name items.
//
// The question runs against the import direction: every document that names an item imports this
// feature (its picker, its snapshots), so this feature cannot import them back without closing a
// cycle. It is inverted, as the warehouse's holds are (`warehouse-holds.ts`): this file owns a
// small registry, and each answering feature registers its checker at module load. The purchase
// request is the first registrant (P2.2); the receipt, issue and count lines join with their
// phases, so none of them changes code here.
//
// A HINT, NOT THE GUARD. The checkers read outside the item's write, so a line written between the
// check and the edit can pass it; from P5 the posting, which refuses a line whose unit is no longer
// its item's (`ADMINISTRATION_ITEM_UNIT_CHANGED`), is the binding guard (design §2.3.4).
import { ADMINISTRATION_ITEM_UNIT_LOCKS, type AdministrationItemUnitLock } from '@ecms/contracts';

/** One feature's answer for one item: the lock its lines put on the item's unit, or null. */
export type ItemReferenceChecker = (itemId: string) => Promise<AdministrationItemUnitLock | null>;

const checkers: ItemReferenceChecker[] = [];

/** Called once, at module load, by each feature whose lines name an item (P2.2 onward). */
export const registerItemReferenceChecker = (checker: ItemReferenceChecker): void => {
  checkers.push(checker);
};

/** What locks this item's unit now, each lock once, in the vocabulary's order: none, unregistered. */
export const itemUnitLocks = async (itemId: string): Promise<AdministrationItemUnitLock[]> => {
  const answers = await Promise.all(checkers.map((checker) => checker(itemId)));
  return ADMINISTRATION_ITEM_UNIT_LOCKS.filter((lock) => answers.includes(lock));
};
