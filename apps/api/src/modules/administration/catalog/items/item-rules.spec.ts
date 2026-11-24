// An item's pure rules (design §2.3.4, §5.3, §5.15; §19.7): the levels keep min ≤ reorder point ≤
// max where set (OD-09), and each comparison that fails names both its ends; the levels are whole
// numbers from 0 (OD-08), as the contract takes them; a retired unit or category is refused with
// its field; a category with active subcategories is refused to the item a write leaves in it
// (OD-06 (i)); and a retired item is hidden only from new references (OD-70 A).
import { AdministrationStockLevelSchema, ErrorCodes } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeFor,
  deactivationProblem,
  referenceRefusal,
  stockLevelsOutOfOrder,
  stockLevelsRefusal,
  subcategoryRefusal,
  type StockLevels,
} from './item-rules';

const levels = (
  minQty: number | null,
  reorderPointQty: number | null,
  maxQty: number | null,
): StockLevels => ({ minQty, reorderPointQty, maxQty });

describe('the stock levels’ order (OD-09)', () => {
  it.each([
    ['none set', levels(null, null, null)],
    ['all three in order', levels(5, 10, 50)],
    ['all three equal', levels(7, 7, 7)],
    ['zero everywhere', levels(0, 0, 0)],
    ['min and max only', levels(2, null, 9)],
    ['reorder and max only', levels(null, 3, 3)],
    ['one alone', levels(null, 40, null)],
  ])('passes %s', (_label, row) => {
    expect(stockLevelsOutOfOrder(row)).toEqual([]);
    expect(stockLevelsRefusal(row)).toBeNull();
  });

  it.each([
    ['min above reorder', levels(10, 5, 50), ['minQty', 'reorderPointQty']],
    ['reorder above max', levels(1, 60, 50), ['reorderPointQty', 'maxQty']],
    ['min above max, reorder unset', levels(9, null, 3), ['minQty', 'maxQty']],
    [
      'min above max, reorder between them',
      levels(9, 5, 3),
      ['minQty', 'reorderPointQty', 'maxQty'],
    ],
    ['min above both, which keep theirs', levels(9, 4, 6), ['minQty', 'reorderPointQty', 'maxQty']],
    ['only max below', levels(2, 4, 1), ['minQty', 'reorderPointQty', 'maxQty']],
  ])('names both ends of every failed comparison: %s', (_label, row, fields) => {
    expect(stockLevelsOutOfOrder(row)).toEqual(fields);
  });

  it('refuses with 422 ADMINISTRATION_STOCK_LEVELS_ORDER, one detail per field out of order', () => {
    const refusal = stockLevelsRefusal(levels(10, 5, null));
    expect(refusal).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_STOCK_LEVELS_ORDER,
      httpStatus: 422,
      details: [
        expect.objectContaining({ field: 'minQty', code: 'outOfOrder' }),
        expect.objectContaining({ field: 'reorderPointQty', code: 'outOfOrder' }),
      ],
    });
  });
});

describe('the levels are whole numbers from 0 (OD-08) — as the contract takes them', () => {
  it.each([0, 1, 250, 1_000_000])('takes %d', (value) => {
    expect(AdministrationStockLevelSchema.safeParse(value).success).toBe(true);
  });

  it.each([-1, 0.5, 2.25, 1_000_001, Number.NaN])('refuses %d', (value) => {
    expect(AdministrationStockLevelSchema.safeParse(value).success).toBe(false);
  });
});

describe('a retired unit or category (§2.3.2, §2.3.3)', () => {
  it('refuses nothing when every reference is offered', () => {
    expect(referenceRefusal([])).toBeNull();
  });

  it('refuses with 422 ADMINISTRATION_REFERENCE_INACTIVE, one detail per retired reference', () => {
    expect(referenceRefusal(['unitId'])).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_REFERENCE_INACTIVE,
      httpStatus: 422,
      details: [expect.objectContaining({ field: 'unitId', code: 'inactive' })],
    });
    expect(referenceRefusal(['unitId', 'categoryId'])?.details?.map((d) => d.field)).toEqual([
      'unitId',
      'categoryId',
    ]);
  });
});

describe('the category’s level (OD-06 (i))', () => {
  it('refuses a category that has active subcategories with 422 ADMINISTRATION_SUBCATEGORY_REQUIRED on categoryId', () => {
    expect(subcategoryRefusal({ hasActiveSubcategories: true })).toMatchObject({
      code: ErrorCodes.ADMINISTRATION_SUBCATEGORY_REQUIRED,
      httpStatus: 422,
      details: [expect.objectContaining({ field: 'categoryId', code: 'subcategoryRequired' })],
    });
  });

  it('takes a category without active subcategories — a leaf, or one whose children all retired', () => {
    expect(subcategoryRefusal({ hasActiveSubcategories: false })).toBeNull();
  });
});

describe('a retired item (§5.3; OD-70 A)', () => {
  it('is hidden from a new reference and kept by an existing one', () => {
    expect(activeFor({ isActive: true }, 'newReference')).toBe(true);
    expect(activeFor({ isActive: false }, 'newReference')).toBe(false);
    expect(activeFor({ isActive: false }, 'existingReference')).toBe(true);
  });

  it('retires freely — nothing holds stock in Phase 1', () => {
    expect(deactivationProblem({ isActive: true })).toBeNull();
  });
});
