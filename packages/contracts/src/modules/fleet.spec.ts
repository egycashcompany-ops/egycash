// The contracts encode the frozen design's load-bearing rules; these tests pin the ones whose
// loss would be silent — derived fields absent from inputs, the roster's per-day uniqueness, and
// the whole event surface being declared `planned` until a publisher exists.
import { describe, expect, it } from 'vitest';
import {
  ChangeFleetVehicleStatusSchema,
  fleetMonthWindow,
  FleetCustodyDashboardQuerySchema,
  FleetCustodySummaryQuerySchema,
  ListFleetCustodyMovementsQuerySchema,
  ListFleetReceiptsQuerySchema,
  CreateFleetReceiptSchema,
  UpdateFleetReceiptSchema,
  CreateFleetCatalogItemSchema,
  CreateFleetUnavailabilitySchema,
  FleetAccidentTransferInputSchema,
  FleetEvents,
  UpdateFleetAccidentSchema,
  fleetAccidentRemaining,
  ListFleetDriversQuerySchema,
  ListFleetVehiclesQuerySchema,
  MoveFleetViolationsSchema,
  PlanFleetRosterSchema,
  RecordFleetOdometerSchema,
  RecordFleetVehicleViolationSchema,
  SaveFleetFixedRosterSchema,
  CreateFleetCustodyChargeSchema,
  CreateFleetCustodyMemoSchema,
  CreateFleetCustodyReplenishmentSchema,
  CreateFleetCustodySettlementSchema,
  CancelFleetCustodyReplenishmentSchema,
  ConfirmFleetCustodyTransferSchema,
  DecideFleetFuelReconcileSchema,
  FLEET_CUSTODY_MEMO_MAX_LINES,
  FLEET_CUSTODY_MEMO_STATE_OF_STATUS,
  FLEET_CUSTODY_MEMO_STATES,
  FLEET_CUSTODY_MEMO_STATUSES,
  FLEET_CUSTODY_OPERATION_STATUSES,
  FLEET_FUEL_MOVEMENT_KINDS,
  FLEET_FUEL_RECONCILE_MAX_CARDS,
  FleetCustodyMemoStatusSchema,
  UploadFleetFuelSheetSchema,
  FLEET_CUSTODY_STALE_DAYS,
  FleetCustodyLedgerSummaryQuerySchema,
  FleetCustodyMemoStateSchema,
  FleetCustodyMemoCandidatesQuerySchema,
  FleetCustodyMemoSummaryQuerySchema,
  FleetLicenseExpenseSummaryQuerySchema,
  ListFleetCustodyLedgerQuerySchema,
  ListFleetCustodyMemosQuerySchema,
  ListFleetLicenseExpensesQuerySchema,
  UpdateFleetCustodyMemoSchema,
} from './fleet.js';
import { EVENT_LIFECYCLE, eventCatalogEntry } from '../events/catalog.js';

const oid = (suffix: string) => suffix.padStart(24, '0');

describe('fleet contracts', () => {
  it('odometer recording accepts one reading and no derived fields (FR-2)', () => {
    const ok = RecordFleetOdometerSchema.safeParse({
      vehicleId: oid('1'),
      date: '2026-08-02',
      reading: 120500,
    });
    expect(ok.success).toBe(true);
    // km and inReading are server-derived; a client supplying them is a client we refuse.
    expect(
      RecordFleetOdometerSchema.safeParse({
        vehicleId: oid('1'),
        date: '2026-08-02',
        reading: 120500,
        km: 40,
      }).success,
    ).toBe(false);
  });

  it('vehicle violations carry no client-supplied amount (FR-9)', () => {
    expect(
      RecordFleetVehicleViolationSchema.safeParse({
        vehicleId: oid('1'),
        year: 2026,
        violationTypeId: oid('2'),
        count: 3,
        unitValue: 200,
        amount: 600,
      }).success,
    ).toBe(false);
  });

  it('roster plan refuses a driver holding two assignments in one day (FR-7)', () => {
    const result = PlanFleetRosterSchema.safeParse({
      date: '2026-08-03',
      rows: [
        { vehicleId: oid('1'), driver1EmployeeId: oid('a') },
        { vehicleId: oid('2'), driver1EmployeeId: oid('a') },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('roster plan refuses the same person in both slots of one vehicle', () => {
    expect(
      PlanFleetRosterSchema.safeParse({
        date: '2026-08-03',
        rows: [{ vehicleId: oid('1'), driver1EmployeeId: oid('a'), driver2EmployeeId: oid('a') }],
      }).success,
    ).toBe(false);
  });

  // ── the daily plan's id SPELLING ────────────────────────────────────────
  //
  // An ObjectId is a number written in hex. `objectId()` accepts `[0-9a-fA-F]`, and
  // `new Types.ObjectId('AB…')` is the very same id as `new Types.ObjectId('ab…')` — but the two
  // duplicate checks above compare RAW STRINGS, and every key the service builds from a document
  // is `String(doc.field)`, which mongo always renders lowercase. So one vehicle spelled two ways
  // is two vehicles to a `Set`, and a payload id spelled in uppercase misses every map built from
  // the database: the existing-assignment lookup, the FR-5 workshop guard and the FR-7 occupancy
  // check all answer as though the row were not there.

  describe('PlanFleetRosterSchema — id spelling', () => {
    const V = '64b1f0abcdefabcdefabcdef';
    const V2 = '64b1f0abcdefabcdefabcd02';
    const D = '64b1f0abcdefabcdefabcd01';

    it('accepts either spelling and answers with the canonical one', () => {
      const parsed = PlanFleetRosterSchema.parse({
        date: '2026-08-03',
        rows: [
          {
            vehicleId: V.toUpperCase(),
            driver1EmployeeId: D.toUpperCase(),
            missionTypeId: V2.toUpperCase(),
          },
        ],
      });
      expect(parsed.rows[0]?.vehicleId).toBe(V);
      expect(parsed.rows[0]?.driver1EmployeeId).toBe(D);
      expect(parsed.rows[0]?.missionTypeId).toBe(V2);
    });

    it('sees ONE vehicle when a payload spells it two ways', () => {
      expect(
        PlanFleetRosterSchema.safeParse({
          date: '2026-08-03',
          rows: [{ vehicleId: V }, { vehicleId: V.toUpperCase() }],
        }).success,
      ).toBe(false);
    });

    it('sees ONE driver when two rows spell them differently (FR-7)', () => {
      expect(
        PlanFleetRosterSchema.safeParse({
          date: '2026-08-03',
          rows: [
            { vehicleId: V, driver1EmployeeId: D },
            { vehicleId: V2, driver1EmployeeId: D.toUpperCase() },
          ],
        }).success,
      ).toBe(false);
    });

    it('sees ONE person when the two slots of a row spell them differently', () => {
      expect(
        PlanFleetRosterSchema.safeParse({
          date: '2026-08-03',
          rows: [{ vehicleId: V, driver1EmployeeId: D, driver2EmployeeId: D.toUpperCase() }],
        }).success,
      ).toBe(false);
    });

    it('still refuses something that is not an id, and still accepts an ordinary one', () => {
      expect(
        PlanFleetRosterSchema.safeParse({ date: '2026-08-03', rows: [{ vehicleId: 'nope' }] })
          .success,
      ).toBe(false);
      const ok = PlanFleetRosterSchema.parse({
        date: '2026-08-03',
        rows: [{ vehicleId: V, driver1EmployeeId: D }],
      });
      expect(ok.rows[0]?.vehicleId).toBe(V);
      expect(ok.rows[0]?.driver1EmployeeId).toBe(D);
    });
  });

  it('leaving active service requires a reason (§4.1)', () => {
    expect(
      ChangeFleetVehicleStatusSchema.safeParse({ status: 'outOfService', version: 1 }).success,
    ).toBe(false);
    expect(
      ChangeFleetVehicleStatusSchema.safeParse({
        status: 'outOfService',
        reason: 'مسحوبة للفحص الفني',
        version: 1,
      }).success,
    ).toBe(true);
  });

  it('countsForAlarm is a workType-only fact', () => {
    expect(
      CreateFleetCatalogItemSchema.safeParse({
        kind: 'workshop',
        name: { ar: 'ورشة', en: 'Workshop' },
        countsForAlarm: true,
      }).success,
    ).toBe(false);
  });

  it('unavailability cannot end before it starts', () => {
    expect(
      CreateFleetUnavailabilitySchema.safeParse({
        employeeId: oid('a'),
        from: '2026-08-05',
        to: '2026-08-04',
        reason: 'مأمورية',
      }).success,
    ).toBe(false);
  });

  it('every fleet event is catalogued; unpublished ones are planned, published ones stable', () => {
    // Promoted by the slices that added their emit sites (FL-2 vehicles, FL-3 availability).
    // The apps/api publisher test enforces this from the real source; this only pins the intent.
    const stable = new Set<string>([
      FleetEvents.VehicleCreated,
      FleetEvents.VehicleUpdated,
      FleetEvents.VehicleStatusChanged,
      // Catalogs slice — both published by the vehicle service at its commit points.
      FleetEvents.VehicleLicenseImageUploaded,
      FleetEvents.VehicleLicenseImageDeleted,
      // Drivers slice — both published by the driver-profile service at its commit points.
      FleetEvents.DriverLicenseImageUploaded,
      FleetEvents.DriverLicenseImageDeleted,
      FleetEvents.UnavailabilityRecorded,
      FleetEvents.UnavailabilityEnded,
      FleetEvents.OdometerRecorded,
      FleetEvents.OdometerCorrected,
      FleetEvents.MaintenanceCheckedIn,
      FleetEvents.MaintenanceCheckedOut,
      FleetEvents.MaintenanceReopened,
      FleetEvents.MaintenanceAlarmRaised,
      FleetEvents.VehicleLicenseExpiring,
      FleetEvents.VehicleLicenseExpired,
      FleetEvents.DriverLicenseExpiring,
      FleetEvents.DriverLicenseExpired,
      FleetEvents.RosterPlanned,
      FleetEvents.AssignmentChanged,
      FleetEvents.AccidentRecorded,
      FleetEvents.AccidentClosed,
      FleetEvents.AccidentReopened,
      FleetEvents.ViolationRecorded,
      FleetEvents.GrievanceApplied,
    ]);
    for (const name of Object.values(FleetEvents)) {
      expect(eventCatalogEntry(name), `${name} is not catalogued`).toBeDefined();
      const expected = stable.has(name) ? undefined : 'planned';
      expect(EVENT_LIFECYCLE[name]?.status, name).toBe(expected);
    }
  });
});

// The shared `listQuery` helper gained a `max` parameter for the drivers' `employeeIds`. These pin
// that a REAL existing caller — one that passes only the item schema — kept the old cap, so the
// widening cannot have leaked sideways into another endpoint's filter.
describe('the multi-value filters kept their caps', () => {
  const ids = (n: number): string =>
    Array.from({ length: n }, (_, i) => `64b1f0dddddddddddd${String(i).padStart(6, '0')}`).join(
      ',',
    );

  it('the vehicle registry still caps branchId at 50 — the default, untouched', () => {
    expect(ListFleetVehiclesQuerySchema.parse({ branchId: ids(50) }).branchId).toHaveLength(50);
    expect(() => ListFleetVehiclesQuerySchema.parse({ branchId: ids(51) })).toThrow();
  });

  it('only the drivers list carries the wider cap, and it is exactly one page', () => {
    expect(ListFleetDriversQuerySchema.parse({ employeeIds: ids(100) }).employeeIds).toHaveLength(
      100,
    );
    expect(() => ListFleetDriversQuerySchema.parse({ employeeIds: ids(101) })).toThrow();
  });

  it('employeeIds is a DRIVERS filter — the vehicle registry does not accept it', () => {
    expect(() => ListFleetVehiclesQuerySchema.parse({ employeeIds: ids(1) })).toThrow();
  });
});

// ── Fixed crew: an ObjectId is a NUMBER written in hex, not a piece of text ──
//
// `objectId()` accepts `[0-9a-fA-F]`, and `new Types.ObjectId('AB…')` is the very same id as
// `new Types.ObjectId('ab…')`. Everything downstream keys maps by `String(doc.field)`, which is
// always lowercase — so a payload carrying the uppercase spelling looks like a DIFFERENT vehicle
// to every string comparison while being the same row to mongo. The schema settles the spelling
// once, at the boundary, so no comparison further in can be fooled by it.

describe('SaveFleetFixedRosterSchema — id spelling', () => {
  const LOWER = '64b1f0abcdefabcdefabcdef';
  const UPPER = LOWER.toUpperCase();
  const OTHER = '64b1f0abcdefabcdefabcd01';

  it('accepts either spelling and answers with the canonical one', () => {
    const parsed = SaveFleetFixedRosterSchema.parse({
      rows: [{ vehicleId: UPPER, driver1EmployeeId: UPPER, driver2EmployeeId: OTHER }],
    });
    expect(parsed.rows[0]?.vehicleId).toBe(LOWER);
    expect(parsed.rows[0]?.driver1EmployeeId).toBe(LOWER);
  });

  it('sees ONE vehicle when a payload spells it two ways', () => {
    // Without normalization this passes the duplicate check, and the service then takes the
    // CREATE branch for a vehicle that already has a crew row — a second, invisible row.
    const twice = SaveFleetFixedRosterSchema.safeParse({
      rows: [{ vehicleId: LOWER }, { vehicleId: UPPER }],
    });
    expect(twice.success, 'a vehicle spelled twice is still a vehicle twice').toBe(false);
  });

  it('sees ONE driver when a payload spells them two ways', () => {
    const twice = SaveFleetFixedRosterSchema.safeParse({
      rows: [
        { vehicleId: LOWER, driver1EmployeeId: LOWER },
        { vehicleId: OTHER, driver1EmployeeId: UPPER },
      ],
    });
    expect(twice.success, 'one driver belongs to one crew, however it is spelled').toBe(false);
  });

  it('sees ONE person when the two slots of a row spell them differently', () => {
    const bothSlots = SaveFleetFixedRosterSchema.safeParse({
      rows: [{ vehicleId: OTHER, driver1EmployeeId: LOWER, driver2EmployeeId: UPPER }],
    });
    expect(bothSlots.success).toBe(false);
  });

  it('still refuses something that is not an id at all', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: 'not-an-id' }] }).success,
    ).toBe(false);
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: `${LOWER}zz` }] }).success,
    ).toBe(false);
  });
});

// ── Fixed crew: the mission type and the note ──────────────────────────────
//
// Both were added after the collection shipped, so the shape has to stay valid for a row that
// has neither — an existing crew must not become unsaveable because two fields appeared. The
// same is true of the RENAME: rows written while the field was called `workTypeId` no longer
// carry a mission type at all, and must still parse.

describe('SaveFleetFixedRosterSchema — mission type and notes', () => {
  const V = '64b1f0abcdefabcdefabcdef';
  const MT = '64b1f0abcdefabcdefabcd77';

  it('still accepts a row that carries neither', () => {
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V }] }).success).toBe(true);
  });

  it('accepts both, and canonicalizes the mission type like every other id', () => {
    const parsed = SaveFleetFixedRosterSchema.parse({
      rows: [{ vehicleId: V, missionTypeId: MT.toUpperCase(), notes: 'من المخزن' }],
    });
    expect(parsed.rows[0]?.missionTypeId).toBe(MT);
    expect(parsed.rows[0]?.notes).toBe('من المخزن');
  });

  it('refuses a mission type that is not an id at all', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, missionTypeId: 'general' }] })
        .success,
      'the LABEL is not the reference — ids are',
    ).toBe(false);
  });

  it('refuses the RETIRED field name outright — `.strict()` is what makes the rename real', () => {
    // A client still sending `workTypeId` is sending a maintenance reference for a mission slot.
    // Silently ignoring it would let that client believe it had saved something; the schema is
    // `.strict()`, so it is refused instead.
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, workTypeId: MT }] }).success,
    ).toBe(false);
  });

  it('trims a note, and refuses one that is only whitespace', () => {
    expect(
      SaveFleetFixedRosterSchema.parse({ rows: [{ vehicleId: V, notes: '  x  ' }] }).rows[0]?.notes,
    ).toBe('x');
    // '' after trimming is nothing, and nothing is spelled `null` — never an empty string, or
    // "cleared" and "never written" would become two different values in the same column.
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, notes: '   ' }] }).success,
    ).toBe(false);
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, notes: '' }] }).success,
    ).toBe(false);
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, notes: null }] }).success,
    ).toBe(true);
  });

  it('caps a note at 500 characters', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, notes: 'ن'.repeat(500) }] })
        .success,
    ).toBe(true);
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, notes: 'ن'.repeat(501) }] })
        .success,
    ).toBe(false);
  });

  it('still refuses an unknown field — the row is not an open bag', () => {
    // This used to use `missionTypeId` as the foreign field, because the fixed crew's own slot
    // was called `workTypeId`. That is now this row's OWN field, so the sentinel moves to the
    // one thing §2.7b says a fixed crew can never carry: a date. The claim is unchanged — the
    // row is `.strict()`, and the daily board's identity must not leak into a dateless one.
    expect(
      SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V, date: '2026-08-26' }] })
        .success,
      'the daily board’s date must not be accepted here',
    ).toBe(false);
  });
});

// ── a second driver needs a first ──────────────────────────────────────────
//
// The slots are ORDERED, not interchangeable: slot 1 is the crew's driver, slot 2 is the second
// man beside them. A row holding only a second driver reads as a crewless car on every screen
// that shows "the driver", while a real person is committed to it. The board refuses to propose
// the state and the service refuses to store it; this is the boundary that makes it unwritable
// by anything at all — an import, an API client, or a screen nobody has written yet.

describe('SaveFleetFixedRosterSchema — driver 2 depends on driver 1', () => {
  const V1 = '64b1f0abcdefabcdefabcdef';
  const D1 = '64b1f0abcdefabcdefabcd01';
  const D2 = '64b1f0abcdefabcdefabcd02';

  it('REFUSES a second driver with no first', () => {
    const bad = SaveFleetFixedRosterSchema.safeParse({
      rows: [{ vehicleId: V1, driver2EmployeeId: D2 }],
    });
    expect(bad.success, 'a crew whose only member sits in seat two').toBe(false);
    expect(JSON.stringify(bad.error?.issues), 'and says which field is wrong').toContain(
      'driver2EmployeeId',
    );
  });

  it('refuses it when driver 1 is spelled as an explicit null', () => {
    // `nullish()` accepts both an absent field and an explicit null; the rule must not care.
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: V1, driver1EmployeeId: null, driver2EmployeeId: D2 }],
      }).success,
    ).toBe(false);
  });

  it('ACCEPTS the pair when the first driver is there', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: V1, driver1EmployeeId: D1, driver2EmployeeId: D2 }],
      }).success,
    ).toBe(true);
  });

  it('accepts a lone FIRST driver — one is a crew, two is a crew, second-only is not', () => {
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: V1, driver1EmployeeId: D1 }],
      }).success,
    ).toBe(true);
  });

  it('accepts a row with no drivers at all — clearing a crew stays legal', () => {
    // The rule is about ORDER, not about presence. Emptying a vehicle must remain expressible,
    // or a crew could be created and never removed.
    expect(SaveFleetFixedRosterSchema.safeParse({ rows: [{ vehicleId: V1 }] }).success).toBe(true);
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [{ vehicleId: V1, driver1EmployeeId: null, driver2EmployeeId: null }],
      }).success,
    ).toBe(true);
  });

  it('refuses the bad row even when a GOOD row travels beside it', () => {
    // Saves are batched — a drag sends both sides of a move. One invalid row must fail the
    // payload rather than being quietly dropped from it.
    expect(
      SaveFleetFixedRosterSchema.safeParse({
        rows: [
          { vehicleId: V1, driver1EmployeeId: D1 },
          { vehicleId: '64b1f0abcdefabcdefabcd03', driver2EmployeeId: D2 },
        ],
      }).success,
    ).toBe(false);
  });

  it('now binds the DAILY plan too — the record Operations actually reads', () => {
    // This was deliberately scoped to the standing crew at first, with a test asserting the
    // daily board still accepted the pair, so that extending it would be a decision somebody
    // made on purpose. That decision is made: `operations/crew-board` reads the DUTY row's slot
    // 1 as "the driver" of the day, so leaving the rule on the fixed crew alone meant the record
    // it protects could still be created one day at a time.
    expect(
      PlanFleetRosterSchema.safeParse({
        date: '2099-01-01',
        rows: [{ vehicleId: V1, driver2EmployeeId: D2 }],
      }).success,
      'a second driver with no first',
    ).toBe(false);
    expect(
      PlanFleetRosterSchema.safeParse({
        date: '2099-01-01',
        rows: [{ vehicleId: V1, driver1EmployeeId: D1 }],
      }).success,
      'driver 1 alone',
    ).toBe(true);
    expect(
      PlanFleetRosterSchema.safeParse({
        date: '2099-01-01',
        rows: [{ vehicleId: V1, driver1EmployeeId: D1, driver2EmployeeId: D2 }],
      }).success,
      'driver 1 and driver 2',
    ).toBe(true);
    expect(
      PlanFleetRosterSchema.safeParse({
        date: '2099-01-01',
        rows: [{ vehicleId: V1 }],
      }).success,
      'and an empty row stays legal, so clearing a day remains expressible',
    ).toBe(true);
  });
});

describe('carrying a fine onto another car, and the way back', () => {
  const IDS = ['650000000000000000000031'];
  const CAR = '650000000000000000000151';

  it('a CARRY names the car whose block the fines go onto', () => {
    expect(
      MoveFleetViolationsSchema.safeParse({ ids: IDS, vehicleId: CAR, filedYear: 2026 }).success,
    ).toBe(true);
    expect(
      MoveFleetViolationsSchema.safeParse({ ids: IDS, filedYear: 2026 }).success,
      'and a carry with no car has nowhere to go',
    ).toBe(false);
  });

  it('a RETURN names none — each fine goes back to the car it came from', () => {
    expect(MoveFleetViolationsSchema.safeParse({ ids: IDS, filedYear: null }).success).toBe(true);
    // REFUSED, not ignored. The only car a caller could name on a return is the one the fine is
    // sitting on NOW — which is exactly the defect: «بيخليها 151 زى ما هى». A field the server
    // quietly drops is a field that lies to whoever reads the request.
    expect(
      MoveFleetViolationsSchema.safeParse({ ids: IDS, vehicleId: CAR, filedYear: null }).success,
    ).toBe(false);
  });
});

describe('taking from another car’s remaining — the transfer input', () => {
  const car = oid('a1');
  const ok = (amount: number): boolean =>
    FleetAccidentTransferInputSchema.safeParse({ fromVehicleIds: [car], amount }).success;

  it('takes ordinary amounts to the piastre — including the ones binary floats cannot hold', () => {
    // 19.99 * 100 is 1998.9999999999998 and 1.1 * 100 is 110.00000000000001 in JavaScript; an
    // exact comparison refused both.
    for (const amount of [1.1, 19.99, 4.35, 2.3, 0.29, 0.01, 10.01, 1500, 3500.5]) {
      expect(ok(amount), String(amount)).toBe(true);
    }
  });

  it('refuses fractions of a piastre, zero and a negative amount', () => {
    for (const amount of [0.001, 19.995, 0, -5]) expect(ok(amount), String(amount)).toBe(false);
  });

  it('takes several cars, in the order picked, and refuses the same car twice', () => {
    const parse = (ids: string[]) =>
      FleetAccidentTransferInputSchema.safeParse({ fromVehicleIds: ids, amount: 10 });
    const picked = parse([oid('b2'), car]);
    expect(picked.success && picked.data.fromVehicleIds).toEqual([oid('b2'), car]);
    expect(parse([car, car]).success).toBe(false);
    expect(parse([]).success).toBe(false);
  });

  it('refuses a car taking from itself when the edit names both', () => {
    const parsed = UpdateFleetAccidentSchema.safeParse({
      version: 0,
      vehicleId: car,
      transfer: { fromVehicleIds: [oid('b2'), car], amount: 10 },
    });
    expect(parsed.success).toBe(false);
  });

  it('counts what moved in and out in the file’s remaining', () => {
    expect(
      fleetAccidentRemaining({
        amountCollected: 1500,
        companyCost: 500,
        paidAmount: 1300,
        transferredIn: 1500,
        transferredOut: 200,
      }),
    ).toBe(2000);
    expect(
      fleetAccidentRemaining({ amountCollected: 1500, companyCost: 500, paidAmount: 1300 }),
    ).toBe(700);
  });
});

describe('a receipt — «ادخال كم (اختيارى عند كتابه مبلغ التفويل)»', () => {
  const fuel = {
    date: '2026-10-01',
    vehicleId: oid('1'),
    kind: 'fuel',
    cardId: oid('2'),
    fuelType: 'diesel',
    amount: 500,
  } as const;

  it('takes the odometer on fuel — a whole number from zero up, or none at all', () => {
    expect(CreateFleetReceiptSchema.parse({ ...fuel, odometer: 154320 }).odometer).toBe(154320);
    expect(CreateFleetReceiptSchema.parse({ ...fuel, odometer: 0 }).odometer).toBe(0);
    expect(CreateFleetReceiptSchema.parse({ ...fuel, odometer: null }).odometer).toBeNull();
    // Optional: a receipt with no «كم» is a whole receipt.
    expect(CreateFleetReceiptSchema.parse(fuel).odometer).toBeUndefined();
    for (const bad of [-1, 12.5, '154320', Number.NaN]) {
      expect(
        CreateFleetReceiptSchema.safeParse({ ...fuel, odometer: bad }).success,
        String(bad),
      ).toBe(false);
    }
  });

  it('refuses the odometer on tyres, washing and maintenance — they never reach a pump', () => {
    for (const kind of ['tyres', 'wash', 'maintenance'] as const) {
      const paper = { date: '2026-10-01', vehicleId: oid('1'), kind, amount: 120 };
      expect(CreateFleetReceiptSchema.safeParse({ ...paper, odometer: 1000 }).success).toBe(false);
      expect(CreateFleetReceiptSchema.safeParse({ ...paper, odometer: null }).success).toBe(true);
      expect(UpdateFleetReceiptSchema.safeParse({ kind, odometer: 1000, version: 0 }).success).toBe(
        false,
      );
    }
  });

  it('takes «صيانة» as tyres and washing are taken — from the fund, never off a card', () => {
    const paper = { date: '2026-10-01', vehicleId: oid('1'), kind: 'maintenance', amount: 750 };
    expect(CreateFleetReceiptSchema.parse(paper).kind).toBe('maintenance');
    expect(CreateFleetReceiptSchema.safeParse({ ...paper, cardId: oid('2') }).success).toBe(false);
    expect(CreateFleetReceiptSchema.safeParse({ ...paper, fuelType: 'diesel' }).success).toBe(
      false,
    );
    expect(UpdateFleetReceiptSchema.safeParse({ kind: 'maintenance', version: 0 }).success).toBe(
      true,
    );
  });

  it('an edit keeps the odometer when absent and clears it with null', () => {
    const keep = UpdateFleetReceiptSchema.parse({ kind: 'fuel', fuelType: 'diesel', version: 3 });
    expect('odometer' in keep).toBe(false);
    const clear = UpdateFleetReceiptSchema.parse({
      kind: 'fuel',
      fuelType: 'diesel',
      odometer: null,
      version: 3,
    });
    expect(clear.odometer).toBeNull();
  });

  it('defaults no fuel type — «سولار» is the form’s first choice, the API still asks for one', () => {
    expect(CreateFleetReceiptSchema.safeParse({ ...fuel, fuelType: undefined }).success).toBe(
      false,
    );
    expect(CreateFleetReceiptSchema.parse(fuel).fuelType).toBe('diesel');
  });

  it('takes any card id — whose car the card is on is the server’s to check, not the shape’s', () => {
    expect(CreateFleetReceiptSchema.safeParse({ ...fuel, cardId: oid('99') }).success).toBe(true);
    expect(CreateFleetReceiptSchema.safeParse({ ...fuel, cardId: 'c-1' }).success).toBe(false);
  });
});

describe('a custody fuel receipt’s «الشركة» — «ومش عاوز اى داتا اجبارى»', () => {
  const fund = {
    date: '2026-10-01',
    vehicleId: oid('1'),
    kind: 'fuel',
    fuelType: 'diesel',
    amount: 500,
  } as const;

  it('takes one of the fuel cards’ two companies on fuel from the fund — or none at all', () => {
    expect(CreateFleetReceiptSchema.parse({ ...fund, company: 'chillout' }).company).toBe(
      'chillout',
    );
    expect(CreateFleetReceiptSchema.parse({ ...fund, company: 'wataniya' }).company).toBe(
      'wataniya',
    );
    expect(CreateFleetReceiptSchema.parse({ ...fund, company: null }).company).toBeNull();
    // Never required: a receipt with no company is a whole receipt («بدون شركة»).
    expect(CreateFleetReceiptSchema.parse(fund).company).toBeUndefined();
    expect(CreateFleetReceiptSchema.safeParse({ ...fund, company: 'shell' }).success).toBe(false);
  });

  it('refuses it off a card — the card has its own — and on tyres, washing and maintenance', () => {
    expect(
      CreateFleetReceiptSchema.safeParse({ ...fund, cardId: oid('2'), company: 'chillout' })
        .success,
    ).toBe(false);
    expect(
      CreateFleetReceiptSchema.safeParse({ ...fund, cardId: oid('2'), company: null }).success,
    ).toBe(true);
    for (const kind of ['tyres', 'wash', 'maintenance'] as const) {
      const paper = { date: '2026-10-01', vehicleId: oid('1'), kind, amount: 120 };
      expect(CreateFleetReceiptSchema.safeParse({ ...paper, company: 'wataniya' }).success).toBe(
        false,
      );
      expect(CreateFleetReceiptSchema.safeParse({ ...paper, company: null }).success).toBe(true);
      expect(
        UpdateFleetReceiptSchema.safeParse({ kind, company: 'wataniya', version: 0 }).success,
      ).toBe(false);
    }
  });

  it('an edit keeps it when absent and clears it with null', () => {
    const keep = UpdateFleetReceiptSchema.parse({ kind: 'fuel', fuelType: 'diesel', version: 3 });
    expect('company' in keep).toBe(false);
    const clear = UpdateFleetReceiptSchema.parse({
      kind: 'fuel',
      fuelType: 'diesel',
      company: null,
      version: 3,
    });
    expect(clear.company).toBeNull();
  });
});

describe('receipt kinds and custody sources take several — «اختيار متعدد»', () => {
  it('a receipts filter reads one kind or several, and a saved one-kind link still reads', () => {
    expect(ListFleetReceiptsQuerySchema.parse({ kind: 'tyres,wash' }).kind).toEqual([
      'tyres',
      'wash',
    ]);
    expect(ListFleetReceiptsQuerySchema.parse({ kind: 'fuel' }).kind).toEqual(['fuel']);
    expect(ListFleetReceiptsQuerySchema.parse({ kind: '' }).kind).toBeUndefined();
    expect(ListFleetReceiptsQuerySchema.safeParse({ kind: 'fuel,petrol' }).success).toBe(false);
    expect(ListFleetReceiptsQuerySchema.parse({ kind: 'maintenance,wash' }).kind).toEqual([
      'maintenance',
      'wash',
    ]);
  });

  it('a custody filter reads one source or several', () => {
    expect(FleetCustodySummaryQuerySchema.parse({ source: 'maintenance,fuel' }).source).toEqual([
      'maintenance',
      'fuel',
    ]);
    expect(FleetCustodySummaryQuerySchema.parse({ source: 'wash' }).source).toEqual(['wash']);
    expect(FleetCustodySummaryQuerySchema.safeParse({ source: 'card' }).success).toBe(false);
    // «التوكيل» is no longer a custody kind: a dealership invoice never reaches the fund.
    expect(FleetCustodySummaryQuerySchema.safeParse({ source: 'dealership' }).success).toBe(false);
  });

  it('the movements take the arrows’ whole order; the figures are never ordered', () => {
    expect(ListFleetCustodyMovementsQuerySchema.parse({ sort: 'amount:desc,date:asc' }).sort).toBe(
      'amount:desc,date:asc',
    );
    expect(FleetCustodySummaryQuerySchema.safeParse({ sort: 'amount:asc' }).success).toBe(false);
  });

  it('«السجل» narrows the movements to one car — a registry id, or an old-book code kept whole', () => {
    const id = '64b7f0c2a1b2c3d4e5f60718';
    expect(
      ListFleetCustodyMovementsQuerySchema.parse({ vehicleCodes: '160,204', vehicleId: id }),
    ).toMatchObject({ vehicleCodes: ['160', '204'], vehicleId: id });
    // A book code is one car, spaces and all — `vehicleCodes` would have made it two.
    expect(
      ListFleetCustodyMovementsQuerySchema.parse({ bookCode: ' كوستر الدفتر ' }).bookCode,
    ).toBe('كوستر الدفتر');
    expect(
      ListFleetCustodyMovementsQuerySchema.parse({ vehicleCodes: 'كوستر الدفتر' }).vehicleCodes,
    ).toEqual(['كوستر', 'الدفتر']);
    for (const bad of [{ vehicleId: '160' }, { bookCode: '' }, { bookCode: 'x'.repeat(101) }]) {
      expect(ListFleetCustodyMovementsQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    // The figures and the dashboard never take a car of their own — only the board's filters.
    for (const schema of [FleetCustodySummaryQuerySchema, FleetCustodyDashboardQuerySchema]) {
      expect(schema.safeParse({ vehicleId: id }).success).toBe(false);
      expect(schema.safeParse({ bookCode: 'كوستر الدفتر' }).success).toBe(false);
    }
  });

  it('«لوحة تحكم» reads the figures’ own filters, a list of kinds included — and nothing more', () => {
    const query = {
      vehicleCodes: '160,204',
      source: 'fuel,wash',
      driver: 'محمد',
      from: '2026-10-01',
      to: '2026-10-31',
    };
    expect(FleetCustodyDashboardQuerySchema.parse(query)).toEqual(
      FleetCustodySummaryQuerySchema.parse(query),
    );
    expect(FleetCustodyDashboardQuerySchema.parse(query).source).toEqual(['fuel', 'wash']);
    expect(FleetCustodyDashboardQuerySchema.parse({})).toEqual({});
    // Never ordered, never paged: a parameter the figures refuse, it refuses too.
    for (const extra of [{ sort: 'amount:asc' }, { page: '2' }, { pageSize: '10' }]) {
      expect(FleetCustodyDashboardQuerySchema.safeParse(extra).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
    expect(FleetCustodyDashboardQuerySchema.safeParse({ source: 'card' }).success).toBe(false);
  });
});

describe('fleetMonthWindow — a licence-expiry month as its first and last instant', () => {
  it('runs the whole month in UTC, February of a leap year included', () => {
    expect(fleetMonthWindow('2026-11')).toEqual({
      from: new Date('2026-11-01T00:00:00.000Z'),
      before: new Date('2026-11-30T23:59:59.999Z'),
    });
    expect(fleetMonthWindow('2028-02')?.before.toISOString()).toBe('2028-02-29T23:59:59.999Z');
  });

  it('is nothing for a malformed month', () => {
    expect(fleetMonthWindow('2026-13')).toBeNull();
    expect(fleetMonthWindow('11/2026')).toBeNull();
    expect(fleetMonthWindow('')).toBeNull();
  });

  it('the vehicles query takes several months', () => {
    const parsed = ListFleetVehiclesQuerySchema.parse({ licenseExpiryMonths: '2026-11,2027-01' });
    expect(parsed.licenseExpiryMonths).toEqual(['2026-11', '2027-01']);
    expect(() => ListFleetVehiclesQuerySchema.parse({ licenseExpiryMonths: '2026-13' })).toThrow();
  });
});

describe('custody memos and the fund’s operations — «ومش عاوز اى داتا اجبارى»', () => {
  const line = (n: number, over: Record<string, unknown> = {}) => ({
    receiptId: oid(String(n)),
    ...over,
  });
  const memo = (over: Record<string, unknown> = {}) => ({
    kind: 'tyres',
    lines: [line(1)],
    ...over,
  });
  const paths = (result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) =>
    (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

  it('a memo needs its kind and one receipt — nothing else', () => {
    const parsed = CreateFleetCustodyMemoSchema.parse(memo());
    expect(parsed).toEqual({
      kind: 'tyres',
      name: '',
      lines: [{ receiptId: oid('1'), mission: '', statement: '', note: '' }],
    });
    expect(parsed.date).toBeUndefined();
    expect(CreateFleetCustodyMemoSchema.safeParse(memo({ lines: [] })).success).toBe(false);
    expect(CreateFleetCustodyMemoSchema.safeParse({ lines: [line(1)] }).success).toBe(false);
    // Only a custody kind: a card receipt or a dealership invoice never makes a memo.
    for (const kind of ['card', 'dealership', 'licence']) {
      expect(CreateFleetCustodyMemoSchema.safeParse(memo({ kind })).success, kind).toBe(false);
    }
    expect(CreateFleetCustodyMemoSchema.safeParse(memo({ no: 7 })).success).toBe(false);
  });

  it('its name is optional free text — trimmed, at most 120 characters', () => {
    expect(CreateFleetCustodyMemoSchema.parse(memo({ name: '  كاوتش أكتوبر  ' })).name).toBe(
      'كاوتش أكتوبر',
    );
    expect(CreateFleetCustodyMemoSchema.parse(memo({ name: '   ' })).name).toBe('');
    expect(CreateFleetCustodyMemoSchema.safeParse(memo({ name: 'x'.repeat(120) })).success).toBe(
      true,
    );
    expect(CreateFleetCustodyMemoSchema.safeParse(memo({ name: 'x'.repeat(121) })).success).toBe(
      false,
    );
  });

  it('a receipt appears once in a memo, however its id is spelled', () => {
    const twice = CreateFleetCustodyMemoSchema.safeParse(
      memo({ lines: [line(1), line(2), line(1)] }),
    );
    expect(twice.success).toBe(false);
    expect(paths(twice)).toEqual(['lines.2.receiptId']);
    const upper = 'ABCDEF0123456789ABCDEF01';
    expect(
      CreateFleetCustodyMemoSchema.safeParse(
        memo({ lines: [{ receiptId: upper }, { receiptId: upper.toLowerCase() }] }),
      ).success,
    ).toBe(false);
  });

  it('each kind takes only the cells its paper writes by hand', () => {
    const ok = (kind: string, cells: Record<string, string>) =>
      CreateFleetCustodyMemoSchema.safeParse(memo({ kind, lines: [line(1, cells)] }));
    expect(ok('fuel', { mission: 'شلاتين', note: 'ملاحظة' }).success).toBe(true);
    expect(ok('maintenance', { statement: 'تغيير زيت', note: 'ملاحظة' }).success).toBe(true);
    expect(paths(ok('tyres', { mission: 'شلاتين' }))).toEqual(['lines.0.mission']);
    expect(paths(ok('fuel', { statement: 'تغيير زيت' }))).toEqual(['lines.0.statement']);
    expect(paths(ok('wash', { note: 'ملاحظة' }))).toEqual(['lines.0.note']);
    expect(paths(ok('tyres', { note: 'ملاحظة' }))).toEqual(['lines.0.note']);
    // Blank cells are no cells: whitespace trims away on every kind.
    expect(ok('wash', { mission: '  ', statement: ' ', note: '   ' }).success).toBe(true);
    expect(ok('fuel', { mission: 'x'.repeat(121) }).success).toBe(false);
    expect(ok('maintenance', { statement: 'x'.repeat(501) }).success).toBe(false);
    expect(ok('fuel', { note: 'x'.repeat(301) }).success).toBe(false);
    expect(
      CreateFleetCustodyMemoSchema.safeParse(memo({ lines: [line(1, { amount: 5 })] })).success,
    ).toBe(false);
  });

  it('its period runs forward; absent or null, the lines decide it', () => {
    const bad = CreateFleetCustodyMemoSchema.safeParse(
      memo({ from: '2026-10-05', to: '2026-10-01' }),
    );
    expect(bad.success).toBe(false);
    expect(paths(bad)).toEqual(['to']);
    const same = CreateFleetCustodyMemoSchema.parse(
      memo({ date: '2026-10-19', from: '2026-10-05', to: '2026-10-05' }),
    );
    expect(same.date?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(same.from?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    const open = CreateFleetCustodyMemoSchema.parse(memo({ from: null, to: null }));
    expect(open.from).toBeNull();
    expect(open.to).toBeNull();
    expect(CreateFleetCustodyMemoSchema.parse(memo({ from: '2026-10-05' })).to).toBeUndefined();
  });

  it('holds at most FLEET_CUSTODY_MEMO_MAX_LINES receipts — the one cap, 3000', () => {
    expect(FLEET_CUSTODY_MEMO_MAX_LINES).toBe(3000);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ receiptId: (i + 1).toString(16).padStart(24, '0') }));
    expect(
      CreateFleetCustodyMemoSchema.safeParse(memo({ lines: many(FLEET_CUSTODY_MEMO_MAX_LINES) }))
        .success,
    ).toBe(true);
    expect(
      CreateFleetCustodyMemoSchema.safeParse(
        memo({ lines: many(FLEET_CUSTODY_MEMO_MAX_LINES + 1) }),
      ).success,
    ).toBe(false);
  });

  it('an edit is the whole memo again, with its version, under the same rules', () => {
    expect(UpdateFleetCustodyMemoSchema.safeParse(memo()).success).toBe(false);
    const parsed = UpdateFleetCustodyMemoSchema.parse(memo({ version: 2 }));
    expect(parsed.version).toBe(2);
    expect(parsed.date).toBeUndefined();
    expect(
      UpdateFleetCustodyMemoSchema.safeParse(memo({ version: 2, lines: [line(1), line(1)] }))
        .success,
    ).toBe(false);
    expect(
      UpdateFleetCustodyMemoSchema.safeParse(
        memo({ version: 2, kind: 'wash', lines: [line(1, { mission: 'شلاتين' })] }),
      ).success,
    ).toBe(false);
    expect(
      UpdateFleetCustodyMemoSchema.safeParse(
        memo({ version: 2, from: '2026-10-05', to: '2026-10-01' }),
      ).success,
    ).toBe(false);
  });

  it('the memos list filters by kinds, status and period; its figures are never ordered', () => {
    expect(
      ListFleetCustodyMemosQuerySchema.parse({
        kind: 'fuel,tyres',
        status: 'pending',
        from: '2026-10-01',
        sort: 'no:desc',
      }),
    ).toMatchObject({ kind: ['fuel', 'tyres'], status: 'pending', sort: 'no:desc' });
    expect(ListFleetCustodyMemosQuerySchema.parse({ status: 'replenished' }).status).toBe(
      'replenished',
    );
    expect(ListFleetCustodyMemosQuerySchema.safeParse({ status: 'settled' }).success).toBe(false);
    expect(ListFleetCustodyMemosQuerySchema.safeParse({ kind: 'card' }).success).toBe(false);
    expect(FleetCustodyMemoSummaryQuerySchema.parse({ kind: 'wash' }).kind).toEqual(['wash']);
    expect(FleetCustodyMemoSummaryQuerySchema.safeParse({ sort: 'no:asc' }).success).toBe(false);
    expect(FleetCustodyMemoSummaryQuerySchema.safeParse({ page: '2' }).success).toBe(false);
  });

  it('the dashboard splits the spend three ways against the memos; a receipt is late after 30 days', () => {
    // «تمت الاستعاضة» / «في مذكرات لم تُستعَض» / «خارج المذكرات» — in the bars' order.
    expect(FLEET_CUSTODY_MEMO_STATES).toEqual(['replenished', 'pending', 'outside']);
    // Every memo status lands in one of the three — a held memo's money is not back yet, so it
    // still waits; «خارج المذكرات» is a receipt on none.
    for (const status of FLEET_CUSTODY_MEMO_STATUSES) {
      expect(FLEET_CUSTODY_MEMO_STATES).toContain(FLEET_CUSTODY_MEMO_STATE_OF_STATUS[status]);
    }
    expect(FLEET_CUSTODY_MEMO_STATE_OF_STATUS).toEqual({
      pending: 'pending',
      held: 'pending',
      replenished: 'replenished',
    });
    expect(Object.keys(FLEET_CUSTODY_MEMO_STATE_OF_STATUS).sort()).toEqual(
      [...FLEET_CUSTODY_MEMO_STATUSES].sort(),
    );
    expect(FleetCustodyMemoStateSchema.parse('outside')).toBe('outside');
    expect(FleetCustodyMemoStateSchema.safeParse('settled').success).toBe(false);
    expect(FLEET_CUSTODY_STALE_DAYS).toBe(30);
  });

  it('the editor’s receipts are asked for one kind, and the memo being edited', () => {
    expect(FleetCustodyMemoCandidatesQuerySchema.parse({ kind: 'fuel' })).toEqual({ kind: 'fuel' });
    expect(
      FleetCustodyMemoCandidatesQuerySchema.parse({ kind: 'fuel', memoId: oid('9') }).memoId,
    ).toBe(oid('9'));
    expect(FleetCustodyMemoCandidatesQuerySchema.safeParse({}).success).toBe(false);
    expect(FleetCustodyMemoCandidatesQuerySchema.safeParse({ kind: 'fuel,wash' }).success).toBe(
      false,
    );
    expect(
      FleetCustodyMemoCandidatesQuerySchema.safeParse({ kind: 'fuel', memoId: '7' }).success,
    ).toBe(false);
  });

  it('«شحن العهدة» needs its amount and nothing else', () => {
    expect(CreateFleetCustodyChargeSchema.parse({ amount: 200_000 })).toEqual({
      amount: 200_000,
      reason: '',
    });
    expect(
      CreateFleetCustodyChargeSchema.parse({
        amount: 124_139.46,
        date: '2026-10-05',
        reason: '  مصروفات الحركة  ',
      }),
    ).toMatchObject({ amount: 124_139.46, reason: 'مصروفات الحركة' });
    for (const amount of [undefined, 0, -5, 10.005, 1_000_000_001, '200000']) {
      expect(CreateFleetCustodyChargeSchema.safeParse({ amount }).success, String(amount)).toBe(
        false,
      );
    }
    expect(
      CreateFleetCustodyChargeSchema.safeParse({ amount: 5, reason: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(CreateFleetCustodyChargeSchema.safeParse({ amount: 5, memoIds: [] }).success).toBe(
      false,
    );
  });

  it('«استعاضة عهدة» names each memo once, and its period runs forward', () => {
    expect(CreateFleetCustodyReplenishmentSchema.parse({ memoIds: [oid('1'), oid('2')] })).toEqual({
      memoIds: [oid('1'), oid('2')],
    });
    expect(CreateFleetCustodyReplenishmentSchema.safeParse({ memoIds: [] }).success).toBe(false);
    const twice = CreateFleetCustodyReplenishmentSchema.safeParse({
      memoIds: [oid('1'), oid('2'), oid('1')],
    });
    expect(twice.success).toBe(false);
    expect(paths(twice)).toEqual(['memoIds.2']);
    expect(
      CreateFleetCustodyReplenishmentSchema.safeParse({
        memoIds: ['ABCDEF0123456789ABCDEF01', 'abcdef0123456789abcdef01'],
      }).success,
    ).toBe(false);
    const backwards = CreateFleetCustodyReplenishmentSchema.safeParse({
      memoIds: [oid('1')],
      from: '2026-09-30',
      to: '2026-09-01',
    });
    expect(paths(backwards)).toEqual(['to']);
    expect(
      CreateFleetCustodyReplenishmentSchema.parse({ memoIds: [oid('1')], from: null, to: null }),
    ).toMatchObject({ from: null, to: null });
  });

  it('«تسوية عهدة» names each licensing memo once — a record’s two memos are two', () => {
    const both = CreateFleetCustodySettlementSchema.parse({
      parts: [
        { expenseId: oid('1'), part: 'renewal' },
        { expenseId: oid('1'), part: 'extension' },
      ],
    });
    expect(both.parts).toHaveLength(2);
    const twice = CreateFleetCustodySettlementSchema.safeParse({
      parts: [
        { expenseId: oid('1'), part: 'renewal' },
        { expenseId: oid('2'), part: 'renewal' },
        { expenseId: oid('1'), part: 'renewal' },
      ],
    });
    expect(twice.success).toBe(false);
    expect(paths(twice)).toEqual(['parts.2']);
    expect(CreateFleetCustodySettlementSchema.safeParse({ parts: [] }).success).toBe(false);
    expect(
      CreateFleetCustodySettlementSchema.safeParse({
        parts: [{ expenseId: oid('1'), part: 'both' }],
      }).success,
    ).toBe(false);
    expect(
      CreateFleetCustodySettlementSchema.safeParse({
        parts: [{ expenseId: oid('1'), part: 'renewal' }],
        from: '2026-10-05',
        to: '2026-10-04',
      }).success,
    ).toBe(false);
  });

  it('«سجل العهدة» filters by one operation or several; its figures are never ordered', () => {
    expect(ListFleetCustodyLedgerQuerySchema.parse({ op: 'charge,spend' }).op).toEqual([
      'charge',
      'spend',
    ]);
    expect(ListFleetCustodyLedgerQuerySchema.parse({ op: '' }).op).toBeUndefined();
    expect(ListFleetCustodyLedgerQuerySchema.parse({ sort: 'date:asc' }).sort).toBe('date:asc');
    expect(ListFleetCustodyLedgerQuerySchema.safeParse({ op: 'refund' }).success).toBe(false);
    expect(
      FleetCustodyLedgerSummaryQuerySchema.parse({ op: 'replenish,settle', from: '2026-10-01' }),
    ).toMatchObject({ op: ['replenish', 'settle'] });
    expect(FleetCustodyLedgerSummaryQuerySchema.safeParse({ sort: 'date:asc' }).success).toBe(
      false,
    );
  });

  it('the licensing board filters by «الحالة» — waiting or settled', () => {
    for (const schema of [
      ListFleetLicenseExpensesQuerySchema,
      FleetLicenseExpenseSummaryQuerySchema,
    ]) {
      expect(schema.parse({ status: 'waiting' }).status).toBe('waiting');
      expect(schema.parse({ status: 'settled', kind: 'renewal' })).toMatchObject({
        status: 'settled',
        kind: 'renewal',
      });
      expect(schema.parse({}).status).toBeUndefined();
      expect(schema.safeParse({ status: 'pending' }).success).toBe(false);
    }
  });
});

describe('a held replenishment — «استعاضة معلّقة لحين التحويل»', () => {
  it('a replenishment is held, then done or cancelled; a memo is pending, held or replenished', () => {
    expect(FLEET_CUSTODY_OPERATION_STATUSES).toEqual(['held', 'done', 'cancelled']);
    expect(FLEET_CUSTODY_MEMO_STATUSES).toEqual(['pending', 'held', 'replenished']);
    expect(FleetCustodyMemoStatusSchema.parse('held')).toBe('held');
    expect(ListFleetCustodyMemosQuerySchema.parse({ status: 'held' }).status).toBe('held');
  });

  it('«تأكيد التحويل» needs its day and nothing else', () => {
    expect(ConfirmFleetCustodyTransferSchema.parse({ date: '2026-10-20' })).toEqual({
      date: new Date('2026-10-20'),
      reference: '',
      note: '',
    });
    expect(
      ConfirmFleetCustodyTransferSchema.parse({
        date: '2026-10-20',
        reference: '  TRX-77  ',
        note: 'بنك مصر',
      }),
    ).toMatchObject({ reference: 'TRX-77', note: 'بنك مصر' });
    expect(ConfirmFleetCustodyTransferSchema.safeParse({}).success).toBe(false);
    expect(ConfirmFleetCustodyTransferSchema.safeParse({ reference: 'TRX-77' }).success).toBe(
      false,
    );
    expect(ConfirmFleetCustodyTransferSchema.safeParse({ date: 'not a day' }).success).toBe(false);
    expect(
      ConfirmFleetCustodyTransferSchema.safeParse({
        date: '2026-10-20',
        reference: 'x'.repeat(121),
      }).success,
    ).toBe(false);
    expect(
      ConfirmFleetCustodyTransferSchema.safeParse({ date: '2026-10-20', amount: 5 }).success,
    ).toBe(false);
  });

  it('«إلغاء الاستعاضة المعلّقة» needs nothing; its reason is optional free text', () => {
    expect(CancelFleetCustodyReplenishmentSchema.parse({})).toEqual({ reason: '' });
    expect(CancelFleetCustodyReplenishmentSchema.parse({ reason: '  خطأ في المذكرات  ' })).toEqual({
      reason: 'خطأ في المذكرات',
    });
    expect(
      CancelFleetCustodyReplenishmentSchema.safeParse({ reason: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(CancelFleetCustodyReplenishmentSchema.safeParse({ date: '2026-10-20' }).success).toBe(
      false,
    );
  });
});

describe('a fuel-card sheet — «مطابقة أرصدة الكروت»', () => {
  it('the log gains the sheet’s two kinds at the end; the first four keep their order', () => {
    expect(FLEET_FUEL_MOVEMENT_KINDS).toEqual([
      'charge',
      'transferIn',
      'transferOut',
      'receipt',
      'sheetAdjust',
      'sheetReject',
    ]);
  });

  it('a sheet is read for one of the two companies — nothing else rides beside the file', () => {
    expect(UploadFleetFuelSheetSchema.parse({ company: 'wataniya' })).toEqual({
      company: 'wataniya',
    });
    expect(UploadFleetFuelSheetSchema.parse({ company: 'chillout' }).company).toBe('chillout');
    expect(UploadFleetFuelSheetSchema.safeParse({}).success).toBe(false);
    expect(UploadFleetFuelSheetSchema.safeParse({ company: 'shell' }).success).toBe(false);
    expect(
      UploadFleetFuelSheetSchema.safeParse({ company: 'wataniya', sheet: 'Sheet1' }).success,
    ).toBe(false);
  });

  it('a decision is ✓ or ✗ on 1–500 cards, each once however its id is spelled', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => oid(String(i + 1)));
    expect(DecideFleetFuelReconcileSchema.parse({ decision: 'apply', cardIds: ids(1) })).toEqual({
      decision: 'apply',
      cardIds: ids(1),
    });
    expect(
      DecideFleetFuelReconcileSchema.safeParse({
        decision: 'reject',
        cardIds: ids(FLEET_FUEL_RECONCILE_MAX_CARDS),
      }).success,
    ).toBe(true);
    expect(FLEET_FUEL_RECONCILE_MAX_CARDS).toBe(500);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({ decision: 'apply', cardIds: ids(501) }).success,
    ).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({ decision: 'apply', cardIds: [] }).success,
    ).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({ decision: 'apply', cardIds: [oid('1'), oid('1')] })
        .success,
    ).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({
        decision: 'apply',
        cardIds: ['ABCDEF0123456789ABCDEF01', 'abcdef0123456789abcdef01'],
      }).success,
    ).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({ decision: 'apply', cardIds: ['7'] }).success,
    ).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({ decision: 'keep', cardIds: ids(1) }).success,
    ).toBe(false);
    expect(DecideFleetFuelReconcileSchema.safeParse({ cardIds: ids(1) }).success).toBe(false);
    expect(
      DecideFleetFuelReconcileSchema.safeParse({
        decision: 'apply',
        cardIds: ids(1),
        balance: 100,
      }).success,
    ).toBe(false);
  });
});
