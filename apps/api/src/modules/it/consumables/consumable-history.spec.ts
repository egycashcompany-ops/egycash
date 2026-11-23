// The rows and audit entries every writer of the store builds the same way — the services and the
// go-live import alike — pinned here so «an opening balance» and «a delivery» are one shape
// whichever of them wrote it.
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';

const { publishAuditedChange, record } = vi.hoisted(() => ({
  publishAuditedChange: vi.fn(),
  record: vi.fn(),
}));
vi.mock('../../../platform/audit', () => ({ auditService: { record } }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange }));

const {
  MOVEMENT_AUDIT_ACTION,
  auditConsumableMemoIssued,
  auditStockMovement,
  consumableEntityRef,
  consumableItemRow,
  consumableMemoEntityRef,
  consumableMovementRow,
  counterChanges,
} = await import('./consumable-history');

const TYPE = new Types.ObjectId();
const STORE = new Types.ObjectId();
const SIGNER = new Types.ObjectId();

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
      transferId: null,
      counterpartBranchId: null,
      counterpartConsumableId: null,
    });
  });

  it('names a transfer’s pair — the shared id, the other store and its item — on each half', () => {
    const item = { _id: new Types.ObjectId(), branchId: STORE };
    const at = new Date('2026-11-11T09:00:00.000Z');
    const transferId = new Types.ObjectId();
    const otherStore = new Types.ObjectId();
    const otherItem = new Types.ObjectId();
    expect(
      consumableMovementRow({
        item,
        kind: 'transferredOut',
        qty: 5,
        at,
        byUserId: null,
        transferId,
        counterpartBranchId: otherStore,
        counterpartConsumableId: otherItem,
      }),
    ).toMatchObject({
      consumableId: item._id,
      kind: 'transferredOut',
      qty: 5,
      // The row is in ITS item's store; the other store is the counterpart.
      branchId: STORE,
      employeeId: null,
      memoId: null,
      transferId,
      counterpartBranchId: otherStore,
      counterpartConsumableId: otherItem,
    });
  });

  // «صرف لإدارة» (2026-11-19).
  it('names a department issue’s department, place and signer — and no employee', () => {
    const item = { _id: new Types.ObjectId(), branchId: STORE };
    const at = new Date('2026-11-19T09:00:00.000Z');
    const department = new Types.ObjectId();
    const place = new Types.ObjectId();
    const signer = new Types.ObjectId();
    expect(
      consumableMovementRow({
        item,
        kind: 'issued',
        qty: 2,
        at,
        byUserId: null,
        employeeId: null,
        department: {
          departmentId: String(department),
          locationId: String(place),
          responsibleEmployeeId: String(signer),
        },
        reason: 'new',
      }),
    ).toMatchObject({
      kind: 'issued',
      employeeId: null,
      departmentId: department,
      locationId: place,
      responsibleEmployeeId: signer,
    });
  });

  it('carries no department key at all on any other row — an old row and a new one read alike', () => {
    const item = { _id: new Types.ObjectId(), branchId: STORE };
    const row = consumableMovementRow({
      item,
      kind: 'issued',
      qty: 1,
      at: new Date('2026-11-19T09:00:00.000Z'),
      byUserId: null,
      employeeId: String(new Types.ObjectId()),
      department: null,
    });
    expect(row).not.toHaveProperty('departmentId');
    expect(row).not.toHaveProperty('locationId');
    expect(row).not.toHaveProperty('responsibleEmployeeId');
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
      // Both halves of a transfer between two stores: the asset's own verb for a branch move.
      transferredOut: 'transfer',
      transferredIn: 'transfer',
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

  describe('a memo’s row', () => {
    const memo = (custodian: unknown) =>
      ({
        _id: new Types.ObjectId(),
        memoNumber: 42,
        employeeId: SIGNER,
        lines: [{ code: 'CON-00001', qty: 2, reason: 'new' }],
        ...(custodian === undefined ? {} : { custodian }),
      }) as never;
    const changesOf = () =>
      (record.mock.calls.at(-1)?.[0] as { changes: { field: string; new: unknown }[] }).changes;

    it('names the signer — the employee it went to — on an employee’s memo', async () => {
      await auditConsumableMemoIssued(memo(null));
      expect(changesOf().map((entry) => entry.field)).toEqual([
        'employeeId',
        'memoNumber',
        'items',
      ]);
      // A memo written before department memos: no key at all, read the same.
      await auditConsumableMemoIssued(memo(undefined));
      expect(changesOf().map((entry) => entry.field)).toEqual([
        'employeeId',
        'memoNumber',
        'items',
      ]);
    });

    it('names the department and the place beside the signer on a department memo', async () => {
      const department = new Types.ObjectId();
      const place = new Types.ObjectId();
      await auditConsumableMemoIssued(
        memo({
          departmentId: department,
          departmentName: null,
          locationId: place,
          locationName: null,
        }),
      );
      expect(changesOf()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'employeeId', new: String(SIGNER) }),
          expect.objectContaining({ field: 'departmentId', new: String(department) }),
          expect.objectContaining({ field: 'locationId', new: String(place) }),
        ]),
      );
    });
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
