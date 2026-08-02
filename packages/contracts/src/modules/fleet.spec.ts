// The contracts encode the frozen design's load-bearing rules; these tests pin the ones whose
// loss would be silent — derived fields absent from inputs, the roster's per-day uniqueness, and
// the whole event surface being declared `planned` until a publisher exists.
import { describe, expect, it } from 'vitest';
import {
  ChangeFleetVehicleStatusSchema,
  CreateFleetCatalogItemSchema,
  CreateFleetUnavailabilitySchema,
  FleetEvents,
  PlanFleetRosterSchema,
  RecordFleetOdometerSchema,
  RecordFleetVehicleViolationSchema,
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
