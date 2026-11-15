// The Operations vocabulary guards — the facts a careless later slice would violate first.
//
// The single most dangerous misreading of the legacy system is treating `transactions.status` as
// an ordinal ladder: the literal 1 is TERMINAL (discovery §6). These tests pin the legacy mapping
// as a bijection with 1 = completed, so a "fix" that reorders it fails loudly here instead of
// silently corrupting migration or report parity in a later slice.
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  CancelVaultReceiptSchema,
  ConfirmSecuredPickupSchema,
  CreateOperationsBankBranchSchema,
  CreateOperationsCurrencySchema,
  CreateOperationsShipmentSchema,
  LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS,
  LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE,
  LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS,
  OPERATIONS_DAY_STATUSES,
  OPERATIONS_EXECUTION_STATUSES,
  OPERATIONS_PICKED_UP_EXECUTION_STATUSES,
  OPERATIONS_RECEIPT_CANCEL_REASON_MAX,
  OPERATIONS_SECURED_PICKED_UP_BY,
  OPERATIONS_SECURED_PICKED_UP_STAGES,
  OPERATIONS_SECURED_RECEIVABLE_STAGES,
  OPERATIONS_SECURED_STAGES,
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OPERATIONS_SHIPMENT_LEGS,
  OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS,
  OPERATIONS_SHIPMENT_LOG_PICKED_UP_BY_FIELDS,
  OPERATIONS_SHIPMENT_LOG_FIELDS,
  OPERATIONS_SHIPMENT_LOG_KINDS,
  OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
  OperationsCrewBoardQuerySchema,
  OperationsDeletedShipmentsQuerySchema,
  OperationsEvents,
  OperationsShipmentHistoryQuerySchema,
  OperationsSecuredBoardQuerySchema,
  OperationsSecuredDispatchBoardQuerySchema,
  OperationsShipmentPickupPayloadV1,
  OperationsShipmentStatusSchema,
  OperationsVaultQueueQuerySchema,
  OrderOperationsCurrenciesSchema,
  PlanOperationsCrewSchema,
  ReceiveIntoVaultSchema,
  ReceiveIntoVaultShipmentPatchSchema,
  OPERATIONS_VAULT_DENOMINATIONS,
  OPERATIONS_VAULT_SEAL_CHECK_MAX,
  CheckVaultSealsSchema,
  UpdateOperationsCurrencySchema,
  SetOperationsStandingCrewSchema,
  UndoSecuredPickupSchema,
  UpdateOperationsShipmentSchema,
  isOperationsShipmentLocked,
  vaultSealKey,
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
    // Round 8 — the محصنة row's colour, derived on the server: white, yellow, green, out, done.
    // Round 10 adds the second yellow: the desk's ✓ («تم الاستلام من العمليات»).
    expect(OPERATIONS_SECURED_STAGES).toEqual([
      'awaitingPickup',
      'withCaptain',
      'withOperations',
      'inVault',
      'dispatched',
      'completed',
    ]);
    // Round 13 — «والخزنه تستلم عادي»: the vault receives ANY draft, white or yellow (Round 10 had
    // allowed the yellow ones only)…
    expect(OPERATIONS_SECURED_RECEIVABLE_STAGES).toEqual([
      'awaitingPickup',
      'withCaptain',
      'withOperations',
    ]);
    // "Picked up" is its own list — the two yellow ones — what the pickup column reads.
    expect(OPERATIONS_SECURED_PICKED_UP_STAGES).toEqual(['withCaptain', 'withOperations']);
    expect(OPERATIONS_SECURED_PICKED_UP_BY).toEqual(['captain', 'operations']);
    // The captain's ✓ on collecting it from the bank is every state from `pickedUp` on.
    expect(OPERATIONS_PICKED_UP_EXECUTION_STATUSES).toEqual(['pickedUp', 'delivered', 'completed']);
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

  // «ومحتاج اشيل دا تتبّع أرقام الأوراق النقدية» — the forms no longer send it; the API still keeps it.
  it('serialTracked is optional: false when a create leaves it out, untouched when an edit does', () => {
    expect(CreateOperationsShipmentSchema.parse(base).serialTracked).toBe(false);
    expect(
      CreateOperationsShipmentSchema.parse({ ...base, serialTracked: true }).serialTracked,
    ).toBe(true);
    expect(UpdateOperationsShipmentSchema.parse({ notes: 'x', version: 0 })).not.toHaveProperty(
      'serialTracked',
    );
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
  const row = { vehicleId: oid(1), captainEmployeeIds: [oid(10)] };
  const plan = (rows: unknown[]) =>
    PlanOperationsCrewSchema.safeParse({ date: '2026-08-18', rows });

  it('accepts a captain-only row and a fully empty crew — legacy enforces no minimum (:2419)', () => {
    expect(plan([row]).success).toBe(true);
    expect(plan([{ vehicleId: oid(1), notes: 'صيانة' }]).success).toBe(true);
    expect(plan([{ vehicleId: oid(1), captainEmployeeIds: [] }]).success).toBe(true);
  });

  it('accepts a crew of six — two per slot, the new capacity', () => {
    expect(
      plan([
        {
          vehicleId: oid(1),
          captainEmployeeIds: [oid(10), oid(11)],
          specialist1EmployeeIds: [oid(12), oid(13)],
          specialist2EmployeeIds: [oid(14), oid(15)],
        },
      ]).success,
    ).toBe(true);
  });

  it('refuses a THIRD person in one slot — CREW_SLOT_CAPACITY is the ceiling', () => {
    expect(
      plan([{ vehicleId: oid(1), captainEmployeeIds: [oid(10), oid(11), oid(12)] }]).success,
    ).toBe(false);
    expect(CREW_SLOT_CAPACITY).toBe(2);
  });

  it('refuses the same person twice inside ONE slot', () => {
    // Unexpressible while a slot held one person; trivially expressible now, so it is refused
    // here rather than left to store a two-captain crew that is really one person twice.
    expect(plan([{ vehicleId: oid(1), captainEmployeeIds: [oid(10), oid(10)] }]).success).toBe(
      false,
    );
  });

  it('refuses the same person in two slots of one vehicle', () => {
    expect(
      plan([
        {
          vehicleId: oid(1),
          captainEmployeeIds: [oid(10)],
          specialist1EmployeeIds: [oid(10)],
        },
      ]).success,
    ).toBe(false);
  });

  it('refuses a co-captain who is also a specialist on the same vehicle', () => {
    expect(
      plan([
        {
          vehicleId: oid(1),
          captainEmployeeIds: [oid(10), oid(11)],
          specialist2EmployeeIds: [oid(11)],
        },
      ]).success,
    ).toBe(false);
  });

  it('Q11 — refuses the same person on two vehicles in one plan', () => {
    expect(
      plan([
        { vehicleId: oid(1), captainEmployeeIds: [oid(10)] },
        { vehicleId: oid(2), specialist2EmployeeIds: [oid(10)] },
      ]).success,
    ).toBe(false);
  });

  it('Q11 reaches the SECOND occupant of a slot, not just the first', () => {
    // The traversal widened with the slots; a rule that only checked position 0 would have let a
    // co-captain be double-booked while the plan still validated.
    expect(
      plan([
        { vehicleId: oid(1), captainEmployeeIds: [oid(9), oid(10)] },
        { vehicleId: oid(2), captainEmployeeIds: [oid(10)] },
      ]).success,
    ).toBe(false);
  });

  it('lets two DIFFERENT people captain two different vehicles', () => {
    expect(
      plan([
        { vehicleId: oid(1), captainEmployeeIds: [oid(9), oid(10)] },
        { vehicleId: oid(2), captainEmployeeIds: [oid(11), oid(12)] },
      ]).success,
    ).toBe(true);
  });

  it('refuses a vehicle appearing twice in one plan', () => {
    expect(
      PlanOperationsCrewSchema.safeParse({
        date: '2026-08-18',
        rows: [row, { vehicleId: oid(1) }],
      }).success,
    ).toBe(false);
  });

  describe('the standing crew (الطاقم الثابت) — the same rules, minus the day', () => {
    const standing = (rows: unknown[]) => SetOperationsStandingCrewSchema.safeParse({ rows });

    it('takes no date at all — that absence IS the entity', () => {
      expect(
        SetOperationsStandingCrewSchema.safeParse({
          date: '2026-08-18',
          rows: [{ vehicleId: oid(1) }],
        }).success,
      ).toBe(false);
    });

    it('accepts an EMPTY row — "in the fleet, nobody on it yet" is the fact it stores', () => {
      // The daily board treats a crewless, annotation-less row as nothing happening. Here it is
      // membership, so it must be expressible.
      expect(standing([{ vehicleId: oid(1) }]).success).toBe(true);
    });

    it('accepts an empty plan — a save that only removed vehicles has nothing to upsert', () => {
      expect(standing([]).success).toBe(true);
    });

    it('carries the same six-person ceiling as a day, because it is the day\u2019s template', () => {
      expect(
        standing([
          {
            vehicleId: oid(1),
            captainEmployeeIds: [oid(10), oid(11)],
            specialist1EmployeeIds: [oid(12), oid(13)],
            specialist2EmployeeIds: [oid(14), oid(15)],
          },
        ]).success,
      ).toBe(true);
      expect(
        standing([{ vehicleId: oid(1), captainEmployeeIds: [oid(10), oid(11), oid(12)] }]).success,
      ).toBe(false);
    });

    it('refuses the same person twice in one slot, and in two slots of one vehicle', () => {
      expect(standing([{ vehicleId: oid(1), captainEmployeeIds: [oid(10), oid(10)] }]).success).toBe(
        false,
      );
      expect(
        standing([
          {
            vehicleId: oid(1),
            captainEmployeeIds: [oid(10)],
            specialist1EmployeeIds: [oid(10)],
          },
        ]).success,
      ).toBe(false);
    });

    it("Q11's day-independent shadow — one person holds one vehicle in the standing crew", () => {
      // Not decoration: without it, a standing crew that puts someone on two vehicles produces a
      // seed that breaks Q11 the moment both are rostered the same day.
      expect(
        standing([
          { vehicleId: oid(1), captainEmployeeIds: [oid(9), oid(10)] },
          { vehicleId: oid(2), specialist2EmployeeIds: [oid(10)] },
        ]).success,
      ).toBe(false);
    });

    it('refuses a vehicle appearing twice, and carries no notes field', () => {
      expect(standing([{ vehicleId: oid(1) }, { vehicleId: oid(1) }]).success).toBe(false);
      // A note on a DAY's crew row is about that day; a permanent note is a different thing.
      expect(standing([{ vehicleId: oid(1), notes: 'ملاحظة' }]).success).toBe(false);
    });
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

// «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة الحركة بالظبط» — the currencies are dragged
// into order like Fleet's catalogs, and the order is a field the catalog answers with.
describe('operations currency order', () => {
  it('takes sortOrder as optional on create and edit — the drag order usually sets it', () => {
    const created = CreateOperationsCurrencySchema.parse({ code: 'EGP', name: 'مصري' });
    expect(created.sortOrder).toBeUndefined();
    expect(
      CreateOperationsCurrencySchema.safeParse({ code: 'EGP', name: 'مصري', sortOrder: 0 }).success,
    ).toBe(true);
    expect(
      CreateOperationsCurrencySchema.safeParse({ code: 'EGP', name: 'مصري', sortOrder: -1 })
        .success,
    ).toBe(false);
    expect(UpdateOperationsCurrencySchema.safeParse({ sortOrder: null, version: 0 }).success).toBe(
      true,
    );
  });

  it('orders a list of distinct ids — never an empty one, never one twice', () => {
    expect(OrderOperationsCurrenciesSchema.safeParse({ ids: [oid(1), oid(2)] }).success).toBe(true);
    expect(OrderOperationsCurrenciesSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(OrderOperationsCurrenciesSchema.safeParse({ ids: [oid(1), oid(1)] }).success).toBe(
      false,
    );
    expect(
      OrderOperationsCurrenciesSchema.safeParse({ ids: [oid(1)], kind: 'x' }).success,
    ).toBe(false);
  });
});

describe('the secured screen and the vault queue — their queries', () => {
  it('the secured board takes no parameters at all', () => {
    expect(OperationsSecuredBoardQuerySchema.safeParse({}).success).toBe(true);
    expect(OperationsSecuredBoardQuerySchema.safeParse({ date: '2026-08-01' }).success).toBe(false);
  });

  it('the vault queue takes `all` as a query boolean, and nothing else', () => {
    expect(OperationsVaultQueueQuerySchema.parse({}).all).toBeUndefined();
    expect(OperationsVaultQueueQuerySchema.parse({ all: 'true' }).all).toBe(true);
    expect(OperationsVaultQueueQuerySchema.parse({ all: 'false' }).all).toBe(false);
    expect(OperationsVaultQueueQuerySchema.safeParse({ all: 'yes' }).success).toBe(false);
    expect(OperationsVaultQueueQuerySchema.safeParse({ status: 'draft' }).success).toBe(false);
  });
});

// Round 10 — «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد … يعدل عليها».
describe('the secured pickup ✓, the lock and the cancelled receipt — their rules', () => {
  it('locks a secured shipment from the vault on, and never a daily one', () => {
    expect(isOperationsShipmentLocked({ shipmentType: 'secured', status: 'draft' })).toBe(false);
    for (const status of ['inVault', 'dispatched', 'completed'] as const) {
      expect(isOperationsShipmentLocked({ shipmentType: 'secured', status })).toBe(true);
    }
    for (const status of OPERATIONS_SHIPMENT_STATUSES) {
      expect(isOperationsShipmentLocked({ shipmentType: 'daily', status })).toBe(false);
    }
  });

  it('the pickup ✓ and its undo take the version and nothing else', () => {
    expect(UndoSecuredPickupSchema).toBe(ConfirmSecuredPickupSchema);
    expect(ConfirmSecuredPickupSchema.safeParse({ version: 3 }).success).toBe(true);
    expect(ConfirmSecuredPickupSchema.safeParse({}).success).toBe(false);
    expect(ConfirmSecuredPickupSchema.safeParse({ version: 3, by: 'captain' }).success).toBe(false);
  });

  it('a cancelled receipt needs a reason — trimmed, 3 to 500 characters — and the version', () => {
    const parse = (reason: unknown) => CancelVaultReceiptSchema.safeParse({ reason, version: 2 });
    expect(parse('  استلام خاطئ  ').success).toBe(true);
    expect(CancelVaultReceiptSchema.parse({ reason: '  خطأ  ', version: 2 }).reason).toBe('خطأ');
    expect(parse('  ab  ').success).toBe(false);
    expect(parse('').success).toBe(false);
    expect(parse(undefined).success).toBe(false);
    expect(parse('x'.repeat(OPERATIONS_RECEIPT_CANCEL_REASON_MAX)).success).toBe(true);
    expect(parse('x'.repeat(OPERATIONS_RECEIPT_CANCEL_REASON_MAX + 1)).success).toBe(false);
    expect(CancelVaultReceiptSchema.safeParse({ reason: 'سبب كافٍ' }).success).toBe(false);
  });

  it('«صرف الخزينة» takes ONE optional delivery day — and nothing else', () => {
    expect(OperationsSecuredDispatchBoardQuerySchema.safeParse({}).success).toBe(true);
    const day = OperationsSecuredDispatchBoardQuerySchema.parse({ date: '2026-11-01' });
    expect(day.date?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    // An empty value is not "every day" — the screen omits the key.
    expect(OperationsSecuredDispatchBoardQuerySchema.safeParse({ date: '' }).success).toBe(false);
    expect(
      OperationsSecuredDispatchBoardQuerySchema.safeParse({ from: '2026-11-01' }).success,
    ).toBe(false);
  });

  it('the three acts are their own events, the pickup ones saying WHO', () => {
    expect(OperationsEvents.ShipmentPickupConfirmed).toBe('operations.shipment.pickupConfirmed');
    expect(OperationsEvents.ShipmentPickupUndone).toBe('operations.shipment.pickupUndone');
    expect(OperationsEvents.VaultReceiptCancelled).toBe('operations.custody.receiptCancelled');
    const payload = { shipmentId: oid(1), shipmentType: 'secured', status: 'draft' };
    expect(OperationsShipmentPickupPayloadV1.safeParse({ ...payload, by: 'captain' }).success).toBe(
      true,
    );
    expect(
      OperationsShipmentPickupPayloadV1.safeParse({ ...payload, by: 'operations' }).success,
    ).toBe(true);
    expect(OperationsShipmentPickupPayloadV1.safeParse(payload).success).toBe(false);
    expect(OperationsShipmentPickupPayloadV1.safeParse({ ...payload, by: 'vault' }).success).toBe(
      false,
    );
  });
});

// Round 18 — the legacy «إستلام محصنة» form: «انا مش عاوز اى اسماء ومش عاوز اى خانة من الخانات دى اجبارى
// كله اختيارى».
describe('the vault receive form — every field optional, no names', () => {
  it('receives with the version alone, everything else defaulted', () => {
    expect(ReceiveIntoVaultSchema.parse({ version: 4 })).toEqual({
      receiptNumber: null,
      bagCount: 0,
      cartonCount: 0,
      boxCount: 0,
      bagSealsPerBag: 2,
      bagSeals: [],
      boxSeals: [],
      denominations: [],
      version: 4,
    });
    expect(ReceiveIntoVaultSchema.safeParse({}).success).toBe(false);
  });

  it('trims the receipt number, and a blank one is none', () => {
    const number = (receiptNumber: unknown) =>
      ReceiveIntoVaultSchema.parse({ receiptNumber, version: 0 }).receiptNumber;
    expect(number('  R-1 ')).toBe('R-1');
    expect(number('')).toBeNull();
    expect(number('   ')).toBeNull();
    expect(number(null)).toBeNull();
    expect(number(undefined)).toBeNull();
  });

  it('asks for no treasurer — naming one is an unknown field', () => {
    const oneId = oid(1);
    expect(
      ReceiveIntoVaultSchema.safeParse({ version: 0, receivedByPrimaryId: oneId }).success,
    ).toBe(false);
    expect(
      ReceiveIntoVaultSchema.safeParse({ version: 0, receivedBySecondaryId: oneId }).success,
    ).toBe(false);
  });

  it('keeps the seals as typed, trimmed, with the blank boxes dropped — no length tied to a count', () => {
    const parsed = ReceiveIntoVaultSchema.parse({
      bagCount: 2,
      bagSealsPerBag: 3,
      bagSeals: [' 1 ', '', '2', '  '],
      boxSeals: ['6', '7', '8'],
      version: 0,
    });
    expect(parsed.bagSeals).toEqual(['1', '2']);
    expect(parsed.boxSeals).toEqual(['6', '7', '8']);
    expect(parsed.bagSealsPerBag).toBe(3);
    expect(ReceiveIntoVaultSchema.safeParse({ bagSealsPerBag: 4, version: 0 }).success).toBe(false);
    expect(ReceiveIntoVaultSchema.safeParse({ bagSealsPerBag: 1, version: 0 }).success).toBe(false);
  });

  it('counts notes of the legacy form\'s denominations only, each once, a count of 0 accepted', () => {
    expect(OPERATIONS_VAULT_DENOMINATIONS).toEqual([0.25, 0.5, 1, 5, 10, 20, 50, 100, 200]);
    const counts = (denominations: unknown) =>
      ReceiveIntoVaultSchema.safeParse({ denominations, version: 0 }).success;
    expect(
      counts(OPERATIONS_VAULT_DENOMINATIONS.map((value) => ({ value, count: 0 }))),
    ).toBe(true);
    expect(counts([{ value: 0.25, count: 40 }])).toBe(true);
    expect(counts([{ value: 3, count: 1 }])).toBe(false);
    expect(counts([{ value: 0.75, count: 1 }])).toBe(false);
    expect(
      counts([
        { value: 200, count: 1 },
        { value: 200, count: 1 },
      ]),
    ).toBe(false);
    expect(counts([{ value: 100, count: -1 }])).toBe(false);
    expect(counts([{ value: 100, count: 2.5 }])).toBe(false);
    expect(counts([{ value: 100 }])).toBe(false);
    expect(counts([{ value: 100, count: 1, extra: true }])).toBe(false);
  });

  it('carries the shipment corrections in the edit form\'s own shape — less the version and «سيريال»', () => {
    const patch = (shipment: unknown) =>
      ReceiveIntoVaultSchema.safeParse({ shipment, version: 0 }).success;
    expect(patch({ notes: 'صحيح', destinationBranchId: oid(2) })).toBe(true);
    expect(patch({})).toBe(true);
    expect(patch({ version: 1 })).toBe(false);
    expect(patch({ serialTracked: true })).toBe(false);
    expect(patch({ shipmentType: 'daily' })).toBe(false);
    expect(patch({ lines: [] })).toBe(false);
    expect(patch({ destinationBranchId: 'not-an-id' })).toBe(false);
    // Every other field of the edit form is a correction the vault may make.
    const editFields = Object.keys(UpdateOperationsShipmentSchema.shape).filter(
      (key) => key !== 'version' && key !== 'serialTracked',
    );
    expect(Object.keys(ReceiveIntoVaultShipmentPatchSchema.shape).sort()).toEqual(
      editFields.sort(),
    );
    // «سيريال» is the receipt's own field.
    expect(ReceiveIntoVaultSchema.parse({ serialTracked: true, version: 0 }).serialTracked).toBe(
      true,
    );
  });
});

// Round 21 — «مينفعش يكون فيه رقم للحقائب و الصناديق زى بعض برضو»: within ONE receipt a seal number
// appears once, across the bags and the boxes together — a refusal, not a warning.
describe('the vault receipt — one seal, once per receipt', () => {
  const receipt = (bagSeals: unknown[], boxSeals: unknown[] = []) =>
    ReceiveIntoVaultSchema.safeParse({ bagSeals, boxSeals, version: 0 });
  /** Where each refused seal stands, and what its message says. */
  const refusals = (bagSeals: unknown[], boxSeals: unknown[] = []) => {
    const result = receipt(bagSeals, boxSeals);
    return result.success
      ? []
      : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  };

  it('defines the same seal once: whole numbers for digits (leading zeros, Arabic-Indic), text as typed', () => {
    expect(vaultSealKey('99')).toBe('99');
    expect(vaultSealKey('0099')).toBe('99');
    expect(vaultSealKey(' 0099 ')).toBe('99');
    expect(vaultSealKey('٩٩')).toBe('99');
    expect(vaultSealKey('۰۰۹۹')).toBe('99');
    expect(vaultSealKey('0')).toBe('0');
    expect(vaultSealKey('000')).toBe('0');
    // A barcode longer than a JavaScript number is exact still compares exactly.
    expect(vaultSealKey('000123456789012345678901')).toBe('123456789012345678901');
    expect(vaultSealKey('123456789012345678901')).not.toBe(vaultSealKey('123456789012345678902'));
    // Text: trimmed, otherwise exactly as typed — no case folded, no digit folded inside it.
    expect(vaultSealKey(' AB-12 ')).toBe('AB-12');
    expect(vaultSealKey('ab-12')).not.toBe(vaultSealKey('AB-12'));
    expect(vaultSealKey('AB0012')).not.toBe(vaultSealKey('AB12'));
    // A text seal never reads as a number's key.
    expect(vaultSealKey('12a')).not.toBe(vaultSealKey('12'));
    expect(vaultSealKey('')).toBeNull();
    expect(vaultSealKey('   ')).toBeNull();
    // What cannot be seen is not read: a right-to-left mark (U+200F), a left-to-right mark
    // (U+200E), a zero-width space (U+200B) or an Arabic letter mark (U+061C) copied in with a
    // number leaves it the number the clerk sees.
    expect(vaultSealKey('‏12')).toBe('12');
    expect(vaultSealKey('12‎')).toBe('12');
    expect(vaultSealKey('​0012')).toBe('12');
    expect(vaultSealKey('؜١٢')).toBe('12');
    expect(vaultSealKey('AB‏-1')).toBe('AB-1');
    expect(vaultSealKey('‏')).toBeNull();
  });

  it('refuses the owner\'s case — a bag seal that is also a box seal — on the box, naming the bag', () => {
    const issues = refusals(['1', '2', '3', '4', '5', '6'], ['1', '3']);
    expect(issues).toEqual([
      { path: ['boxSeals', 0], message: expect.stringContaining('"1"') as string },
      { path: ['boxSeals', 1], message: expect.stringContaining('"3"') as string },
    ]);
    expect(issues[0]?.message).toContain('bagSeals.0');
    expect(issues[1]?.message).toContain('bagSeals.2');
  });

  it('reads 0099 and 99 as one seal, and an Arabic-Indic number as its ASCII twin', () => {
    expect(refusals(['0099'], ['99'])).toEqual([
      { path: ['boxSeals', 0], message: expect.stringContaining('bagSeals.0') as string },
    ]);
    expect(refusals(['١٢'], ['12'])).toEqual([
      { path: ['boxSeals', 0], message: expect.stringContaining('bagSeals.0') as string },
    ]);
    expect(refusals(['۰۷'], ['7'])).toHaveLength(1);
    // A number pasted with an invisible right-to-left mark is still the number on screen.
    expect(refusals(['12'], ['‏12'])).toEqual([
      { path: ['boxSeals', 0], message: expect.stringContaining('bagSeals.0') as string },
    ]);
  });

  it('refuses a seal typed twice inside the bags, or inside the boxes — on the later one', () => {
    expect(refusals(['5', '6', '5'])).toEqual([
      { path: ['bagSeals', 2], message: expect.stringContaining('bagSeals.0') as string },
    ]);
    expect(refusals([], ['8', '08'])).toEqual([
      { path: ['boxSeals', 1], message: expect.stringContaining('boxSeals.0') as string },
    ]);
    // Three times: refused twice, each later one naming the first.
    expect(refusals(['4', '4'], ['4']).map((issue) => issue.path)).toEqual([
      ['bagSeals', 1],
      ['boxSeals', 0],
    ]);
  });

  it('compares a text seal as typed, trimmed', () => {
    expect(refusals(['AB-1'], [' AB-1 '])).toHaveLength(1);
    expect(refusals(['AB-1'], ['ab-1']).length).toBe(0);
    expect(receipt(['AB-1'], ['AB-2']).success).toBe(true);
  });

  it('ignores the blank boxes — and names a repeat at the index the client sent it', () => {
    expect(receipt(['', '  ', '1'], ['', '2', '']).success).toBe(true);
    expect(refusals(['1', '', '  '], ['', '', '1'])).toEqual([
      { path: ['boxSeals', 2], message: expect.stringContaining('bagSeals.0') as string },
    ]);
    // And the blanks are still dropped from what is stored.
    const parsed = ReceiveIntoVaultSchema.parse({
      bagSeals: ['', '1', ' '],
      boxSeals: [' 2 ', ''],
      version: 0,
    });
    expect(parsed.bagSeals).toEqual(['1']);
    expect(parsed.boxSeals).toEqual(['2']);
  });

  it('takes distinct seals as they are — bags and boxes, numbers and text', () => {
    const parsed = receipt(['1', '2', '3', '4', '5', '6'], ['7', '8', 'X-9', '010']);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.boxSeals).toEqual(['7', '8', 'X-9', '010']);
    // Neighbours are not repeats: 0099 and 0100 are two seals.
    expect(receipt(['0099'], ['0100']).success).toBe(true);
  });
});

// Round 21b — «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى»: the receive form
// asks which of its seals the vault still holds on another محصنة. The rule itself is the server's
// (integration tests); this pins what the check takes.
describe('the vault seal check — what it takes', () => {
  it('takes the seals trimmed, and the shipment being received to leave out', () => {
    expect(
      CheckVaultSealsSchema.parse({ seals: [' 7 ', '', '0099'], excludeShipmentId: oid(4) }),
    ).toEqual({ seals: ['7', '', '0099'], excludeShipmentId: oid(4) });
    expect(CheckVaultSealsSchema.parse({ seals: [] })).toEqual({ seals: [] });
  });

  it('refuses what is not a list of seals, a shipment id that is not one, and anything more', () => {
    expect(CheckVaultSealsSchema.safeParse({}).success).toBe(false);
    expect(CheckVaultSealsSchema.safeParse({ seals: [7] }).success).toBe(false);
    expect(CheckVaultSealsSchema.safeParse({ seals: [], excludeShipmentId: 'x' }).success).toBe(
      false,
    );
    expect(CheckVaultSealsSchema.safeParse({ seals: [], version: 0 }).success).toBe(false);
  });

  it('asks about two lists of seals at most — the receipt\'s own ceiling, 500 each', () => {
    expect(OPERATIONS_VAULT_SEAL_CHECK_MAX).toBe(1000);
    const seals = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
    expect(CheckVaultSealsSchema.safeParse({ seals: seals(1000) }).success).toBe(true);
    expect(CheckVaultSealsSchema.safeParse({ seals: seals(1001) }).success).toBe(false);
  });
});

describe('operations shipments history query — whole days, both ends inclusive', () => {
  const ok = (from: string, to: string): boolean =>
    OperationsShipmentHistoryQuerySchema.safeParse({ from, to }).success;
  const day = (offset: number): string => {
    const d = new Date(Date.UTC(2025, 7, 1));
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  it(`serves ${String(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS)} days counting both ends, and refuses one more`, () => {
    expect(ok(day(0), day(0))).toBe(true);
    expect(ok(day(0), day(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS - 1))).toBe(true);
    expect(ok(day(0), day(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS))).toBe(false);
    expect(ok(day(1), day(0))).toBe(false);
  });

  // The server serves whole UTC days, so both rules are judged on the days the two values resolve
  // to — a time of day on either end must neither make one day look backwards nor slip an extra
  // day past the cap.
  it('judges the days the values resolve to, not the instants sent', () => {
    expect(ok(`${day(0)}T18:00:00.000Z`, `${day(0)}T06:00:00.000Z`)).toBe(true);
    expect(ok(`${day(1)}T01:00:00.000Z`, `${day(0)}T23:00:00.000Z`)).toBe(false);
    // 367 resolved days (day 0 .. day 366), sent as two times a couple of hours apart from 366 days.
    expect(
      ok(`${day(0)}T23:00:00.000Z`, `${day(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS)}T01:00:00.000Z`),
    ).toBe(false);
    expect(
      ok(
        `${day(0)}T01:00:00.000Z`,
        `${day(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS - 1)}T23:00:00.000Z`,
      ),
    ).toBe(true);
  });

  it('needs both ends, and nothing else', () => {
    expect(OperationsShipmentHistoryQuerySchema.safeParse({ from: day(0) }).success).toBe(false);
    expect(
      OperationsShipmentHistoryQuerySchema.safeParse({ from: day(0), to: day(0), status: 'draft' })
        .success,
    ).toBe(false);
    expect(ok('not-a-day', day(0))).toBe(false);
  });
});

// The action log's vocabulary is read by a screen that labels every member, so the lists are pinned
// as data: a member renamed or dropped here would leave a log line the screen cannot name.
describe('operations shipment log vocabulary — closed lists a screen can label', () => {
  it('names every kind once, and keeps the generic `other` for acts not named yet', () => {
    expect(new Set(OPERATIONS_SHIPMENT_LOG_KINDS).size).toBe(OPERATIONS_SHIPMENT_LOG_KINDS.length);
    expect(OPERATIONS_SHIPMENT_LOG_KINDS).toEqual(
      expect.arrayContaining([
        'created',
        'edited',
        'deleted',
        'restored',
        'received',
        'receiveUndone',
        'receiptImageAdded',
        'receiptImageRemoved',
        'crewAssigned',
        'crewChanged',
        'executionStarted',
        'executionDelivered',
        'vaultReceived',
        'dispatched',
        'pickupConfirmed',
        'pickupUndone',
        'receiptCancelled',
        'other',
      ]),
    );
  });

  it('names every field once, never an id, and the yes/no fields are fields of the list', () => {
    expect(new Set(OPERATIONS_SHIPMENT_LOG_FIELDS).size).toBe(
      OPERATIONS_SHIPMENT_LOG_FIELDS.length,
    );
    // Values are display values — a field named after an id would invite sending one.
    expect(OPERATIONS_SHIPMENT_LOG_FIELDS.filter((field) => /Id$/.test(field))).toEqual([]);
    for (const field of [
      ...OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS,
      ...OPERATIONS_SHIPMENT_LOG_PICKED_UP_BY_FIELDS,
    ]) {
      expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toContain(field);
    }
    // Round 10 — who confirmed the pickup is a code the screen labels, and the cancel's reason.
    expect(OPERATIONS_SHIPMENT_LOG_PICKED_UP_BY_FIELDS).toEqual(['pickedUpBy']);
    expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toEqual(expect.arrayContaining(['pickedUpBy', 'reason']));
    // Round 18 — the receive form's «2×» / «3×» and «عدد الورق من كل فئة».
    expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toEqual(
      expect.arrayContaining(['bagSealsPerBag', 'denominations']),
    );
    expect(OPERATIONS_SHIPMENT_LOG_MAX_ENTRIES).toBeGreaterThan(0);
  });

  it("the deleted list takes the history's range, with the history's rules", () => {
    expect(OperationsDeletedShipmentsQuerySchema).toBe(OperationsShipmentHistoryQuerySchema);
    expect(
      OperationsDeletedShipmentsQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' })
        .success,
    ).toBe(false);
  });

  it('a restore is its own event, beside the delete it undoes', () => {
    expect(OperationsEvents.ShipmentRestored).toBe('operations.shipment.restored');
    expect(OperationsEvents.ShipmentRestored).not.toBe(OperationsEvents.ShipmentDeleted);
  });
});
