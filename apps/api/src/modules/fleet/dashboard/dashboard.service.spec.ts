// The landing screen's payload: what each reader is shown, and what the numbers mean.
//
// Two claims are load-bearing and neither is visible from a type:
//   • a section is present exactly when the caller may read the collection behind it — the
//     payload IS the permission model, so a reader cannot be handed a figure they could not have
//     asked the owning endpoint for;
//   • the figures are the aggregates the screen names — cars per type per branch, the company
//     row beside the branch rows, distance summed from the server-derived `km`, and the five at
//     each end of one ordering.
//
// The repositories are stubbed: this is about the composition, and every pipeline they run is
// exercised for real by the integration suite.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = {
  vehiclesByTypeAndBranch: vi.fn(),
  vehiclesByOperationAndBranch: vi.fn(),
  activeDriverProfiles: vi.fn(),
  kilometresByVehicle: vi.fn(),
  visitsBetween: vi.fn(),
  countVisitsBetween: vi.fn(),
  accidentsBetween: vi.fn(),
  countAccidentsBetween: vi.fn(),
  dueLicenses: vi.fn(),
};
const branches = { listAll: vi.fn() };
const types = { listAll: vi.fn() };
const catalog = { listKind: vi.fn(), namesByIds: vi.fn() };
const vehicles = { idsMatching: vi.fn(), codesByIds: vi.fn() };
const directory = { getDirectoryEmployees: vi.fn() };

vi.mock('./dashboard.repository', () => ({ fleetDashboardRepository: repo }));
vi.mock('../../../platform/organization/branches/branch.repository', () => ({
  branchRepository: branches,
}));
vi.mock('../vehicle-types/vehicle-type.repository', () => ({ fleetVehicleTypeRepository: types }));
vi.mock('../catalogs/catalog-item.repository', () => ({ fleetCatalogItemRepository: catalog }));
vi.mock('../vehicles/vehicle.repository', () => ({ fleetVehicleRepository: vehicles }));
vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployees: (ids: string[]) => directory.getDirectoryEmployees(ids),
}));

const { fleetDashboardService } = await import('./dashboard.service');

const B1 = '650000000000000000000101';
const B2 = '650000000000000000000102';
const T1 = '650000000000000000000201';
const T2 = '650000000000000000000202';
const OP_CASH = '650000000000000000000301';
const OP_ATM = '650000000000000000000302';
const V1 = '650000000000000000000001';
const V2 = '650000000000000000000002';
const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';

const ALL = {
  vehicles: { scope: 'organization' as const, userId: 'u1', branchId: null },
  drivers: { scope: 'organization' as const, userId: 'u1', branchId: null },
  odometer: { scope: 'organization' as const, userId: 'u1', branchId: null },
  maintenance: { scope: 'organization' as const, userId: 'u1', branchId: null },
  accidents: { scope: 'organization' as const, userId: 'u1', branchId: null },
} as never;

const NOW = new Date('2026-09-15T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  branches.listAll.mockResolvedValue([
    { _id: B1, name: { ar: 'المهندسين', en: 'Mohandessin' } },
    { _id: B2, name: { ar: 'أكتوبر', en: 'October' } },
  ]);
  types.listAll.mockResolvedValue([
    { _id: T1, name: { ar: 'مرسيدس', en: 'Mercedes' } },
    { _id: T2, name: { ar: 'تويوتا', en: 'Toyota' } },
  ]);
  catalog.listKind.mockResolvedValue([
    { _id: OP_CASH, name: { ar: 'نقل أموال', en: 'Cash transport' } },
    { _id: OP_ATM, name: { ar: 'ATM', en: 'ATM' } },
  ]);
  catalog.namesByIds.mockResolvedValue(new Map());
  vehicles.idsMatching.mockResolvedValue([]);
  vehicles.codesByIds.mockResolvedValue(new Map());
  directory.getDirectoryEmployees.mockResolvedValue(new Map());
  repo.vehiclesByTypeAndBranch.mockResolvedValue([]);
  repo.vehiclesByOperationAndBranch.mockResolvedValue([]);
  repo.activeDriverProfiles.mockResolvedValue([]);
  repo.kilometresByVehicle.mockResolvedValue([]);
  repo.visitsBetween.mockResolvedValue([]);
  repo.countVisitsBetween.mockResolvedValue(0);
  repo.accidentsBetween.mockResolvedValue([]);
  repo.countAccidentsBetween.mockResolvedValue(0);
  repo.dueLicenses.mockResolvedValue([]);
});

describe('a section is present exactly when its permission is held', () => {
  it('a reader with everything gets everything', async () => {
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.fleet).not.toBeNull();
    expect(dto.odometer).not.toBeNull();
    expect(dto.maintenance).not.toBeNull();
    expect(dto.accidents).not.toBeNull();
  });

  it('a workshop-only reader gets the workshop, and nothing about the registry', async () => {
    const dto = await fleetDashboardService.build(
      {
        vehicles: null,
        drivers: null,
        odometer: null,
        maintenance: { scope: 'organization', userId: 'u1', branchId: null },
        accidents: null,
      } as never,
      NOW,
    );
    expect(dto.maintenance, 'the section they may read').not.toBeNull();
    expect(dto.fleet, 'the registry is not theirs').toBeNull();
    expect(dto.odometer).toBeNull();
    expect(dto.accidents).toBeNull();
    // …and the registry pipelines were never even run for them.
    expect(repo.vehiclesByTypeAndBranch).not.toHaveBeenCalled();
    expect(repo.kilometresByVehicle).not.toHaveBeenCalled();
  });

  it('the branch list is always there — it names the columns every section refers to', async () => {
    const dto = await fleetDashboardService.build(
      { vehicles: null, drivers: null, odometer: null, maintenance: null, accidents: null } as never,
      NOW,
    );
    expect(dto.branches.map((b) => b.id)).toEqual([B1, B2]);
  });
});

describe('the fleet matrix', () => {
  it('counts each type per branch and totals the row', async () => {
    repo.vehiclesByTypeAndBranch.mockResolvedValue([
      { typeId: T1, branchId: B1, count: 47 },
      { typeId: T1, branchId: B2, count: 14 },
      { typeId: T2, branchId: B1, count: 4 },
    ]);
    const dto = await fleetDashboardService.build(ALL, NOW);
    const mercedes = dto.fleet?.types.find((t) => t.typeId === T1);
    expect(mercedes?.counts).toEqual({ [B1]: 47, [B2]: 14 });
    expect(mercedes?.total).toBe(61);
    expect(dto.fleet?.types.map((t) => t.typeId), 'biggest type first').toEqual([T1, T2]);
  });

  it('drops a count whose type no longer exists rather than inventing a row', async () => {
    repo.vehiclesByTypeAndBranch.mockResolvedValue([
      { typeId: '650000000000000000000999', branchId: B1, count: 3 },
    ]);
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.fleet?.types).toEqual([]);
  });
});

describe('branch statistics', () => {
  it('splits vehicles by OPERATION and drivers by SPECIALIZATION, per branch and overall', async () => {
    repo.vehiclesByOperationAndBranch.mockResolvedValue([
      { operationId: OP_CASH, branchId: B1, count: 10 },
      { operationId: OP_ATM, branchId: B1, count: 6 },
      { operationId: null, branchId: B1, count: 2 },
      { operationId: OP_CASH, branchId: B2, count: 4 },
    ]);
    repo.activeDriverProfiles.mockResolvedValue([
      { employeeId: E1, specialization: 'cashTransport' },
      { employeeId: E2, specialization: 'both' },
    ]);
    directory.getDirectoryEmployees.mockResolvedValue(
      new Map([
        [E1, { employeeId: E1, branchId: B1 }],
        [E2, { employeeId: E2, branchId: B2 }],
      ]),
    );

    const dto = await fleetDashboardService.build(ALL, NOW);
    const all = dto.fleet?.stats.find((s) => s.branchId === null);
    const one = dto.fleet?.stats.find((s) => s.branchId === B1);

    expect(all?.vehicles, 'every active car, classified or not').toBe(22);
    expect(all?.cashVehicles).toBe(14);
    expect(all?.atmVehicles).toBe(6);
    expect(all?.drivers).toBe(2);
    expect(all?.cashDrivers, '«both» counts in each').toBe(2);
    expect(all?.atmDrivers).toBe(1);

    expect(one?.vehicles).toBe(18);
    expect(one?.cashVehicles).toBe(10);
    expect(one?.atmVehicles).toBe(6);
    expect(one?.drivers, 'the driver in the other branch is not counted here').toBe(1);
  });

  it('leaves the driver figures at zero for a reader without the driver grant', async () => {
    repo.activeDriverProfiles.mockResolvedValue([{ employeeId: E1, specialization: 'atm' }]);
    const dto = await fleetDashboardService.build({ ...(ALL as object), drivers: null } as never, NOW);
    expect(repo.activeDriverProfiles, 'the profiles are never read').not.toHaveBeenCalled();
    expect(dto.fleet?.stats.find((s) => s.branchId === null)?.drivers).toBe(0);
  });

  it('keeps a branch with no vehicles in the list, at zero', async () => {
    repo.vehiclesByOperationAndBranch.mockResolvedValue([
      { operationId: OP_CASH, branchId: B1, count: 3 },
    ]);
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.fleet?.stats.find((s) => s.branchId === B2)?.vehicles).toBe(0);
  });
});

describe('kilometres', () => {
  it('sums per branch and ranks the five at each end of ONE ordering', async () => {
    repo.kilometresByVehicle.mockResolvedValue([
      { vehicleId: V1, branchId: B1, code: '529', km: 100_224 },
      { vehicleId: V2, branchId: B1, code: '297', km: 9_085 },
      { vehicleId: 'v3', branchId: B2, code: '531', km: 0 },
      { vehicleId: 'v4', branchId: B2, code: '534', km: 0 },
    ]);
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.odometer?.byBranch).toEqual([
      { branchId: B1, km: 109_309 },
      { branchId: B2, km: 0 },
    ]);
    expect(dto.odometer?.top.map((v) => v.code), 'highest first').toEqual(['529', '297', '531', '534']);
    expect(dto.odometer?.bottom.map((v) => v.code), 'lowest first').toEqual([
      '534',
      '531',
      '297',
      '529',
    ]);
  });

  it('counts a car that has driven nothing — that is what the bottom list is FOR', async () => {
    repo.kilometresByVehicle.mockResolvedValue([
      { vehicleId: V1, branchId: B1, code: '150', km: 500 },
      { vehicleId: V2, branchId: B1, code: '151', km: 0 },
    ]);
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.odometer?.bottom[0]).toEqual({ vehicleId: V2, code: '151', km: 0 });
  });
});

describe('today and this month', () => {
  it('asks for the DAY’s visits and the MONTH’s count, in UTC days', async () => {
    repo.countVisitsBetween.mockResolvedValue(22);
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.maintenance?.monthCount).toBe(22);
    const [dayFrom, dayTo] = repo.visitsBetween.mock.calls[0] as [Date, Date];
    expect(dayFrom.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(dayTo.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    const [monthFrom] = repo.countVisitsBetween.mock.calls[0] as [Date];
    expect(monthFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('names the workshop, the work type and the parts of today’s visits', async () => {
    repo.visitsBetween.mockResolvedValue([
      {
        _id: 'visit1',
        vehicleId: V1,
        workshopId: 'w1',
        workTypeId: 'wt1',
        sparePartIds: ['p1'],
        notes: 'ملاحظة',
      },
    ]);
    vehicles.codesByIds.mockResolvedValue(new Map([[V1, '150']]));
    catalog.namesByIds.mockResolvedValue(
      new Map([
        ['w1', { ar: 'مصنع', en: 'Factory' }],
        ['wt1', { ar: 'صيانة', en: 'Service' }],
        ['p1', { ar: 'فرامل', en: 'Brakes' }],
      ]),
    );
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.maintenance?.today[0]).toEqual({
      visitId: 'visit1',
      code: '150',
      workshop: { ar: 'مصنع', en: 'Factory' },
      workType: { ar: 'صيانة', en: 'Service' },
      spareParts: [{ ar: 'فرامل', en: 'Brakes' }],
      notes: 'ملاحظة',
    });
  });

  it('reports today’s accidents and the month’s tally', async () => {
    repo.accidentsBetween.mockResolvedValue([
      {
        _id: 'a1',
        vehicleId: V1,
        occurredAt: new Date('2026-09-15T08:00:00.000Z'),
        culprit: 'طرف ثالث',
        status: 'open',
      },
    ]);
    repo.countAccidentsBetween.mockResolvedValue(3);
    vehicles.codesByIds.mockResolvedValue(new Map([[V1, '150']]));
    const dto = await fleetDashboardService.build(ALL, NOW);
    expect(dto.accidents?.monthCount).toBe(3);
    expect(dto.accidents?.today[0]?.code).toBe('150');
    expect(dto.accidents?.today[0]?.status).toBe('open');
  });
});

describe('a branch-scoped reader sees their branch', () => {
  it('narrows every registry pipeline to it', async () => {
    await fleetDashboardService.build(
      {
        vehicles: { scope: 'branch', userId: 'u1', branchId: B2 },
        drivers: null,
        odometer: { scope: 'branch', userId: 'u1', branchId: B2 },
        maintenance: null,
        accidents: null,
      } as never,
      NOW,
    );
    const [match] = repo.vehiclesByTypeAndBranch.mock.calls[0] as [Record<string, unknown>];
    expect(String(match.branchId)).toBe(B2);
    const [kmMatch] = repo.kilometresByVehicle.mock.calls[0] as [Record<string, unknown>];
    expect(String(kmMatch.branchId)).toBe(B2);
  });

  it('and a reader placed in NO branch sees no branch, rather than all of them', async () => {
    await fleetDashboardService.build(
      {
        vehicles: { scope: 'branch', userId: 'u1', branchId: null },
        drivers: null,
        odometer: null,
        maintenance: null,
        accidents: null,
      } as never,
      NOW,
    );
    const [match] = repo.vehiclesByTypeAndBranch.mock.calls[0] as [Record<string, unknown>];
    expect(String(match.branchId), 'a branch id nothing carries').toBe(
      '000000000000000000000000',
    );
  });
});
