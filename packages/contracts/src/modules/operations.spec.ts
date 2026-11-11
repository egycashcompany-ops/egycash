// The Operations vocabulary guards — the facts a careless later slice would violate first.
//
// The single most dangerous misreading of the legacy system is treating `transactions.status` as
// an ordinal ladder: the literal 1 is TERMINAL (discovery §6). These tests pin the legacy mapping
// as a bijection with 1 = completed, so a "fix" that reorders it fails loudly here instead of
// silently corrupting migration or report parity in a later slice.
import { describe, expect, it } from 'vitest';
import {
  CREW_SLOT_CAPACITY,
  CreateOperationsBankBranchSchema,
  CreateOperationsCurrencySchema,
  CreateOperationsShipmentSchema,
  LEGACY_OPERATIONS_SHIPMENT_CODE_BY_STATUS,
  LEGACY_OPERATIONS_SHIPMENT_STATUS_BY_CODE,
  LEGACY_OPERATIONS_SHIPMENT_TYPE_LABELS,
  OPERATIONS_DAY_STATUSES,
  OPERATIONS_EXECUTION_STATUSES,
  OPERATIONS_PICKED_UP_EXECUTION_STATUSES,
  OPERATIONS_SECURED_STAGES,
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OPERATIONS_SHIPMENT_LEGS,
  OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS,
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
  OperationsShipmentStatusSchema,
  OperationsVaultQueueQuerySchema,
  OrderOperationsCurrenciesSchema,
  PlanOperationsCrewSchema,
  UpdateOperationsCurrencySchema,
  SetOperationsStandingCrewSchema,
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
    // Round 8 — the محصنة row's colour, derived on the server: white, yellow, green, out, done.
    expect(OPERATIONS_SECURED_STAGES).toEqual([
      'awaitingPickup',
      'withCaptain',
      'inVault',
      'dispatched',
      'completed',
    ]);
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
    for (const field of OPERATIONS_SHIPMENT_LOG_BOOLEAN_FIELDS) {
      expect(OPERATIONS_SHIPMENT_LOG_FIELDS).toContain(field);
    }
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
