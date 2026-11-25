// The item's unit lock (design §2.3.4, §3.6; P2 plan §6.2, §12.1): with no registrant an item's
// unit changes freely, as it did in Phase 1; once a feature answers that its lines name the item,
// an edit that changes the unit is refused 422 `ADMINISTRATION_ITEM_UNIT_LOCKED` — and only that
// edit: every other field, and the unit it already has, still save. The registry runs for real;
// the edit's storage is mocked, since what is pinned is which edit is asked and refused.
import { ErrorCodes } from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  updateById: vi.fn(),
  findLiveByNameKey: vi.fn(),
  findUnit: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('./item.repository', () => ({
  administrationItemRepository: {
    ensureCollection: async () => undefined,
    getById: mocks.getById,
    updateById: mocks.updateById,
    findLiveByNameKey: mocks.findLiveByNameKey,
  },
}));
vi.mock('./item-audit', () => ({ auditItemCreated: mocks.audit, auditItemEdited: mocks.audit }));
vi.mock('../catalog-items/index', () => ({
  administrationCatalogItemService: { findUnit: mocks.findUnit },
  unitActiveFor: () => true,
}));
vi.mock('../item-categories/index', () => ({
  administrationItemCategoryService: { hasActiveSubcategories: async () => false },
  categoryActiveFor: () => true,
}));

const { itemUnitLocks, registerItemReferenceChecker } = await import('./item-unit-lock');
const { unitLockRefusal } = await import('./item-rules');
const { administrationItemService } = await import('./item.service');

const ITEM = '64a0000000000000000000c1';
const UNIT = new Types.ObjectId('64a0000000000000000000c9');
const OTHER_UNIT = '64a0000000000000000000ca';
const ctx = {
  userId: String(new Types.ObjectId()),
  permissions: { 'administrationItem.edit': 'organization' },
  // The fields the edit reads; the rest of a session's context is not what is pinned here.
} as unknown as AuthContext;

const stored = {
  _id: new Types.ObjectId(ITEM),
  code: 'ITM-00001',
  barcode: null,
  name: { ar: 'ورق تصوير', en: 'Copy paper' },
  nameKey: 'ورقتصوير',
  categoryId: new Types.ObjectId(),
  unitId: UNIT,
  minQty: null,
  reorderPointQty: null,
  maxQty: null,
  description: null,
  notes: null,
  stockTracked: true,
  isActive: true,
  __v: 3,
};

/** Which items the registered feature says its lines name. */
const named = new Set<string>();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getById.mockResolvedValue(stored);
  mocks.updateById.mockImplementation(async (_id: string, set: object) => ({ ...stored, ...set }));
  mocks.findLiveByNameKey.mockResolvedValue(null);
  mocks.findUnit.mockResolvedValue({ isActive: true, kind: 'unit' });
  mocks.audit.mockResolvedValue(undefined);
  named.clear();
});

describe('the registry', () => {
  it('with no registrant, nothing locks an item — Phase 1’s behaviour', async () => {
    expect(await itemUnitLocks(ITEM)).toEqual([]);
    expect(unitLockRefusal([])).toBeNull();
  });

  it('a registrant’s answer is the item’s lock, each lock once', async () => {
    registerItemReferenceChecker(async (itemId) =>
      named.has(itemId) ? 'purchaseRequestLine' : null,
    );
    // A second feature answering the same lock does not repeat it.
    registerItemReferenceChecker(async (itemId) =>
      named.has(itemId) ? 'purchaseRequestLine' : null,
    );
    expect(await itemUnitLocks(ITEM)).toEqual([]);
    named.add(ITEM);
    expect(await itemUnitLocks(ITEM)).toEqual(['purchaseRequestLine']);
  });

  it('the refusal: 422, one detail per lock on the unit field', () => {
    const refusal = unitLockRefusal(['purchaseRequestLine']);
    expect(refusal?.code).toBe(ErrorCodes.ADMINISTRATION_ITEM_UNIT_LOCKED);
    expect(refusal?.httpStatus).toBe(422);
    expect(refusal?.details).toEqual([
      expect.objectContaining({ field: 'unitId', code: 'purchaseRequestLine' }),
    ]);
  });
});

describe('the item edit asks it (§2.3.4)', () => {
  // Its own registrant, so these cases stand alone under `-t` or `.only`: the registry is the
  // module's, and a second registration of one lock is answered once.
  beforeAll(() => {
    registerItemReferenceChecker(async (itemId) =>
      named.has(itemId) ? 'purchaseRequestLine' : null,
    );
  });

  it('an unnamed item changes its unit freely', async () => {
    await administrationItemService.update(ITEM, { unitId: OTHER_UNIT, version: 3 }, ctx);
    expect(mocks.updateById).toHaveBeenCalledWith(
      ITEM,
      expect.objectContaining({ unitId: new Types.ObjectId(OTHER_UNIT) }),
      expect.anything(),
    );
  });

  it('once a line names the item, a unit change is refused before anything is written', async () => {
    named.add(ITEM);
    const refused = await administrationItemService
      .update(ITEM, { unitId: OTHER_UNIT, version: 3 }, ctx)
      .then(
        () => null,
        (error: unknown) => error as AppError,
      );
    expect(refused?.code).toBe(ErrorCodes.ADMINISTRATION_ITEM_UNIT_LOCKED);
    expect(mocks.updateById).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('…and only that: another field, or the unit it already has, still saves', async () => {
    named.add(ITEM);
    await administrationItemService.update(ITEM, { notes: 'رف ٣', version: 3 }, ctx);
    await administrationItemService.update(ITEM, { unitId: String(UNIT), version: 3 }, ctx);
    expect(mocks.updateById).toHaveBeenCalledTimes(2);
  });
});
