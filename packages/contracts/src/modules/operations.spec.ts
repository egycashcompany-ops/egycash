// The Operations vocabulary guards — the facts a careless later slice would violate first.
//
// The single most dangerous misreading of the legacy system is treating `transactions.status` as
// an ordinal ladder: the literal 1 is TERMINAL (discovery §6). These tests pin the legacy mapping
// as a bijection with 1 = completed, so a "fix" that reorders it fails loudly here instead of
// silently corrupting migration or report parity in a later slice.
import { describe, expect, it } from 'vitest';
import {
  CreateOperationsBankBranchSchema,
  CreateOperationsShipmentSchema,
  LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS,
  LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE,
  LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS,
  OPERATIONS_DAY_STATUSES,
  OPERATIONS_EXECUTION_STATUSES,
  OPERATIONS_SHIPMENT_LEGS,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  OperationsCrewBoardQuerySchema,
  OperationsShipmentStatusSchema,
  PlanOperationsCrewSchema,
  UpdateOperationsShipmentSchema,
} from './operations.js';

const oid = (n: number): string => n.toString(16).padStart(24, '0');

describe('operations vocabulary — legacy status mapping', () => {
  it('maps legacy code 1 to completed — terminal, NOT the first step', () => {
    expect(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[1]).toBe('completed');
    expect(LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS.completed).toBe(1);
  });

  it('covers exactly the four observed legacy codes 0/1/2/3, no more', () => {
    expect(Object.keys(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE).map(Number).sort()).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('is a bijection — the two maps are exact inverses', () => {
    for (const status of OPERATIONS_SHIPMENT_STATUSES) {
      const code = LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS[status];
      expect(LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[code]).toBe(status);
    }
  });

  it('walks the observed secured lifecycle in legacy codes: 0 → 2 → 3 → 1', () => {
    const walk: string[] = [0, 2, 3, 1].map(
      (code) => LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE[code] as string,
    );
    expect(walk).toEqual(['draft', 'inVault', 'dispatched', 'completed']);
  });

  it('keeps the verbatim Arabic legacy type labels migration matches on', () => {
    expect(LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS.daily).toBe('يومي');
    expect(LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS.secured).toBe('محصنة');
  });
});

describe('operations vocabulary — the shape it actually has today', () => {
  // The pin-the-numbers block (the pages.spec precedent): when a later slice grows a vocabulary,
  // the assertion names it in the same PR instead of letting it drift in unnoticed.
  it('pins the enum sets', () => {
    expect(OPERATIONS_SHIPMENT_TYPES).toEqual(['daily', 'secured']);
    expect(OPERATIONS_SHIPMENT_STATUSES).toEqual(['draft', 'inVault', 'dispatched', 'completed']);
    expect(OPERATIONS_SHIPMENT_LEGS).toEqual(['pickup', 'delivery']);
    expect(OPERATIONS_EXECUTION_STATUSES).toEqual([
      'pending',
      'active',
      'pickedUp',
      'delivered',
      'completed',
      'cancelled',
    ]);
    expect(OPERATIONS_DAY_STATUSES).toEqual(['planning', 'open', 'closed']);
  });

  it('rejects a legacy numeric status where a normalized one is required', () => {
    expect(OperationsShipmentStatusSchema.safeParse(1).success).toBe(false);
    expect(OperationsShipmentStatusSchema.safeParse('completed').success).toBe(true);
  });
});

describe('operations shipment schemas — the legacy create guard, server-enforced', () => {
  const base = {
    shipmentType: 'daily',
    mainBankId: oid(1),
    originBranchId: oid(2),
    destinationBranchId: oid(3),
    lines: [{ currencyId: oid(4), amount: 1500.5 }],
    collectionDate: '2026-08-17',
  };

  it('accepts the legacy-required minimum: banks, branches, one line, the date', () => {
    expect(CreateOperationsShipmentSchema.safeParse(base).success).toBe(true);
  });

  it('keeps the secondary bank optional — legacy never server-checked toBankSelect (:313)', () => {
    const parsed = CreateOperationsShipmentSchema.parse(base);
    expect(parsed.secondaryBankId).toBeNull();
  });

  it('refuses a daily shipment carrying a delivery date — legacy hardcodes del_date "" (:353)', () => {
    expect(
      CreateOperationsShipmentSchema.safeParse({ ...base, deliveryDate: '2026-08-20' }).success,
    ).toBe(false);
    expect(
      CreateOperationsShipmentSchema.safeParse({
        ...base,
        shipmentType: 'secured',
        deliveryDate: '2026-08-20',
      }).success,
    ).toBe(true);
  });

  it('refuses an empty lines array and a negative amount — the legacy input strips the sign', () => {
    expect(CreateOperationsShipmentSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      CreateOperationsShipmentSchema.safeParse({
        ...base,
        lines: [{ currencyId: oid(4), amount: -5 }],
      }).success,
    ).toBe(false);
  });

  it('caps lines at 17 — the legacy multi-currency form had exactly 17 slots (:1230)', () => {
    const lines = Array.from({ length: 18 }, (_, i) => ({ currencyId: oid(i + 10), amount: 1 }));
    expect(CreateOperationsShipmentSchema.safeParse({ ...base, lines }).success).toBe(false);
  });

  it('update is version-locked and cannot change the shipment type', () => {
    expect(UpdateOperationsShipmentSchema.safeParse({ notes: 'x' }).success).toBe(false);
    expect(UpdateOperationsShipmentSchema.safeParse({ notes: 'x', version: 0 }).success).toBe(true);
    expect(
      UpdateOperationsShipmentSchema.safeParse({ shipmentType: 'secured', version: 0 }).success,
    ).toBe(false);
  });
});

describe('operations crew schemas — the tashghela board rules (OP-3)', () => {
  const row = { vehicleId: oid(1), captainEmployeeId: oid(10) };

  it('accepts a captain-only row and a fully empty crew — legacy enforces no minimum (:2419)', () => {
    expect(PlanOperationsCrewSchema.safeParse({ date: '2026-08-18', rows: [row] }).success).toBe(
      true,
    );
    expect(
      PlanOperationsCrewSchema.safeParse({
        date: '2026-08-18',
        rows: [{ vehicleId: oid(1), notes: 'صيانة' }],
      }).success,
    ).toBe(true);
  });

  it('refuses the same person in two slots of one vehicle', () => {
    expect(
      PlanOperationsCrewSchema.safeParse({
        date: '2026-08-18',
        rows: [{ vehicleId: oid(1), captainEmployeeId: oid(10), specialist1EmployeeId: oid(10) }],
      }).success,
    ).toBe(false);
  });

  it('Q11 — refuses the same person on two vehicles in one plan', () => {
    expect(
      PlanOperationsCrewSchema.safeParse({
        date: '2026-08-18',
        rows: [
          { vehicleId: oid(1), captainEmployeeId: oid(10) },
          { vehicleId: oid(2), specialist2EmployeeId: oid(10) },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses a vehicle appearing twice in one plan', () => {
    expect(
      PlanOperationsCrewSchema.safeParse({
        date: '2026-08-18',
        rows: [row, { vehicleId: oid(1) }],
      }).success,
    ).toBe(false);
  });

  it('board query date is optional — no date means tomorrow (legacy :2239)', () => {
    expect(OperationsCrewBoardQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('operations reference schemas', () => {
  it('branch financeAreaName is optional — Q24: legacy defaults area2 to area on add', () => {
    const parsed = CreateOperationsBankBranchSchema.parse({
      bankId: oid(1),
      name: 'فرع المهندسين',
      code: 'B-101',
      opsAreaName: 'الجيزة',
    });
    expect(parsed.financeAreaName).toBeNull();
    expect(parsed.location).toBeNull();
  });

  it('rejects out-of-range coordinates on the optional location', () => {
    expect(
      CreateOperationsBankBranchSchema.safeParse({
        bankId: oid(1),
        name: 'x',
        code: 'y',
        location: { addressLine: null, coordinates: { lat: 100, lng: 0 } },
      }).success,
    ).toBe(false);
  });
});
