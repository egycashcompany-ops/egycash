// The store's arithmetic — «أقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك» — pinned where it is
// pure: what each movement does to an item's three counters, and the reorder hint.
import { describe, expect, it } from 'vitest';
import {
  NO_STOCK,
  applyStockEffect,
  beforeStockEffect,
  canTake,
  isBelowMin,
  stockEffect,
} from './consumable-stock';

const stocked = { onHandQty: 10, issuedQty: 4, scrappedQty: 1 };

describe('what each movement moves', () => {
  it('a delivery puts stock on the shelf and moves nothing else', () => {
    expect(applyStockEffect(stocked, stockEffect('received', 5))).toEqual({
      onHandQty: 15,
      issuedQty: 4,
      scrappedQty: 1,
    });
  });

  it('a return puts it back on the shelf — and does not un-issue it: issued is everything EVER issued', () => {
    expect(applyStockEffect(stocked, stockEffect('returned', 2))).toEqual({
      onHandQty: 12,
      issuedQty: 4,
      scrappedQty: 1,
    });
  });

  it('a scrap takes it off the shelf into the scrap count', () => {
    expect(applyStockEffect(stocked, stockEffect('scrapped', 3))).toEqual({
      onHandQty: 7,
      issuedQty: 4,
      scrappedQty: 4,
    });
  });

  it('a new issue takes it off the shelf into the issued count, and is no scrap', () => {
    expect(applyStockEffect(stocked, stockEffect('issued', 2, 'new'))).toEqual({
      onHandQty: 8,
      issuedQty: 6,
      scrappedQty: 1,
    });
    // `new` is the default reason of an issue line, and an absent one reads the same.
    expect(stockEffect('issued', 2)).toEqual(stockEffect('issued', 2, 'new'));
  });

  it('a replacement («بدل تالف») also counts the damaged unit as scrap — without taking it off the shelf twice', () => {
    // The damaged unit came back broken and was never on hand: on hand moves by the new unit alone.
    expect(applyStockEffect(stocked, stockEffect('issued', 2, 'replacement'))).toEqual({
      onHandQty: 8,
      issuedQty: 6,
      scrappedQty: 3,
    });
  });

  it('knows the counters before a movement from the ones after it', () => {
    const effect = stockEffect('issued', 2, 'replacement');
    const after = applyStockEffect(stocked, effect);
    expect(beforeStockEffect(after, effect)).toEqual(stocked);
  });

  it('starts a new item at zero, so an opening quantity is a delivery like any other', () => {
    expect(applyStockEffect(NO_STOCK, stockEffect('received', 23))).toEqual({
      onHandQty: 23,
      issuedQty: 0,
      scrappedQty: 0,
    });
  });
});

describe('what may leave the store', () => {
  it('everything on hand, and not one unit more', () => {
    expect(canTake(3, 3)).toBe(true);
    expect(canTake(3, 4)).toBe(false);
    expect(canTake(0, 1)).toBe(false);
    expect(canTake(3, 0)).toBe(false);
  });
});

describe('the reorder hint', () => {
  it('is at or below the item’s own minimum — and never for an item with none', () => {
    expect(isBelowMin(2, 2)).toBe(true);
    expect(isBelowMin(1, 2)).toBe(true);
    expect(isBelowMin(3, 2)).toBe(false);
    expect(isBelowMin(0, null)).toBe(false);
    expect(isBelowMin(0, 0)).toBe(true);
  });
});
