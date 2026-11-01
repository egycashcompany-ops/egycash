// «عايز فى شاشة الأصول تزودلى بعد الحالة لو متسلم اسم الشخص اللى متسلمله الحاجة · وعايز فى الفلتر
// زود بعد الحالات وقبل الفئة (الاسم) ويكون Drop Down مع قابليه للكتابة» — the asset register names
// who holds each asset, and filters by the register's own names.
//
// With the data layer mocked, what is pinned is what is decided: the holder is the OPEN interval the
// asset itself points at and nothing else; a person the directory cannot name keeps their id; a page
// costs one interval read and one directory batch whatever its length; the name filter matches a
// name exactly, beside the other filters; and the names offered are the reader's scope's, in Arabic
// order, bounded.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ListItAssetsQuery } from '@ecms/contracts';
import { type DirectoryEmployee } from '../../../platform/directory';
import { toItAssetDto, type ItAssetHolderLabels } from '../it.mappers';
import { type ItAssetDoc } from './asset.model';
import { type ItAssetAssignmentDoc } from './assignment.model';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  distinctNames: vi.fn(),
  findIntervals: vi.fn(),
  getDirectoryEmployees: vi.fn(),
}));

vi.mock('../../../platform/directory', () => ({
  getDirectoryEmployees: mocks.getDirectoryEmployees,
}));
vi.mock('./asset.repository', () => ({
  itAssetRepository: { list: mocks.list, distinctNames: mocks.distinctNames },
}));
vi.mock('./assignment.repository', () => ({
  itAssetAssignmentRepository: { findByIdsSystem: mocks.findIntervals },
}));

const { itAssetService, ASSET_NAMES_CAP } = await import('./asset.service');

const at = new Date('2026-10-20T09:00:00.000Z');
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

const interval = (
  assetId: Types.ObjectId,
  over: Partial<ItAssetAssignmentDoc> = {},
): ItAssetAssignmentDoc =>
  ({
    _id: new Types.ObjectId(),
    assetId,
    assignedToEmployeeId: EMPLOYEE,
    assignedByUserId: null,
    assignedAt: at,
    conditionOnIssue: null,
    expectedReturnAt: null,
    returnedAt: null,
    returnedToUserId: null,
    conditionOnReturn: null,
    notes: null,
    branchId: new Types.ObjectId(),
    receiptId: null,
    isDeleted: false,
    __v: 0,
    createdAt: at,
    updatedAt: at,
    ...over,
  }) as ItAssetAssignmentDoc;

const asset = (over: Partial<ItAssetDoc> = {}): ItAssetDoc =>
  ({
    _id: new Types.ObjectId(),
    assetCode: 'AST-00012',
    name: 'Lenovo ThinkCentre neo 50a 24',
    description: null,
    categoryId: new Types.ObjectId(),
    status: 'inStock',
    serialNumber: null,
    model: null,
    manufacturer: null,
    externalTag: null,
    branchId: new Types.ObjectId(),
    location: null,
    purchase: null,
    warranty: null,
    currentAssignmentId: null,
    disposal: null,
    notes: null,
    specs: null,
    accessories: [],
    isDeleted: false,
    __v: 0,
    createdAt: at,
    updatedAt: at,
    ...over,
  }) as ItAssetDoc;

/** An asset out with somebody: the asset, and the open interval it points at. */
const heldBy = (employee: Types.ObjectId) => {
  const id = new Types.ObjectId();
  const open = interval(id, { assignedToEmployeeId: employee });
  return { doc: asset({ _id: id, status: 'assigned', currentAssignmentId: open._id }), open };
};

const labels = (
  intervals: readonly ItAssetAssignmentDoc[],
  employees: readonly [string, { code: string; fullNameAr: string }][] = [],
): ItAssetHolderLabels => ({
  intervals: new Map(intervals.map((row) => [String(row._id), row])),
  employees: new Map(employees),
});

const person = (id: Types.ObjectId, code: string, fullNameAr: string): DirectoryEmployee => ({
  employeeId: String(id),
  code,
  fullNameAr,
  status: 'active',
  branchId: null,
  departmentId: null,
  phone: null,
  governorate: null,
  hiredAt: null,
  address: null,
});

const MOHAMED = { code: '0100052', fullNameAr: 'محمد أحمد علي' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the holder an asset row names', () => {
  it('is the employee of the open interval the asset points at, and when they received it', () => {
    const { doc, open } = heldBy(EMPLOYEE);
    const dto = toItAssetDto(doc, labels([open], [[String(EMPLOYEE), MOHAMED]]));
    expect(dto.holder).toEqual({
      employeeId: String(EMPLOYEE),
      employeeCode: '0100052',
      employeeName: 'محمد أحمد علي',
      assignedAt: '2026-10-20T09:00:00.000Z',
    });
  });

  /** The screen then shows the id, as the custody register does — a reference beats a guess. */
  it('keeps the id when the directory cannot name the employee — nulls, never a guess', () => {
    const { doc, open } = heldBy(LEAVER);
    expect(toItAssetDto(doc, labels([open])).holder).toEqual({
      employeeId: String(LEAVER),
      employeeCode: null,
      employeeName: null,
      assignedAt: '2026-10-20T09:00:00.000Z',
    });
  });

  it('is nobody for an asset in stock', () => {
    expect(toItAssetDto(asset(), labels([])).holder).toBeNull();
  });

  it('is nobody once the interval is closed, even while the asset still points at it', () => {
    const { doc, open } = heldBy(EMPLOYEE);
    const closed = { ...open, returnedAt: new Date('2026-10-21T09:00:00.000Z') };
    expect(toItAssetDto(doc, labels([closed], [[String(EMPLOYEE), MOHAMED]])).holder).toBeNull();
  });

  it('is nobody when the asset points elsewhere — an open interval it does not name holds nothing', () => {
    const { doc, open } = heldBy(EMPLOYEE);
    const stale = { ...doc, currentAssignmentId: new Types.ObjectId() };
    expect(toItAssetDto(stale, labels([open], [[String(EMPLOYEE), MOHAMED]])).holder).toBeNull();
  });

  it('is nobody for a deleted interval, or for an interval that is another asset’s', () => {
    const { doc, open } = heldBy(EMPLOYEE);
    const named = labels([{ ...open, isDeleted: true }], [[String(EMPLOYEE), MOHAMED]]);
    expect(toItAssetDto(doc, named).holder).toBeNull();
    const elsewhere = labels(
      [{ ...open, assetId: new Types.ObjectId() }],
      [[String(EMPLOYEE), MOHAMED]],
    );
    expect(toItAssetDto(doc, elsewhere).holder).toBeNull();
  });
});

describe('resolving the holders of a response', () => {
  it('reads every interval the page points at in ONE read, and its people in ONE batch', async () => {
    const first = heldBy(EMPLOYEE);
    const second = heldBy(EMPLOYEE);
    const third = heldBy(LEAVER);
    const page = [first.doc, asset(), second.doc, third.doc];
    mocks.findIntervals.mockResolvedValue([first.open, second.open, third.open]);
    // The leaver is not in the directory's answer.
    mocks.getDirectoryEmployees.mockResolvedValue(
      new Map([[String(EMPLOYEE), person(EMPLOYEE, MOHAMED.code, MOHAMED.fullNameAr)]]),
    );

    const holders = await itAssetService.holderLabels(page);

    expect(mocks.findIntervals).toHaveBeenCalledTimes(1);
    expect(mocks.findIntervals).toHaveBeenCalledWith([
      String(first.open._id),
      String(second.open._id),
      String(third.open._id),
    ]);
    expect(mocks.getDirectoryEmployees).toHaveBeenCalledTimes(1);
    expect(mocks.getDirectoryEmployees).toHaveBeenCalledWith([String(EMPLOYEE), String(LEAVER)]);
    expect(page.map((doc) => toItAssetDto(doc, holders).holder?.employeeName ?? null)).toEqual([
      'محمد أحمد علي',
      null,
      'محمد أحمد علي',
      null,
    ]);
    expect(toItAssetDto(third.doc, holders).holder?.employeeId).toBe(String(LEAVER));
  });

  it('drops a closed or deleted interval before the directory is asked about anybody', async () => {
    const returned = heldBy(EMPLOYEE);
    const deleted = heldBy(LEAVER);
    mocks.findIntervals.mockResolvedValue([
      { ...returned.open, returnedAt: at },
      { ...deleted.open, isDeleted: true },
    ]);

    const holders = await itAssetService.holderLabels([returned.doc, deleted.doc]);

    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
    expect(toItAssetDto(returned.doc, holders).holder).toBeNull();
    expect(toItAssetDto(deleted.doc, holders).holder).toBeNull();
  });

  it('asks the directory nothing for a page that is all in stock', async () => {
    mocks.findIntervals.mockResolvedValue([]);
    const holders = await itAssetService.holderLabels([asset(), asset()]);
    expect(mocks.getDirectoryEmployees).not.toHaveBeenCalled();
    expect(holders.intervals.size).toBe(0);
  });
});

describe('the name filter', () => {
  const scope = { scope: 'organization' } as never;
  const BRANCH = String(new Types.ObjectId());
  const query = (over: Partial<ListItAssetsQuery>): ListItAssetsQuery =>
    ({ page: 1, pageSize: 25, ...over }) as ListItAssetsQuery;
  const filterSent = (): Record<string, unknown> =>
    (mocks.list.mock.calls[0]?.[0] as { filter: Record<string, unknown> }).filter;

  beforeEach(() => {
    mocks.list.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
    });
  });

  it('matches the picked name EXACTLY, beside the status and the branch', async () => {
    await itAssetService.list(
      query({ name: 'Lenovo ThinkCentre neo 50a 24', status: 'inStock', branchId: BRANCH }),
      scope,
    );
    expect(filterSent()).toEqual({
      name: 'Lenovo ThinkCentre neo 50a 24',
      status: 'inStock',
      branchId: new Types.ObjectId(BRANCH),
    });
  });

  /** A pick means every asset by THAT name — not «Lenovo ThinkCentre neo 50a 24 Gen 5» too. */
  it('is an equality, not a search — and still narrows what a search finds', async () => {
    await itAssetService.list(query({ name: 'طابعة', search: 'HP' }), scope);
    const filter = filterSent();
    expect(filter.name).toBe('طابعة');
    expect(filter.$or).toHaveLength(4);
  });

  it('asks nothing of the name when none is picked', async () => {
    await itAssetService.list(query({ status: 'assigned' }), scope);
    expect(filterSent()).not.toHaveProperty('name');
  });
});

describe('the names the filter offers', () => {
  const scope = { scope: 'branch' } as never;

  it('are the reader’s scope’s, in Arabic order — Arabic before Latin, then the alphabet', async () => {
    mocks.distinctNames.mockResolvedValue([
      'Lenovo ThinkCentre neo 50a 24',
      'ماوس لاسلكي',
      'HP LaserJet',
      'شاشة Dell',
      'طابعة',
    ]);
    expect(await itAssetService.names(scope)).toEqual({
      names: ['شاشة Dell', 'طابعة', 'ماوس لاسلكي', 'HP LaserJet', 'Lenovo ThinkCentre neo 50a 24'],
    });
    expect(mocks.distinctNames).toHaveBeenCalledWith(scope);
  });

  it('leave out what is not a name', async () => {
    mocks.distinctNames.mockResolvedValue([null, '', '   ', 42, 'طابعة']);
    expect(await itAssetService.names(scope)).toEqual({ names: ['طابعة'] });
  });

  it('are bounded — a list typed into, never a dump', async () => {
    const many = Array.from(
      { length: ASSET_NAMES_CAP + 5 },
      (_, i) => `جهاز ${String(i).padStart(4, '0')}`,
    ).reverse();
    mocks.distinctNames.mockResolvedValue(many);
    const { names } = await itAssetService.names(scope);
    expect(names).toHaveLength(ASSET_NAMES_CAP);
    expect(names[0]).toBe('جهاز 0000');
    expect(names.at(-1)).toBe(`جهاز ${String(ASSET_NAMES_CAP - 1).padStart(4, '0')}`);
  });
});
