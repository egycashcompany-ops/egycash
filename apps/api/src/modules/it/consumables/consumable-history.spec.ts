// The rows and audit entries every writer of the store builds the same way — the services and the
// go-live import alike — pinned here so «an opening balance» and «a delivery» are one shape
// whichever of them wrote it.
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../platform/audit', () => ({ auditService: { record: vi.fn() } }));
const { publishAuditedChange } = vi.hoisted(() => ({ publishAuditedChange: vi.fn() }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange }));

const {
  MOVEMENT_AUDIT_ACTION,
  auditStockMovement,
  consumableEntityRef,
  consumableItemRow,
  consumableMemoEntityRef,
  consumableMovementRow,
  counterChanges,
} = await import('./consumable-history');

const TYPE = new Types.ObjectId();
const STORE = new Types.ObjectId();

describe('a new item’s row', () => {
  it('starts empty, or holding exactly its opening delivery', () => {
    const base = { code: 'CON-00001', name: 'SSD', typeId: TYPE, unit: 'قطعة', branchId: STORE };
    expect(consumableItemRow(base)).toEqual({
      ...base,
      minQty: null,
      notes: null,
      active: true,
      onHandQty: 0,
      issuedQty: 0,
      scrappedQty: 0,
    });
    expect(consumableItemRow({ ...base, openingQty: 3 })).toMatchObject({
      onHandQty: 3,
      issuedQty: 0,
      scrappedQty: 0,
    });
  });
});

describe('a ledger row', () => {
  it('carries every key, null where its kind has nothing to say, and its item’s store', () => {
    const item = { _id: new Types.ObjectId(), branchId: STORE };
    const at = new Date('2026-10-28T00:00:00.000Z');
    expect(
      consumableMovementRow({ item, kind: 'received', qty: 3, at, byUserId: null, notes: 'جرد' }),
    ).toEqual({
      consumableId: item._id,
      kind: 'received',
      qty: 3,
      at,
      branchId: STORE,
      byUserId: null,
      employeeId: null,
      assetId: null,
      reason: null,
      memoId: null,
      notes: 'جرد',
    });
  });
});

describe('the audit trail', () => {
  it('names the two audited entities as literal pairs the realtime registry classifies', () => {
    expect(consumableEntityRef('x')).toEqual({
      moduleId: 'it',
      entityType: 'consumable',
      entityId: 'x',
    });
    expect(consumableMemoEntityRef('y')).toEqual({
      moduleId: 'it',
      entityType: 'consumableMemo',
      entityId: 'y',
    });
  });

  it('files each movement under the verb a dispute filters on', () => {
    expect(MOVEMENT_AUDIT_ACTION).toEqual({
      received: 'receive',
      issued: 'assign',
      scrapped: 'dispose',
      returned: 'return',
    });
  });

  it('records the counters a movement moved — and none it did not', () => {
    expect(
      counterChanges(
        { onHandQty: 5, issuedQty: 0, scrappedQty: 0 },
        { onHandQty: 4, issuedQty: 1, scrappedQty: 1 },
      ),
    ).toEqual([
      { field: 'onHandQty', old: 5, new: 4 },
      { field: 'issuedQty', old: 0, new: 1 },
      { field: 'scrappedQty', old: 0, new: 1 },
    ]);
    expect(
      counterChanges(
        { onHandQty: 5, issuedQty: 2, scrappedQty: 0 },
        { onHandQty: 6, issuedQty: 2, scrappedQty: 0 },
      ),
    ).toEqual([{ field: 'onHandQty', old: 5, new: 6 }]);
  });
});

describe('a movement on an open screen', () => {
  it('is announced as a change of its item, to its own store — its audit verb is not a data word', async () => {
    const id = String(new Types.ObjectId());
    await auditStockMovement({
      consumableId: id,
      kind: 'received',
      before: { onHandQty: 0, issuedQty: 0, scrappedQty: 0 },
      after: { onHandQty: 5, issuedQty: 0, scrappedQty: 0, branchId: STORE },
    });
    expect(publishAuditedChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'consumable', entityId: id },
        action: 'update',
        branchId: String(STORE),
      }),
    );
  });
});
