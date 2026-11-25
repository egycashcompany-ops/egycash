// The item form's state against the contracts (design §2.3.4, OD-05 to OD-09): what a create
// sends — never a code, never a stock figure — what an edit sends — only what moved, `null` to clear
// — and how the levels are judged before a round trip: whole numbers within the contract's bound,
// in the server's own order (`ADMINISTRATION_STOCK_LEVELS_ORDER`, both ends of each comparison).
import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATION_STOCK_LEVEL_MAX,
  CreateAdministrationItemSchema,
  UpdateAdministrationItemSchema,
} from '@ecms/contracts';
import { item } from '../screen-fixtures';
import {
  itemChanges,
  itemCreateBody,
  itemFormFrom,
  itemRequired,
  levelOf,
  levelProblems,
  type ItemForm,
} from './item-form';

const EMPTY = itemFormFrom(null);
const filled = (over: Partial<ItemForm> = {}): ItemForm => ({
  ...EMPTY,
  nameAr: 'حبر HP 85A',
  nameEn: 'HP 85A toner',
  categoryId: '650000000000000000000001',
  unitId: '650000000000000000000002',
  ...over,
});

describe('a new item', () => {
  it('needs both names, a category and a unit — and nothing else', () => {
    expect(itemRequired(EMPTY)).toEqual({
      nameAr: false,
      nameEn: false,
      categoryId: false,
      unitId: false,
    });
    expect(Object.values(itemRequired(filled())).every(Boolean)).toBe(true);
    expect(itemRequired(filled({ nameAr: '   ' })).nameAr).toBe(false);
  });

  it('sends what the contract takes — no code, no stock, empty boxes left out', () => {
    const body = itemCreateBody(filled({ barcode: ' 6221234567890 ', minQty: '2' }));
    expect(body).toEqual({
      name: { ar: 'حبر HP 85A', en: 'HP 85A toner' },
      categoryId: '650000000000000000000001',
      unitId: '650000000000000000000002',
      barcode: '6221234567890',
      minQty: 2,
    });
    expect(CreateAdministrationItemSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('code');
  });
});

describe('the levels', () => {
  it('read a box as a whole number, empty as none, anything past the bound as wrong', () => {
    expect(levelOf('')).toBeNull();
    expect(levelOf(' 12 ')).toBe(12);
    expect(levelOf('0')).toBe(0);
    expect(levelOf(String(ADMINISTRATION_STOCK_LEVEL_MAX))).toBe(ADMINISTRATION_STOCK_LEVEL_MAX);
    expect(levelOf(String(ADMINISTRATION_STOCK_LEVEL_MAX + 1))).toBeNaN();
    expect(levelOf('2.5')).toBeNaN();
  });

  it('keep min ≤ reorder point ≤ max where set — every end of a failing comparison marked', () => {
    expect(levelProblems(filled({ minQty: '2', reorderPointQty: '5', maxQty: '20' }))).toEqual({});
    expect(levelProblems(filled({ minQty: '5', reorderPointQty: '5', maxQty: '5' }))).toEqual({});
    expect(levelProblems(filled({ minQty: '10', reorderPointQty: '5' }))).toEqual({
      minQty: 'outOfOrder',
      reorderPointQty: 'outOfOrder',
    });
    // An unset reorder point compares with nothing; min and max still compare with each other.
    expect(levelProblems(filled({ minQty: '30', maxQty: '20' }))).toEqual({
      minQty: 'outOfOrder',
      maxQty: 'outOfOrder',
    });
    expect(levelProblems(filled({ reorderPointQty: '30', maxQty: '20', minQty: '1' }))).toEqual({
      reorderPointQty: 'outOfOrder',
      maxQty: 'outOfOrder',
    });
  });

  it('say a value past the bound before its order', () => {
    expect(levelProblems(filled({ minQty: '2000000', maxQty: '5' }))).toEqual({
      minQty: 'wholeNumber',
    });
  });
});

describe('an edit', () => {
  const TONER = item();

  it('sends nothing when nothing moved', () => {
    expect(itemChanges(itemFormFrom(TONER), TONER)).toEqual({});
  });

  it('sends only what moved, `null` for an emptied box, and the Active box as `isActive`', () => {
    const form = {
      ...itemFormFrom(TONER),
      barcode: '',
      minQty: '',
      notes: 'على الرف ٣',
      isActive: false,
    };
    const changes = itemChanges(form, TONER);
    expect(changes).toEqual({ barcode: null, minQty: null, notes: 'على الرف ٣', isActive: false });
    expect(UpdateAdministrationItemSchema.safeParse({ ...changes, version: 3 }).success).toBe(true);
  });

  it('sends a name whole when either language moved', () => {
    const changes = itemChanges({ ...itemFormFrom(TONER), nameEn: 'HP 85A black toner' }, TONER);
    expect(changes).toEqual({ name: { ar: 'حبر HP 85A', en: 'HP 85A black toner' } });
  });
});
