// R-11 / T4.6 — «أوراق مفتوحة»: the board's open insurance and tax papers, counted WITHOUT writing.
//
// `GET /fleet/licensing` sweeps the voided marks on every read — it writes — and a dashboard that
// refreshes every few minutes must never do that. So `openPaperCounts` reads the same cars (the
// «ت» classes, under the reader's scope) and the same live marks, counts with the contracts'
// `paperStage` — the rule the board's colours and its stats bar read — and touches nothing.
//
// Proved two ways: every write the licensing module can make is spied and must stay uncalled, and
// the counts equal the board's own stats bar computed over `board()`'s rows for the same world.
//
// `paperStagesFor` is the same rule per car for «أقرب تراخيص السيارات»'s «أوراق الترخيص» column:
// only the listed cars that are ON the board (a «ت» class, under the reader's scope), each paper's
// `paperStage` from the same live marks — read-only too.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLEET_LICENSING_PAPERS, paperStage } from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { FleetVehicleLicensingModel, type FleetVehicleLicensingDoc } from './licensing.model';
import { fleetVehicleLicensingRepository } from './licensing.repository';
import { fleetLicensingService } from './licensing.service';

const SCOPE = {
  scope: 'branch',
  userId: new Types.ObjectId().toString(),
  branchId: new Types.ObjectId().toString(),
  departmentId: null,
  sectionId: null,
} as ScopeSelector;

const T_CLASS = new Types.ObjectId();
const M_CLASS = new Types.ObjectId();

const car = (code: string): FleetVehicleDoc =>
  ({
    _id: new Types.ObjectId(),
    code,
    plateNumber: `ل ${code}`,
    chassisNumber: `CH${code}`,
    licenseClassId: T_CLASS,
    licenseExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  }) as unknown as FleetVehicleDoc;

const mark = (
  vehicle: FleetVehicleDoc,
  ticks: Partial<
    Record<'insuranceHandover' | 'insuranceReceipt' | 'taxHandover' | 'taxReceipt', boolean>
  >,
): FleetVehicleLicensingDoc =>
  ({
    _id: new Types.ObjectId(),
    vehicleId: vehicle._id,
    insuranceHandover: false,
    insuranceReceipt: false,
    taxHandover: false,
    taxReceipt: false,
    ...ticks,
  }) as unknown as FleetVehicleLicensingDoc;

const cars = ['150', '151', '152', '153', '154', '155'].map(car);
const marks = [
  mark(cars[0]!, { insuranceHandover: true }), // insurance open
  mark(cars[1]!, { insuranceHandover: true, insuranceReceipt: true }), // insurance done
  mark(cars[2]!, { insuranceReceipt: true, taxHandover: true }), // receipt without handover = open; tax open
  mark(cars[3]!, { taxHandover: true, taxReceipt: true }), // tax done
  mark(cars[4]!, { taxReceipt: true }), // tax open
  // cars[5]: nobody ticked anything — four falses, no row.
];

let listedWith: unknown[] = [];
/** Every write the module can make, spied — `expect` reads each one as a mock. */
let writes: unknown[] = [];

beforeEach(() => {
  listedWith = [];
  vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([
    { _id: T_CLASS, name: { ar: 'برقاش ت', en: 'B T' } },
    { _id: M_CLASS, name: { ar: 'برقاش م', en: 'B M' } },
  ] as never);
  vi.spyOn(fleetVehicleRepository, 'listVehicles').mockImplementation(async (params) => {
    listedWith.push(params);
    return {
      items: cars,
      meta: { page: 1, pageSize: 100, totalItems: cars.length, totalPages: 1 },
    };
  });
  vi.spyOn(fleetVehicleLicensingRepository, 'findForVehicles').mockImplementation(
    async (ids: readonly string[]) => marks.filter((row) => ids.includes(String(row.vehicleId))),
  );
  // The sweep's own read, answered so `board()` can run beside it in this file.
  vi.spyOn(fleetVehicleLicensingRepository, 'markedVehicleIds').mockResolvedValue([]);
  writes = [
    vi.spyOn(fleetVehicleLicensingRepository, 'voidForVehicles'),
    vi.spyOn(fleetVehicleLicensingRepository, 'setMark'),
    vi.spyOn(FleetVehicleLicensingModel, 'updateMany'),
    vi.spyOn(FleetVehicleLicensingModel, 'updateOne'),
    vi.spyOn(FleetVehicleLicensingModel, 'findOneAndUpdate'),
    vi.spyOn(FleetVehicleLicensingModel, 'insertMany'),
    vi.spyOn(FleetVehicleLicensingModel, 'bulkWrite'),
    vi.spyOn(FleetVehicleLicensingModel, 'deleteMany'),
  ];
});

afterEach(() => vi.restoreAllMocks());

describe('openPaperCounts — R-11', () => {
  it('counts a paper OPEN when exactly one of its two ticks is set', async () => {
    expect(await fleetLicensingService.openPaperCounts(SCOPE)).toEqual({ insurance: 2, tax: 2 });
  });

  it('performs NO write — not the sweep, not a mark, not a model write', async () => {
    await fleetLicensingService.openPaperCounts(SCOPE);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(
      fleetVehicleLicensingRepository.markedVehicleIds,
      'not even the sweep’s read',
    ).not.toHaveBeenCalled();
  });

  it('reads the board’s cars — the «ت» classes, under the reader’s scope', async () => {
    await fleetLicensingService.openPaperCounts(SCOPE);
    const params = listedWith[0] as { scope: ScopeSelector; filter: unknown };
    expect(params.scope).toBe(SCOPE);
    const filter = JSON.stringify(params.filter);
    expect(filter).toContain(String(T_CLASS));
    expect(filter, 'a «م» class is not on the board').not.toContain(String(M_CLASS));
  });

  it('equals the board’s own stats bar for the same world', async () => {
    const rows = await fleetLicensingService.board(SCOPE);
    const [insurance, tax] = FLEET_LICENSING_PAPERS.map(
      (paper) => rows.filter((row) => paperStage(row, paper) === 'open').length,
    );
    expect(await fleetLicensingService.openPaperCounts(SCOPE)).toEqual({ insurance, tax });
  });

  it('no «ت» class at all is an empty board — zero, and no registry read', async () => {
    vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([
      { _id: M_CLASS, name: { ar: 'برقاش م', en: 'B M' } },
    ] as never);
    expect(await fleetLicensingService.openPaperCounts(SCOPE)).toEqual({ insurance: 0, tax: 0 });
    expect(listedWith).toEqual([]);
  });
});

describe('paperStagesFor — «أوراق الترخيص» beside «أقرب تراخيص السيارات»', () => {
  const ids = (list: readonly FleetVehicleDoc[]) => list.map((vehicle) => String(vehicle._id));
  /** The registry answers which of the asked cars it holds on the board (`onBoard`). */
  let askedWith: unknown[][] = [];
  const boardHolds = (onBoard: readonly FleetVehicleDoc[]) =>
    vi
      .spyOn(fleetVehicleRepository, 'idsOfClassesInScope')
      .mockImplementation(async (scope, vehicleIds, classIds) => {
        askedWith.push([scope, vehicleIds, classIds]);
        return new Set(ids(onBoard).filter((id) => vehicleIds.includes(id)));
      });
  beforeEach(() => {
    askedWith = [];
  });

  it('gives each board car both stages — the rule `openPaperCounts` counts by', async () => {
    boardHolds(cars);
    const stages = await fleetLicensingService.paperStagesFor(SCOPE, ids(cars));
    expect(ids(cars).map((id) => stages.get(id))).toEqual([
      { insurance: 'open', tax: 'none' },
      { insurance: 'done', tax: 'none' },
      { insurance: 'open', tax: 'open' },
      { insurance: 'none', tax: 'done' },
      { insurance: 'none', tax: 'open' },
      // Nobody ticked anything: four falses, no row.
      { insurance: 'none', tax: 'none' },
    ]);
    const open = { insurance: 0, tax: 0 };
    for (const stage of stages.values()) {
      if (stage.insurance === 'open') open.insurance += 1;
      if (stage.tax === 'open') open.tax += 1;
    }
    expect(open).toEqual(await fleetLicensingService.openPaperCounts(SCOPE));
  });

  it('asks only about the listed cars, the board’s classes, under the reader’s scope — a car off it is absent', async () => {
    const elsewhere = car('300');
    boardHolds(cars.slice(0, 2));
    const stages = await fleetLicensingService.paperStagesFor(SCOPE, [
      ...ids(cars.slice(0, 2)),
      String(elsewhere._id),
    ]);
    expect([...stages.keys()]).toEqual(ids(cars.slice(0, 2)));
    expect(askedWith).toEqual([
      [SCOPE, [...ids(cars.slice(0, 2)), String(elsewhere._id)], [String(T_CLASS)]],
    ]);
    // Never the whole board: no list of its cars is read.
    expect(listedWith).toEqual([]);
    // The marks of the cars on it only.
    expect(fleetVehicleLicensingRepository.findForVehicles).toHaveBeenCalledWith(
      ids(cars.slice(0, 2)),
    );
  });

  it('performs NO write, and asks nothing for no cars or a board with no «ت» class', async () => {
    boardHolds(cars);
    await fleetLicensingService.paperStagesFor(SCOPE, ids(cars));
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(fleetVehicleLicensingRepository.markedVehicleIds).not.toHaveBeenCalled();

    askedWith = [];
    expect((await fleetLicensingService.paperStagesFor(SCOPE, [])).size).toBe(0);
    vi.spyOn(fleetCatalogItemRepository, 'listKind').mockResolvedValue([
      { _id: M_CLASS, name: { ar: 'برقاش م', en: 'B M' } },
    ] as never);
    expect((await fleetLicensingService.paperStagesFor(SCOPE, ids(cars))).size).toBe(0);
    expect(askedWith).toEqual([]);
  });
});
