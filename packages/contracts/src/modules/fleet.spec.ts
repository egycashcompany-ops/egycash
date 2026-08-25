// The contracts encode the frozen design's load-bearing rules; these tests pin the ones whose
// loss would be silent — derived fields absent from inputs, the roster's per-day uniqueness, and
// the whole event surface being declared `planned` until a publisher exists.
import { describe, expect, it } from 'vitest';
import {
  ChangeFleetVehicleStatusSchema,
  CreateFleetCatalogItemSchema,
  CreateFleetUnavailabilitySchema,
  FleetEvents,
  ListFleetDriversQuerySchema,
  ListFleetVehiclesQuerySchema,
  PlanFleetRosterSchema,
  RecordFleetOdometerSchema,
  RecordFleetVehicleViolationSchema,
  SaveFleetFixedRosterSchema,
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
