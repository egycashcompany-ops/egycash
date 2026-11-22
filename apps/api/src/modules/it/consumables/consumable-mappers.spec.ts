// What the register and the ledger say about a store's items. A movement can outlive the memo it
// was issued on — the workforce reset keeps the ledger and purges the papers, which name the person
// — and a memo that is gone is not offered: a print or upload button for it could only fail (the
// mobile lines' `paperOf`).
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  toItCatalogItemDto,
  toItConsumableDto,
  toItConsumableMemoDto,
  toItConsumableMovementDto,
  type ItConsumableMovementLabels,
} from '../it.mappers';
import { type ItCatalogItemDoc } from '../catalog-items/catalog-item.model';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';
import { type ItConsumableMemoDoc } from './consumable-memo.model';

const at = new Date('2026-10-28T09:00:00.000Z');
const ITEM = new Types.ObjectId();
const TYPE = new Types.ObjectId();
const STORE = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const ASSET = new Types.ObjectId();
const DEPARTMENT = new Types.ObjectId();
const PLACE = new Types.ObjectId();
const SIGNER = new Types.ObjectId();

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
  employees: new Map([
    [String(EMPLOYEE), { code: '0101002', fullNameAr: 'وليد صفوت جلال' }],
    [String(SIGNER), { code: '0101007', fullNameAr: 'شريف ممدوح فاروق' }],
  ]),
  assets: new Map([[String(ASSET), { assetCode: 'AST-00031', name: 'Lenovo ThinkCentre' }]]),
  memos: new Map(),
  departments: new Map([[String(DEPARTMENT), { ar: 'تكنولوجيا المعلومات', en: 'IT' }]]),
  locations: new Map([[String(PLACE), { ar: 'غرفة السيرفرات', en: 'Server room' }]]),
  ...over,
});

/** «صرف لإدارة» — the row names the department, the place and the signer, and no employee. */
const toDepartment = (): ItConsumableMovementDoc =>
  ({
    ...issued(null),
    employeeId: null,
    departmentId: DEPARTMENT,
    locationId: PLACE,
    responsibleEmployeeId: SIGNER,
  }) as unknown as ItConsumableMovementDoc;

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

  it('names no department on a row that has none — an employee’s issue, and every row before', () => {
    expect(toItConsumableMovementDto(issued(null), labels())).toMatchObject({
      departmentId: null,
      departmentName: null,
      locationId: null,
      locationName: null,
      responsibleEmployeeId: null,
      responsibleEmployeeCode: null,
      responsibleEmployeeName: null,
    });
  });

  // «صرف لإدارة» (2026-11-19).
  it('names the department, the place and who signed for it — and no employee', () => {
    expect(toItConsumableMovementDto(toDepartment(), labels())).toMatchObject({
      employeeId: null,
      employeeCode: null,
      employeeName: null,
      departmentId: String(DEPARTMENT),
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationId: String(PLACE),
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
      responsibleEmployeeId: String(SIGNER),
      responsibleEmployeeCode: '0101007',
      responsibleEmployeeName: 'شريف ممدوح فاروق',
    });
  });

  it('keeps the ids of a department, a place or a signer it cannot name', () => {
    const row = toItConsumableMovementDto(
      toDepartment(),
      labels({ departments: new Map(), locations: new Map(), employees: new Map() }),
    );
    expect(row).toMatchObject({
      departmentId: String(DEPARTMENT),
      departmentName: null,
      locationId: String(PLACE),
      locationName: null,
      responsibleEmployeeId: String(SIGNER),
      responsibleEmployeeCode: null,
      responsibleEmployeeName: null,
    });
  });

  // «عداد الطابعة» (2026-11-19): only a counted issue carries the keys.
  it('carries no reading when the row has none — an old toner, or any other row', () => {
    expect(toItConsumableMovementDto(issued(null), labels())).toMatchObject({
      counterReading: null,
      counterReset: false,
    });
  });

  it('carries the printer’s reading of a counted issue, and whether it was a reset', () => {
    const counted = { ...issued(null), counterReading: 15000 } as ItConsumableMovementDoc;
    expect(toItConsumableMovementDto(counted, labels())).toMatchObject({
      counterReading: 15000,
      counterReset: false,
    });
    const reset = { ...counted, counterReading: 0, counterReset: true } as ItConsumableMovementDoc;
    expect(toItConsumableMovementDto(reset, labels())).toMatchObject({
      counterReading: 0,
      counterReset: true,
    });
  });

  it('carries its version — what «تعديل الجهاز» sends back, so a change made first is a conflict', () => {
    const corrected = { ...issued(null), __v: 2 } as unknown as ItConsumableMovementDoc;
    expect(toItConsumableMovementDto(issued(null), labels()).version).toBe(0);
    expect(toItConsumableMovementDto(corrected, labels()).version).toBe(2);
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

  it('is no transfer unless it says so — no transfer id, no other store', () => {
    expect(toItConsumableMovementDto(issued(null), labels())).toMatchObject({
      transferId: null,
      counterpartBranchId: null,
      counterpartConsumableId: null,
      counterpartConsumableCode: null,
    });
  });

  it('names a transfer’s other half: the shared id, the other store, and its item by code', () => {
    const transferId = new Types.ObjectId();
    const otherStore = new Types.ObjectId();
    const otherItem = new Types.ObjectId();
    const out = {
      ...issued(null),
      kind: 'transferredOut',
      employeeId: null,
      assetId: null,
      reason: null,
      transferId,
      counterpartBranchId: otherStore,
      counterpartConsumableId: otherItem,
    } as unknown as ItConsumableMovementDoc;
    const read = labels({
      items: new Map([
        [String(ITEM), { code: 'CON-00003', name: 'Mouse', typeId: String(TYPE) }],
        [String(otherItem), { code: 'CON-00041', name: 'Mouse', typeId: String(TYPE) }],
      ]),
    });
    expect(toItConsumableMovementDto(out, read)).toMatchObject({
      kind: 'transferredOut',
      branchId: String(STORE),
      consumableCode: 'CON-00003',
      transferId: String(transferId),
      counterpartBranchId: String(otherStore),
      counterpartConsumableId: String(otherItem),
      counterpartConsumableCode: 'CON-00041',
    });
    // The other item unread: its id kept, its code unknown.
    expect(toItConsumableMovementDto(out, labels())).toMatchObject({
      counterpartConsumableId: String(otherItem),
      counterpartConsumableCode: null,
    });
  });
});

// «يتطلب عداد الطباعة» (2026-11-19) — a consumable type read back as the issue and the screens read it.
describe('a consumable type', () => {
  const type = (over: Record<string, unknown> = {}): ItCatalogItemDoc =>
    ({
      _id: TYPE,
      kind: 'consumableType',
      code: 'ink',
      name: { ar: 'حبارات', en: 'Ink & toner' },
      description: null,
      sortOrder: 0,
      isActive: true,
      __v: 0,
      createdAt: at,
      updatedAt: at,
      ...over,
    }) as unknown as ItCatalogItemDoc;

  it('carries its flag', () => {
    expect(toItCatalogItemDto(type({ requiresCounterReading: true })).requiresCounterReading).toBe(
      true,
    );
  });

  it('reads a row written before the flag as false — a lean read applies no default', () => {
    expect(toItCatalogItemDto(type()).requiresCounterReading).toBe(false);
  });
});

describe('a memo', () => {
  const memoDoc = (over: Record<string, unknown> = {}): ItConsumableMemoDoc =>
    ({
      _id: new Types.ObjectId(),
      memoNumber: 42,
      issuedAt: at,
      employeeId: SIGNER,
      employeeCode: '0101007',
      employeeName: 'شريف ممدوح فاروق',
      jobTitle: { ar: 'مهندس شبكات', en: 'Network engineer' },
      issuedByUserId: null,
      issuedByName: 'أحمد سمير',
      branchId: STORE,
      lines: [],
      notes: null,
      signedCopy: null,
      __v: 0,
      createdAt: at,
      updatedAt: at,
      ...over,
    }) as unknown as ItConsumableMemoDoc;

  // «لصالح إدارة … بموقع …» (2026-11-19).
  it('names a department memo’s department and place — its signer the responsible person', () => {
    const dto = toItConsumableMemoDto(
      memoDoc({
        custodian: {
          departmentId: DEPARTMENT,
          departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
          locationId: PLACE,
          locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
        },
      }),
    );
    expect(dto).toMatchObject({
      employeeId: String(SIGNER),
      employeeName: 'شريف ممدوح فاروق',
      employeeCode: '0101007',
      custodian: {
        departmentId: String(DEPARTMENT),
        departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
        locationId: String(PLACE),
        locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
      },
    });
  });

  it('names no department on an employee’s memo, nor on one written before (no key at all)', () => {
    expect(toItConsumableMemoDto(memoDoc({ custodian: null })).custodian).toBeNull();
    expect(toItConsumableMemoDto(memoDoc()).custodian).toBeNull();
  });

  it('keeps a department memo’s ids when its names could not be read that day', () => {
    const dto = toItConsumableMemoDto(
      memoDoc({
        custodian: {
          departmentId: DEPARTMENT,
          departmentName: null,
          locationId: PLACE,
          locationName: null,
        },
      }),
    );
    expect(dto.custodian).toEqual({
      departmentId: String(DEPARTMENT),
      departmentName: null,
      locationId: String(PLACE),
      locationName: null,
    });
  });

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
