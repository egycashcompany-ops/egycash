// A DIRECT call to `plan()` — no HTTP request, no schema — still cannot smuggle a spelling past
// the guards.
//
// `roster-id-spelling.spec.ts` proves the normalization is written where it has to be. That is a
// claim about the source, and a source claim survives a refactor that moves the code but breaks
// it. This file makes the harder claim behaviourally: call the real service the way an internal
// caller would — a script, a job, another module — hand it an id in the spelling mongo never
// uses, and watch the FR-5 and FR-7 guards fire anyway.
//
// The seams are mocked because the RULE is what is under test, not mongo: every mock answers in
// the spelling a real document answers in — `String(doc.field)`, always lowercase — which is
// exactly the asymmetry that made the guards miss before the fix.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const V = '64b1f0abcdefabcdefabcdef';
const V2 = '64b1f0abcdefabcdefabcd09';
const D = '64b1f0abcdefabcdefabcd01';
const UP = (id: string): string => id.toUpperCase();

// Typed as rest-parameter functions so the forwarding stubs below can spread into them.
const openVisitVehicleIds = vi.fn<(...a: never[]) => Promise<Set<string>>>();
const findForDate = vi.fn<(...a: never[]) => Promise<unknown[]>>();
const create = vi.fn<(...a: never[]) => Promise<unknown>>();
const updateById = vi.fn<(...a: never[]) => Promise<unknown>>();

vi.mock('../vehicles/vehicle.repository', () => ({
  fleetVehicleRepository: {
    // The registry finds the vehicle whichever way the id is spelled — it builds an ObjectId,
    // and to mongo the two spellings ARE one row. That is why the request gets this far at all.
    getById: vi.fn(async (id: string) => ({ _id: id, code: '150', status: 'active' })),
  },
}));
vi.mock('../vehicles/vehicle.service', () => ({
  fleetVehicleService: { openVisitVehicleIds: (...a: never[]) => openVisitVehicleIds(...a) },
}));
vi.mock('../availability/driver-availability', () => ({
  driverAvailabilityOn: vi.fn(async () => ({ available: true, reason: null })),
}));
vi.mock('../catalogs/catalog-item.repository', () => ({
  fleetCatalogItemRepository: { findActiveOfKind: vi.fn(async () => ({ _id: 'm' })) },
}));
vi.mock('../driver-profiles/driver-profile.repository', () => ({
  fleetDriverProfileRepository: { findMany: vi.fn(async () => []) },
}));
vi.mock('./duty-assignment.repository', () => ({
  fleetDutyAssignmentRepository: {
    findForDate: (...a: never[]) => findForDate(...a),
    create: (...a: never[]) => create(...a),
    updateById: (...a: never[]) => updateById(...a),
  },
}));
vi.mock('../../../platform/kernel/unit-of-work', () => ({
  unitOfWork: async (fn: (s: null) => unknown) => fn(null),
}));
vi.mock('../../../platform/audit', () => ({
  auditService: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../../platform/kernel/event-bus', () => ({ emit: vi.fn(async () => undefined) }));

const { fleetRosterService } = await import('./roster.service');

/** A row exactly as mongo hands it back: ObjectId fields that stringify lowercase. */
const doc = (vehicleId: string, driver1: string | null = null) => ({
  _id: `row-${vehicleId}`,
  __v: 0,
  vehicleId: { toString: () => vehicleId },
  driver1EmployeeId: driver1 === null ? null : { toString: () => driver1 },
  driver2EmployeeId: null,
  missionTypeId: null,
  notes: null,
});

/** The payload an internal caller builds by hand — never parsed, and spelled in UPPER hex. */
const shouting = (rows: Record<string, unknown>[]) =>
  ({ date: new Date('2026-11-20T00:00:00.000Z'), rows }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  openVisitVehicleIds.mockResolvedValue(new Set());
  findForDate.mockResolvedValue([]);
  create.mockImplementation(async (payload: Record<string, unknown>) => ({
    ...doc(String(payload.vehicleId)),
    ...payload,
  }));
  updateById.mockImplementation(async () => doc(V));
});

describe('plan() called directly, with ids in the spelling mongo never uses', () => {
  it('FR-5 still refuses an in-workshop vehicle', async () => {
    // The workshop set comes back in DOCUMENT spelling, as the real repository builds it.
    openVisitVehicleIds.mockResolvedValue(new Set([V]));
    await expect(
      fleetRosterService.plan(
        shouting([{ vehicleId: UP(V), driver1EmployeeId: UP(D) }]),
        'u1',
        {} as never,
      ),
    ).rejects.toThrow(/FR-5/);
  });

  it('FR-7 still refuses a driver another vehicle holds for the date', async () => {
    // V2 is NOT in the payload and still holds D — the plan forgot the releasing row.
    findForDate.mockResolvedValue([doc(V2, D)]);
    await expect(
      fleetRosterService.plan(
        shouting([{ vehicleId: UP(V), driver1EmployeeId: UP(D) }]),
        'u1',
        {} as never,
      ),
    ).rejects.toThrow(/FR-7/);
  });

  it('UPDATES the existing row rather than inserting a second one for the same vehicle', async () => {
    // The bug this fix exists for: the existing-row lookup missed, the create branch ran, and a
    // (vehicle, date) pair ended up with two rows — the older one invisible but still holding a
    // driver. One update, zero creates, is the whole assertion.
    findForDate.mockResolvedValue([doc(V)]);
    await fleetRosterService.plan(
      shouting([{ vehicleId: UP(V), driver1EmployeeId: UP(D) }]),
      'u1',
      {} as never,
    );
    expect(create, 'no second row for a vehicle that already has one').not.toHaveBeenCalled();
    expect(updateById).toHaveBeenCalledTimes(1);
  });

  it('writes the id in canonical spelling, so the stored row matches every later read', async () => {
    // This one passes with or without the fix, and is kept for what it pins: mongo canonicalises
    // on the way IN, so a document always reads back lowercase. That asymmetry — either spelling
    // accepted on write, one spelling returned on read — is the entire premise of the bug, and a
    // change to it would invalidate every other test in this file rather than fail loudly here.
    findForDate.mockResolvedValue([]);
    await fleetRosterService.plan(
      shouting([{ vehicleId: UP(V), driver1EmployeeId: UP(D) }]),
      'u1',
      {} as never,
    );
    expect(create).toHaveBeenCalledTimes(1);
    const written = create.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(String(written.vehicleId)).toBe(V);
    expect(String(written.driver1EmployeeId)).toBe(D);
  });

  it('a row whose crew is unchanged is still a no-op, however it is spelled', async () => {
    // Normalization must not make an identical row look different and trigger a pointless write.
    findForDate.mockResolvedValue([doc(V, D)]);
    const { changedCount } = await fleetRosterService.plan(
      shouting([{ vehicleId: UP(V), driver1EmployeeId: UP(D) }]),
      'u1',
      {} as never,
    );
    expect(changedCount).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });
});
