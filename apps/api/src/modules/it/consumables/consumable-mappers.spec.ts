// What the register and the ledger say about a store's items. A movement can outlive the memo it
// was issued on — the workforce reset keeps the ledger and purges the papers, which name the person
// — and a memo that is gone is not offered: a print or upload button for it could only fail (the
// mobile lines' `paperOf`).
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  toItConsumableDto,
  toItConsumableMemoDto,
  toItConsumableMovementDto,
  type ItConsumableMovementLabels,
} from '../it.mappers';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';
import { type ItConsumableMemoDoc } from './consumable-memo.model';

const at = new Date('2026-10-28T09:00:00.000Z');
const ITEM = new Types.ObjectId();
const TYPE = new Types.ObjectId();
const STORE = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const ASSET = new Types.ObjectId();

const item = (over: Partial<ItConsumableDoc> = {}): ItConsumableDoc =>
  ({
    _id: ITEM,
    code: 'CON-00003',
    name: 'Mouse',
    typeId: TYPE,
    unit: 'قطعة',
    branchId: STORE,
    minQty: 5,
    notes: null,
    active: true,
    onHandQty: 5,
    issuedQty: 9,
    scrappedQty: 2,
    __v: 3,
    createdAt: at,
    updatedAt: at,
    ...over,
  }) as unknown as ItConsumableDoc;

const issued = (memoId: Types.ObjectId | null): ItConsumableMovementDoc =>
  ({
    _id: new Types.ObjectId(),
    consumableId: ITEM,
    kind: 'issued',
    qty: 1,
    at,
    branchId: STORE,
    byUserId: null,
    employeeId: EMPLOYEE,
    assetId: ASSET,
    reason: 'replacement',
    memoId,
    notes: null,
    __v: 0,
    createdAt: at,
    updatedAt: at,
  }) as unknown as ItConsumableMovementDoc;

const labels = (over: Partial<ItConsumableMovementLabels> = {}): ItConsumableMovementLabels => ({
  items: new Map([[String(ITEM), { code: 'CON-00003', name: 'Mouse', typeId: String(TYPE) }]]),
  employees: new Map([[String(EMPLOYEE), { code: '0101002', fullNameAr: 'وليد صفوت جلال' }]]),
  assets: new Map([[String(ASSET), { assetCode: 'AST-00031', name: 'Lenovo ThinkCentre' }]]),
  memos: new Map(),
  ...over,
});

describe('an item on the register', () => {
  it('carries its three counters, and the reorder hint at or below its own minimum', () => {
    expect(toItConsumableDto(item())).toMatchObject({
      id: String(ITEM),
      typeId: String(TYPE),
      branchId: String(STORE),
      onHandQty: 5,
      issuedQty: 9,
      scrappedQty: 2,
      belowMin: true,
      version: 3,
    });
    expect(toItConsumableDto(item({ onHandQty: 6 })).belowMin).toBe(false);
    // No minimum, no hint — «not set» is not a silent zero.
    expect(toItConsumableDto(item({ onHandQty: 0, minQty: null })).belowMin).toBe(false);
  });
});

describe('a movement on the ledger', () => {
  it('names the item, the person and the asset it went on, read for the page', () => {
    expect(toItConsumableMovementDto(issued(null), labels())).toMatchObject({
      consumableCode: 'CON-00003',
      consumableName: 'Mouse',
      typeId: String(TYPE),
      employeeId: String(EMPLOYEE),
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      assetId: String(ASSET),
      assetCode: 'AST-00031',
      assetName: 'Lenovo ThinkCentre',
      reason: 'replacement',
      memoId: null,
      memoNumber: null,
      memoSigned: null,
    });
  });

  it('keeps the ids of what it cannot name — an asset outside the reader’s scope stays unnamed', () => {
    const row = toItConsumableMovementDto(issued(null), labels({ assets: new Map() }));
    expect(row).toMatchObject({ assetId: String(ASSET), assetCode: null, assetName: null });
  });

  it('offers its memo when it can be read, with its number and signed state', () => {
    const memo = new Types.ObjectId();
    const row = toItConsumableMovementDto(
      issued(memo),
      labels({ memos: new Map([[String(memo), { memoNumber: 41, signed: true }]]) }),
    );
    expect(row).toMatchObject({ memoId: String(memo), memoNumber: 41, memoSigned: true });
  });

  it('offers no memo once it is gone — no id, no number, no signed state', () => {
    const row = toItConsumableMovementDto(issued(new Types.ObjectId()), labels());
    expect(row).toMatchObject({ memoId: null, memoNumber: null, memoSigned: null });
  });
});

describe('a memo', () => {
  it('is the paper as it was written: the signer, the issuer and each row, no national ID', () => {
    const movementId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      memoNumber: 41,
      issuedAt: at,
      employeeId: EMPLOYEE,
      employeeCode: '0101002',
      employeeName: 'وليد صفوت جلال',
      jobTitle: { ar: 'محاسب', en: 'Accountant' },
      issuedByUserId: null,
      issuedByName: 'أحمد سمير',
      branchId: STORE,
      lines: [
        {
          consumableId: ITEM,
          movementId,
          code: 'CON-00003',
          name: 'Mouse',
          typeName: { ar: 'ماوس', en: 'Mice' },
          unit: 'قطعة',
          qty: 1,
          reason: 'replacement',
          assetId: ASSET,
          assetCode: 'AST-00031',
          assetName: 'Lenovo ThinkCentre',
        },
      ],
      notes: null,
      signedCopy: null,
      __v: 0,
      createdAt: at,
      updatedAt: at,
    } as unknown as ItConsumableMemoDoc;

    const dto = toItConsumableMemoDto(doc);
    expect(dto).toMatchObject({
      memoNumber: 41,
      issuedAt: at.toISOString(),
      employeeCode: '0101002',
      jobTitle: { ar: 'محاسب', en: 'Accountant' },
      issuedByName: 'أحمد سمير',
      issuedByUserId: null,
      signedCopy: null,
    });
    expect(dto).not.toHaveProperty('nationalId');
    expect(dto.lines).toEqual([
      {
        consumableId: String(ITEM),
        movementId: String(movementId),
        code: 'CON-00003',
        name: 'Mouse',
        typeName: { ar: 'ماوس', en: 'Mice' },
        unit: 'قطعة',
        qty: 1,
        reason: 'replacement',
        assetId: String(ASSET),
        assetCode: 'AST-00031',
        assetName: 'Lenovo ThinkCentre',
      },
    ]);
  });
});
