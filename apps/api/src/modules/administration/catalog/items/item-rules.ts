// An item's pure rules (design §2.3.4, §5.3, §5.15): the order its stock levels keep, what it may
// name, what a retired item still allows, and what keeps one from retiring. No database and no
// clock: the service reads the facts — the row a write would leave, the unit and category it
// names — and these decide.
//
// The integers themselves (OD-08: whole numbers from 0) are the contract's
// (`AdministrationStockLevelSchema`): a fraction never reaches a rule. The ORDER is judged here,
// on the row the write leaves, because an update that moves one level is checked against the
// levels it keeps, which its body alone does not carry.
import {
  ADMINISTRATION_ITEM_UNIT_LOCKS,
  ADMINISTRATION_STOCK_LEVEL_FIELDS,
  ErrorCodes,
  type AdministrationItemReferenceField,
  type AdministrationItemUnitLock,
  type AdministrationStockLevelField,
} from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';

export type StockLevels = Record<AdministrationStockLevelField, number | null>;

/**
 * The levels out of order: where set, min ≤ reorder point ≤ max (OD-09). Each comparison that
 * fails names both its ends, so a screen marks every field the reader must look at; a level left
 * unset compares with nothing. Answered in the fields' own order, each once.
 */
export const stockLevelsOutOfOrder = (levels: StockLevels): AdministrationStockLevelField[] => {
  const wrong = new Set<AdministrationStockLevelField>();
  ADMINISTRATION_STOCK_LEVEL_FIELDS.forEach((lower, i) => {
    for (const upper of ADMINISTRATION_STOCK_LEVEL_FIELDS.slice(i + 1)) {
      const low = levels[lower];
      const high = levels[upper];
      if (low !== null && high !== null && low > high) {
        wrong.add(lower);
        wrong.add(upper);
      }
    }
  });
  return ADMINISTRATION_STOCK_LEVEL_FIELDS.filter((field) => wrong.has(field));
};

/** The 422 for levels out of order, one detail per field, or null when they keep their order. */
export const stockLevelsRefusal = (levels: StockLevels): AppError | null => {
  const fields = stockLevelsOutOfOrder(levels);
  if (fields.length === 0) return null;
  const message = 'the stock levels must keep min ≤ reorder point ≤ max';
  return new AppError(ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER, 422, message, {
    details: fields.map((field) => ({ field, code: 'outOfOrder', message })),
  });
};

/**
 * The 422 for references this write may not name, one detail each, or null. Which those are is
 * the unit's and the category's own `activeFor` — a retired one is refused to a new reference and
 * kept by an item that already names it (§2.3.2, §2.3.3) — so the service asks them and hands the
 * refused fields here.
 */
export const referenceRefusal = (
  fields: readonly AdministrationItemReferenceField[],
): AppError | null => {
  if (fields.length === 0) return null;
  const message = 'a retired unit or category cannot be given to an item';
  return new AppError(ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE, 422, message, {
    details: fields.map((field) => ({ field, code: 'inactive', message })),
  });
};

/** What the level rule reads of the category a write leaves the item in. */
export interface ItemCategoryLevelFacts {
  /** Does that category hold subcategories still offered to new items? */
  hasActiveSubcategories: boolean;
}

/**
 * The 422 for an item left in a category that has active subcategories, or null (OD-06 (i)): it
 * names one of them instead, on a create and on every edit. An item filed before its category
 * gained its first subcategory keeps that category until it is next edited — adding a level
 * invalidates no item — and that edit re-files it, so no item stays above the level for good and
 * the reports group evenly, which is why (i) was chosen over (ii). A category whose subcategories
 * are all retired is a leaf again, or nothing under it could be filed.
 */
export const subcategoryRefusal = (facts: ItemCategoryLevelFacts): AppError | null => {
  if (!facts.hasActiveSubcategories) return null;
  const message = 'this category has subcategories: the item names one of them';
  return new AppError(ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED, 422, message, {
    details: [{ field: 'categoryId', code: 'subcategoryRequired', message }],
  });
};

/**
 * Is this edit a status change alone — retiring or bringing back an item, nothing else set? That
 * is not the edit that re-files an item (OD-06 (i)): a new level must never be what stops an item
 * from being retired, since adding one invalidates no item. Any other field set, even to the value
 * the row holds, makes it that edit. A key present as `undefined` sets nothing.
 */
export const isStatusChangeOnly = (input: Readonly<Record<string, unknown>>): boolean =>
  Object.entries(input).every(
    ([field, value]) => field === 'version' || field === 'isActive' || value === undefined,
  );

/**
 * The 422 for a base unit that may not change, one detail per lock the checkers reported, or null
 * (design §2.3.4): a document line names the item in its unit, and a line's quantity means nothing
 * in another one. Asked only of an edit that changes the unit; nothing else an edit does is
 * locked by a line.
 */
export const unitLockRefusal = (locks: readonly AdministrationItemUnitLock[]): AppError | null => {
  const found = ADMINISTRATION_ITEM_UNIT_LOCKS.filter((lock) => locks.includes(lock));
  if (found.length === 0) return null;
  const message = 'a document line names this item in its unit, so the unit cannot change';
  return new AppError(ErrorCodes.ADMINISTRATION_ITEM_UNIT_LOCKED, 422, message, {
    details: found.map((code) => ({ field: 'unitId', code, message })),
  });
};

/**
 * The acts that name an item. A retired item is hidden from NEW references — new purchase and
 * receipt lines from P2 and P5 (OD-70 A) — while every act on stock it already holds passes; those
 * acts arrive with their phases, and `REFUSED_WHEN_INACTIVE` with P5's ledger (§5.3).
 */
export type ItemAct = 'newReference' | 'existingReference';

export const activeFor = (item: { isActive: boolean }, act: ItemAct): boolean =>
  act === 'existingReference' || item.isActive;

/**
 * Why this item may not retire: never (OD-70 A, allowed). Its stock leaves until zero through the
 * acts a retired item still allows; in Phase 1 nothing holds stock at all.
 */
export const deactivationProblem = (_item: { isActive: boolean }): null => null;
