// The roster's day rules (R-02…R-06), first as functions and then as the board applies them.
//
// The pure half pins what each rule MEANS. The board half drives the real `board()` and the real
// availability seam over stubbed data — vehicles, the day's plan, the standing crews, the org chart,
// the profiles, the التمامات overlay, HR and the settings — so what is asserted is the composition:
// the marks the dashboard will count, and the invariants it relies on.
import { FleetSettingKeys, type FleetRosterDayDto, type FleetRosterRowDto } from '@ecms/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crewGapsOf,
  driverLicenceStateOn,
  isAbsenceReason,
  licenceExpiredOn,
  rowMannedOn,
  seatManned,
  stalePlanOf,
  vehicleAssignableOn,
  type DriverReasonOn,
} from './roster-rules';

// ── the rules as functions ──────────────────────────────────────────────────

const TODAY = '2026-11-20';
const available: DriverReasonOn = () => null;
const reasons =
  (map: Record<string, ReturnType<DriverReasonOn>>): DriverReasonOn =>
  (id) =>
    map[id] ?? null;

describe('R-02 — a licence is expired ON its expiry day', () => {
  it('expires on the day itself and after, never before', () => {
    expect(licenceExpiredOn(new Date('2026-11-20T00:00:00.000Z'), TODAY)).toBe(true);
    expect(licenceExpiredOn(new Date('2026-11-20T10:00:00.000Z'), TODAY), 'a stamped hour').toBe(
      true,
    );
    expect(licenceExpiredOn('2026-11-01', TODAY)).toBe(true);
    expect(licenceExpiredOn(new Date('2026-11-21T00:00:00.000Z'), TODAY)).toBe(false);
  });

  it('never expires a licence nobody dated', () => {
    expect(licenceExpiredOn(null, TODAY)).toBe(false);
    expect(licenceExpiredOn(undefined, TODAY)).toBe(false);
  });

  it('names the driver’s licence state from the profile, or the lack of one', () => {
    expect(driverLicenceStateOn(null, TODAY)).toBe('noProfile');
    expect(driverLicenceStateOn({ licenseExpiresAt: null }, TODAY)).toBe('notRecorded');
    expect(driverLicenceStateOn({ licenseExpiresAt: new Date('2026-11-20') }, TODAY)).toBe(
      'expired',
    );
    expect(driverLicenceStateOn({ licenseExpiresAt: new Date('2027-01-01') }, TODAY)).toBe('valid');
  });
});

describe('R-03 — a ready vehicle', () => {
  const car = (over: Partial<{ status: string; licenseExpiresAt: Date | null }> = {}) => ({
    status: 'active',
    licenseExpiresAt: new Date('2027-01-01'),
    ...over,
  });

  it('is active, out of the workshop and licensed on the day', () => {
    expect(vehicleAssignableOn(car(), false, TODAY)).toBe(true);
  });

  it('is not ready in the workshop, with an expired licence, or out of service', () => {
    expect(vehicleAssignableOn(car(), true, TODAY)).toBe(false);
    expect(
      vehicleAssignableOn(car({ licenseExpiresAt: new Date('2026-11-20') }), false, TODAY),
    ).toBe(false);
    expect(vehicleAssignableOn(car({ status: 'outOfService' }), false, TODAY)).toBe(false);
    expect(vehicleAssignableOn(car({ status: 'disposed' }), false, TODAY)).toBe(false);
  });

  it('is ready with no licence date — a missing date never blocks', () => {
    expect(vehicleAssignableOn(car({ licenseExpiresAt: null }), false, TODAY)).toBe(true);
  });
});

describe('R-06 — manned seats', () => {
  it('is manned only by a driver available on the day', () => {
    expect(seatManned(null, available)).toBe(false);
    expect(seatManned('a', available)).toBe(true);
    expect(seatManned('a', reasons({ a: 'hrLeave' }))).toBe(false);
    expect(seatManned('a', reasons({ a: 'licenceExpired' })), 'R-04 includes the licence').toBe(
      false,
    );
  });

  it('a row is manned when either seat is', () => {
    expect(rowMannedOn([null, null], available)).toBe(false);
    expect(rowMannedOn([null, 'b'], available)).toBe(true);
    expect(rowMannedOn(['a', 'b'], reasons({ a: 'hrLeave', b: 'fleetUnavailability' }))).toBe(
      false,
    );
  });
});

describe('R-06 — crew gaps, seat by seat', () => {
  const absentA = reasons({ a: 'fleetUnavailability' });

  it('an absent fixed driver with an empty seat is a gap', () => {
    expect(
      crewGapsOf({ ready: true, seats: [null, null], fixed: ['a', null], reasonOf: absentA }),
    ).toEqual({
      crewGaps: [{ seat: 1, employeeId: 'a', reason: 'fleetUnavailability' }],
      crewCovered: 0,
    });
  });

  it('an absent fixed driver whose seat an available substitute holds is COVERED', () => {
    expect(
      crewGapsOf({ ready: true, seats: ['s', null], fixed: ['a', null], reasonOf: absentA }),
    ).toEqual({ crewGaps: [], crewCovered: 1 });
  });

  it('a seat still naming the absent fixed driver himself is a gap — planned before the absence', () => {
    expect(
      crewGapsOf({ ready: true, seats: ['a', null], fixed: ['a', null], reasonOf: absentA })
        .crewGaps,
    ).toEqual([{ seat: 1, employeeId: 'a', reason: 'fleetUnavailability' }]);
  });

  it('a car that is not ready has no gap — the workshop, or its own expired licence', () => {
    expect(
      crewGapsOf({ ready: false, seats: [null, null], fixed: ['a', null], reasonOf: absentA }),
    ).toEqual({ crewGaps: [], crewCovered: 0 });
  });

  it('an AVAILABLE fixed driver is never a gap, wherever the day put him', () => {
    expect(
      crewGapsOf({ ready: true, seats: [null, null], fixed: ['a', 'b'], reasonOf: available }),
    ).toEqual({ crewGaps: [], crewCovered: 0 });
  });

  it('keeps the reason, so the alert can tell an absence from anything else', () => {
    const r = reasons({ a: 'licenceExpired', b: 'hrLeave' });
    expect(
      crewGapsOf({ ready: true, seats: [null, null], fixed: ['a', 'b'], reasonOf: r }).crewGaps,
    ).toEqual([
      { seat: 1, employeeId: 'a', reason: 'licenceExpired' },
      { seat: 2, employeeId: 'b', reason: 'hrLeave' },
    ]);
  });

  it('a car with no standing crew has no gap', () => {
    expect(
      crewGapsOf({ ready: true, seats: [null, null], fixed: null, reasonOf: available }),
    ).toEqual({ crewGaps: [], crewCovered: 0 });
  });
});

describe('R-05 — what counts as an absence', () => {
  it('is التمامات or HR leave, and nothing else', () => {
    expect(isAbsenceReason('fleetUnavailability')).toBe(true);
    expect(isAbsenceReason('hrLeave')).toBe(true);
    for (const reason of [
      'licenceExpired',
      'notEmployed',
      'profileInactive',
      'notADriver',
    ] as const) {
      expect(isAbsenceReason(reason), reason).toBe(false);
    }
  });
});

describe('a stale plan', () => {
  const r = reasons({ g: 'fleetUnavailability', a: 'hrLeave' });

  it('is a PLANNED seat naming an unavailable driver from outside the car’s crew', () => {
    expect(stalePlanOf({ planned: true, seats: ['g', null], fixed: null, reasonOf: r })).toBe(true);
    expect(
      stalePlanOf({ planned: true, seats: ['g', null], fixed: ['a', null], reasonOf: r }),
    ).toBe(true);
  });

  it('is not the crew’s own absence — that is a gap', () => {
    expect(
      stalePlanOf({ planned: true, seats: ['a', null], fixed: ['a', null], reasonOf: r }),
    ).toBe(false);
  });

  it('is never a projection, and never an available driver', () => {
    expect(stalePlanOf({ planned: false, seats: ['g', null], fixed: null, reasonOf: r })).toBe(
      false,
    );
    expect(stalePlanOf({ planned: true, seats: ['s', null], fixed: null, reasonOf: r })).toBe(
      false,
    );
  });
});

// ── the board ───────────────────────────────────────────────────────────────

const DATE = new Date('2026-11-20T00:00:00.000Z');
const id = (n: number): string => `64b1f0abcdefabcdefab${String(n).padStart(4, '0')}`;

/** Vehicles, each one shape. */
const V = {
  free: id(101), // fixed A (available), unplanned → A carried
  gap: id(102), // fixed B (التمامات), unplanned → seat empty → gap
  covered: id(103), // fixed C (leave), planned with substitute S → covered
  workshop: id(104), // fixed D (التمامات), in the workshop → no gap
  elsewhere: id(105), // fixed E (available) planned on `other` → no gap
  other: id(106), // planned with E
  plannedAbsent: id(107), // fixed F, planned with F, F then absent → gap
  stale: id(108), // no crew, planned with G (absent) → stale plan
  expired: id(109), // its own licence expired → not ready
  expiresToday: id(110), // its licence expires on the day → not ready
  suspended: id(111), // fixed K (suspended) → gap, reason notEmployed
  licDriver: id(112), // fixed L (driver licence expired) → gap, reason licenceExpired
  empty: id(113), // nothing at all
};
/** Drivers. */
const D = {
  A: id(1),
  B: id(2),
  C: id(3),
  S: id(4),
  D: id(5),
  E: id(6),
  F: id(7),
  G: id(8),
  H: id(9),
  K: id(10),
  L: id(11),
  M: id(12), // free, on no car
  N: id(13), // profile switched off
};

const vehicleDoc = (vehicleId: string, code: string, licenseExpiresAt = '2027-06-30') => ({
  _id: vehicleId,
  code,
  plateNumber: `س ص ${code}`,
  typeId: 'type',
  status: 'active',
  licenseExpiresAt: new Date(`${licenseExpiresAt}T00:00:00.000Z`),
});
const VEHICLES = [
  vehicleDoc(V.free, '150'),
  vehicleDoc(V.gap, '151'),
  vehicleDoc(V.covered, '152'),
  vehicleDoc(V.workshop, '153'),
  vehicleDoc(V.elsewhere, '154'),
  vehicleDoc(V.other, '155'),
  vehicleDoc(V.plannedAbsent, '156'),
  vehicleDoc(V.stale, '157'),
  vehicleDoc(V.expired, '158', '2026-10-01'),
  vehicleDoc(V.expiresToday, '159', '2026-11-20'),
  vehicleDoc(V.suspended, '160'),
  vehicleDoc(V.licDriver, '161'),
  vehicleDoc(V.empty, '162'),
];
const WORKSHOP = new Set([V.workshop]);

const crew = (vehicleId: string, driver1: string | null, driver2: string | null = null) => ({
  vehicleId,
  driver1EmployeeId: driver1,
  driver2EmployeeId: driver2,
  missionTypeId: null,
});
const FIXED = [
  crew(V.free, D.A),
  crew(V.gap, D.B),
  crew(V.covered, D.C),
  crew(V.workshop, D.D),
  crew(V.elsewhere, D.E),
  crew(V.plannedAbsent, D.F),
  crew(V.expired, D.H),
  crew(V.suspended, D.K),
  crew(V.licDriver, D.L),
];

const duty = (vehicleId: string, driver1: string | null) => ({
  _id: `duty-${vehicleId}`,
  __v: 0,
  vehicleId,
  date: DATE,
  missionTypeId: null,
  driver1EmployeeId: driver1,
  driver2EmployeeId: null,
  notes: null,
});
const PLANNED = [
  duty(V.covered, D.S),
  duty(V.other, D.E),
  duty(V.plannedAbsent, D.F),
  duty(V.stale, D.G),
];

const REGISTRY = Object.values(D).map((employeeId) => ({
  employeeId,
  status: employeeId === D.K ? 'suspended' : 'active',
}));
const profileOf = (employeeId: string, licenseExpiresAt: string | null, isActive = true) => ({
  employeeId,
  licenseExpiresAt:
    licenseExpiresAt === null ? null : new Date(`${licenseExpiresAt}T00:00:00.000Z`),
  isActive,
});
const PROFILES = [
  profileOf(D.A, '2027-01-01'),
  profileOf(D.L, '2026-11-01'), // expired before the day
  profileOf(D.M, null), // a profile with no date: flagged, never blocked
  profileOf(D.N, '2027-01-01', false),
  // The suspended seat-holder's licence has ALSO expired: he still answers notEmployed.
  profileOf(D.K, '2026-10-01'),
];
const ABSENT = new Set([D.B, D.D, D.F, D.G]);
const ON_LEAVE = new Set([D.C]);

const settings = new Map<string, unknown>();

vi.mock('../vehicles/vehicle.repository', () => ({
  fleetVehicleRepository: { listVehicles: vi.fn(async () => ({ items: VEHICLES })) },
}));
vi.mock('../vehicles/vehicle.service', () => ({
  fleetVehicleService: { openVisitVehicleIds: vi.fn(async () => WORKSHOP) },
}));
vi.mock('./duty-assignment.repository', () => ({
  fleetDutyAssignmentRepository: {
    findForDate: vi.fn(async () => PLANNED),
    takenDrivers: (rows: typeof PLANNED) => {
      const taken = new Map<string, string>();
      for (const row of rows) {
        for (const slot of [row.driver1EmployeeId, row.driver2EmployeeId]) {
          if (slot !== null) taken.set(String(slot), String(row.vehicleId));
        }
      }
      return taken;
    },
  },
}));
vi.mock('../fixed-roster/fixed-crew.repository', () => ({
  fleetFixedCrewRepository: { findAll: vi.fn(async () => FIXED) },
}));
vi.mock('../driver-profiles/driving-seat-roster', () => ({
  drivingSeatRoster: vi.fn(async () => REGISTRY),
  drivingSeatEmployeeIds: vi.fn(async () => REGISTRY.map((e) => e.employeeId)),
}));
vi.mock('../driver-profiles/driver-profile.repository', () => ({
  fleetDriverProfileRepository: {
    findForEmployeesSystem: vi.fn(async () => PROFILES),
    findDriverByEmployeeId: vi.fn(
      async (employeeId: string) => PROFILES.find((p) => p.employeeId === employeeId) ?? null,
    ),
  },
}));
vi.mock('../availability/unavailability.repository', () => ({
  fleetUnavailabilityRepository: {
    coveredOn: vi.fn(async (ids: readonly string[]) => new Set(ids.filter((i) => ABSENT.has(i)))),
    existsCovering: vi.fn(async (employeeId: string) => ABSENT.has(employeeId)),
  },
}));
vi.mock('../../../platform/settings', () => ({
  settingsService: { resolve: vi.fn(async (key: string) => settings.get(key)) },
}));
vi.mock('../../../platform/directory', () => ({
  isOnApprovedLeave: vi.fn(async (employeeId: string) => ON_LEAVE.has(employeeId)),
  approvedLeaveEmployeeIds: vi.fn(
    async (ids: readonly string[]) => new Set(ids.filter((id) => ON_LEAVE.has(id))),
  ),
  getDirectoryEmployee: vi.fn(async (employeeId: string) => ({
    id: employeeId,
    status: employeeId === D.K ? 'suspended' : 'active',
  })),
}));

const { fleetRosterService } = await import('./roster.service');

const board = (): Promise<FleetRosterDayDto> =>
  fleetRosterService.board(DATE, { kind: 'organization' } as never);
const rowOf = (day: FleetRosterDayDto, vehicleId: string): FleetRosterRowDto => {
  const found = day.rows.find((r) => r.vehicleId === vehicleId);
  if (found === undefined) throw new Error(`no row ${vehicleId}`);
  return found;
};

beforeEach(() => {
  settings.clear();
  settings.set(FleetSettingKeys.UseHrLeave, true);
  settings.set(FleetSettingKeys.RosterRefuseExpiredLicence, false);
});

describe('board() marks each row with the day’s rules', () => {
  it('an absent fixed driver with an empty seat → a gap, and the car is unmanned', async () => {
    const row = rowOf(await board(), V.gap);
    expect(row.crewGaps).toEqual([{ seat: 1, employeeId: D.B, reason: 'fleetUnavailability' }]);
    expect(row.manned).toBe(false);
    expect(row.assignable).toBe(true);
  });

  it('an absent fixed driver with an available substitute → covered, no gap', async () => {
    const row = rowOf(await board(), V.covered);
    expect(row.crewGaps).toEqual([]);
    expect(row.crewCovered).toBe(1);
    expect(row.manned).toBe(true);
  });

  it('a workshop car → no gap, and not ready', async () => {
    const row = rowOf(await board(), V.workshop);
    expect(row.crewGaps).toEqual([]);
    expect(row.assignable).toBe(false);
  });

  it('a fixed driver planned on another car → no gap', async () => {
    const day = await board();
    const row = rowOf(day, V.elsewhere);
    expect(row.driver1EmployeeId, 'the projection does not carry him').toBeNull();
    expect(row.crewGaps).toEqual([]);
    expect(rowOf(day, V.other).manned).toBe(true);
  });

  it('a planned row naming its fixed driver, who was then marked absent → a gap', async () => {
    const row = rowOf(await board(), V.plannedAbsent);
    expect(row.planned).toBe(true);
    expect(row.driver1EmployeeId, 'the stored day is handed back verbatim').toBe(D.F);
    expect(row.crewGaps).toEqual([{ seat: 1, employeeId: D.F, reason: 'fleetUnavailability' }]);
    expect(row.manned).toBe(false);
    expect(row.stalePlan, 'his own crew — a gap, not a stale plan').toBe(false);
  });

  it('a planned row naming an unavailable NON-crew driver → stalePlan, not manned', async () => {
    const row = rowOf(await board(), V.stale);
    expect(row.stalePlan).toBe(true);
    expect(row.manned).toBe(false);
    expect(row.crewGaps).toEqual([]);
  });

  it('a car whose licence expired — even on the day itself — is flagged and not ready', async () => {
    const day = await board();
    for (const vehicleId of [V.expired, V.expiresToday]) {
      const row = rowOf(day, vehicleId);
      expect(row.licenceExpired, vehicleId).toBe(true);
      expect(row.assignable, vehicleId).toBe(false);
      expect(row.crewGaps, vehicleId).toEqual([]);
    }
    expect(rowOf(day, V.free).licenceExpired).toBe(false);
  });

  it('a suspended seat-holder is a gap with the reason notEmployed — not an absence', async () => {
    expect(rowOf(await board(), V.suspended).crewGaps).toEqual([
      { seat: 1, employeeId: D.K, reason: 'notEmployed' },
    ]);
  });

  it('a fixed driver whose licence expired leaves a gap named licenceExpired, in BOTH modes', async () => {
    const flagged = rowOf(await board(), V.licDriver);
    expect(flagged.driver1EmployeeId, 'flag mode: still carried, as planning accepts him').toBe(
      D.L,
    );
    expect(flagged.crewGaps).toEqual([{ seat: 1, employeeId: D.L, reason: 'licenceExpired' }]);
    expect(flagged.manned).toBe(false);

    settings.set(FleetSettingKeys.RosterRefuseExpiredLicence, true);
    const refused = rowOf(await board(), V.licDriver);
    expect(refused.driver1EmployeeId, 'refuse mode: the seam no longer offers him').toBeNull();
    expect(refused.crewGaps).toEqual([{ seat: 1, employeeId: D.L, reason: 'licenceExpired' }]);
  });

  it('an untouched car with nothing on it is simply unmanned', async () => {
    const row = rowOf(await board(), V.empty);
    expect(row).toMatchObject({ assignable: true, manned: false, crewGaps: [], stalePlan: false });
  });
});

describe('the day’s drivers', () => {
  it('flags an expired licence on an available driver while the rule is off', async () => {
    const day = await board();
    expect(day.licenceRule).toBe('flag');
    expect(day.availableDrivers.find((d) => d.employeeId === D.L)?.licence).toBe('expired');
    expect(day.availableDrivers.find((d) => d.employeeId === D.M)?.licence).toBe('notRecorded');
    expect(day.availableDrivers.find((d) => d.employeeId === D.S)?.licence).toBe('noProfile');
  });

  it('moves him to the unavailable half, reason licenceExpired, once the rule refuses', async () => {
    settings.set(FleetSettingKeys.RosterRefuseExpiredLicence, true);
    const day = await board();
    expect(day.licenceRule).toBe('refuse');
    expect(day.availableDrivers.map((d) => d.employeeId)).not.toContain(D.L);
    expect(day.unavailableDrivers).toContainEqual({ employeeId: D.L, reason: 'licenceExpired' });
    expect(day.availableDrivers.some((d) => d.licence === 'expired')).toBe(false);
    // The suspended seat-holder's licence has expired too, and he keeps his earlier reason.
    expect(day.unavailableDrivers).toContainEqual({ employeeId: D.K, reason: 'notEmployed' });
  });
});

describe('the invariants the dashboard counts on', () => {
  const tally = (day: FleetRosterDayDto) => {
    const by = (reason: string): number =>
      day.unavailableDrivers.filter((d) => d.reason === reason).length;
    const flagged = day.availableDrivers.filter((d) => d.licence === 'expired').length;
    return {
      registry: day.availableDrivers.length + day.unavailableDrivers.length,
      available: day.availableDrivers.length - flagged,
      absent: by('fleetUnavailability') + by('hrLeave'),
      profileInactive: by('profileInactive'),
      notEmployed: by('notEmployed'),
      licenceExpiredDrivers: flagged + by('licenceExpired'),
    };
  };

  it.each([false, true])(
    'registry = available + absent + profileInactive + notEmployed + licence-expired (refuse %s)',
    async (on) => {
      settings.set(FleetSettingKeys.RosterRefuseExpiredLicence, on);
      const t = tally(await board());
      expect(t.registry).toBe(REGISTRY.length);
      expect(t.notEmployed, 'the suspended seat-holder is in the registry').toBe(1);
      expect(t.licenceExpiredDrivers).toBe(1);
      expect(
        t.available + t.absent + t.profileInactive + t.notEmployed + t.licenceExpiredDrivers,
      ).toBe(t.registry);
    },
  );

  it('ready = rows − in the workshop − (out of the workshop with an expired licence)', async () => {
    const day = await board();
    const ready = day.rows.filter((r) => r.assignable === true).length;
    const inWorkshop = day.rows.filter((r) => r.inMaintenance).length;
    const expiredOut = day.rows.filter((r) => !r.inMaintenance && r.licenceExpired === true).length;
    expect(ready).toBe(day.rows.length - inWorkshop - expiredOut);
    expect(ready).toBe(VEHICLES.length - 1 - 2);
  });
});

describe('the board reads its cars and its drivers side by side', () => {
  // The dashboard asks for this board on every refresh. The driving seats (two HR reads in a row)
  // and each driver's verdict need nothing from the cars, and used to start only once the scoped
  // registry had been paged through and the workshop asked about it.
  it('the driver pool is asked while the cars are still on their way — and the board is unchanged', async () => {
    const before = await board();
    const { fleetVehicleRepository } = await import('../vehicles/vehicle.repository');
    const { drivingSeatRoster } = await import('../driver-profiles/driving-seat-roster');
    vi.mocked(drivingSeatRoster).mockClear();
    let release: (page: { items: typeof VEHICLES }) => void = () => undefined;
    vi.mocked(fleetVehicleRepository.listVehicles).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const pending = board();
    await Promise.resolve();
    expect(drivingSeatRoster, 'asked before the cars answered').toHaveBeenCalledTimes(1);
    release({ items: VEHICLES });
    expect(await pending).toEqual(before);
  });
});
