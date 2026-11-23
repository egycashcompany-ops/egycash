// «المواقع» — each branch's places (design §2): «أعينها فى مكان بس تبقى على عهده الإدارة .. زى
// السيرفرات والكاميرات والسويتشات» (the owner, 2026-11-19).
//
// With the data layer mocked, what is pinned is what the service decides: a write names a branch
// `itCatalog.manage` reaches as a whole (403 otherwise) and a live one (400 `body.branchId
// UNKNOWN`); one Arabic name per branch, trimmed (409); a place keeps its branch; retiring is
// refused while assets are held there (409, the count in the message) and nothing else blocks it;
// the tab's list reads under the key's scope and counts «في عهدته الآن» under `itAsset.view` —
// null without it. The HTTP edge and real rows are `tests/integration/it-locations.spec.ts`.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CreateItLocationSchema,
  ListItLocationsQuerySchema,
  UpdateItLocationSchema,
} from '@ecms/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { toItLocationDto, toItLocationOptionDto } from '../it.mappers';
import { type ItLocationDoc } from './location.model';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  publish: vi.fn(),
  branchFindById: vi.fn(),
  branchListAll: vi.fn(),
  findByBranchAndNameAr: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  updateById: vi.fn(),
  list: vi.fn(),
  listOptions: vi.fn(),
  countOpenByLocations: vi.fn(),
  countOpenAt: vi.fn(),
}));

vi.mock('../../../platform/audit', () => ({ auditService: { record: mocks.audit } }));
vi.mock('../../../platform/realtime', () => ({ publishAuditedChange: mocks.publish }));
vi.mock('../../../platform/organization', () => ({
  branchRepository: { findById: mocks.branchFindById, listAll: mocks.branchListAll },
}));
vi.mock('./location.repository', () => ({
  itLocationRepository: {
    findByBranchAndNameAr: mocks.findByBranchAndNameAr,
    create: mocks.create,
    findById: mocks.findById,
    updateById: mocks.updateById,
    list: mocks.list,
    listOptions: mocks.listOptions,
  },
  heldAtLocationReader: {
    countOpenByLocations: mocks.countOpenByLocations,
    countOpenAt: mocks.countOpenAt,
  },
}));

const { heldAtPlaceMessage, heldOf, itLocationService } = await import('./location.service');

const BRANCH_A = String(new Types.ObjectId());
const BRANCH_B = String(new Types.ObjectId());
const BY = String(new Types.ObjectId());
const AT = new Date('2026-11-19T09:00:00.000Z');

const ctxOf = (permissions: AuthContext['permissions'], branchId = BRANCH_A): AuthContext => ({
  userId: BY,
  sessionId: 'spec',
  branchId,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions,
  permissionVersion: 1,
  isPrivileged: false,
});

/** The catalogs administrator company-wide — and a reader of the assets. */
const ADMIN = ctxOf({ 'itCatalog.manage': 'organization', 'itAsset.view': 'organization' });
/** A branch's catalog keeper, placed in A — the key reaches A alone; no `itAsset.view`. */
const KEEPER_A = ctxOf({ 'itCatalog.manage': 'branch' });

const place = (over: Partial<ItLocationDoc> = {}): ItLocationDoc => ({
  _id: new Types.ObjectId(),
  branchId: new Types.ObjectId(BRANCH_A),
  name: { ar: 'غرفة السيرفرات', en: 'Server room' },
  code: 'SRV',
  description: null,
  sortOrder: 10,
  isActive: true,
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: AT,
  updatedAt: AT,
  __v: 0,
  ...over,
});

const auditedChanges = () =>
  (mocks.audit.mock.calls[0]?.[0] as { changes: { field: string; old: unknown; new: unknown }[] })
    .changes;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.findByBranchAndNameAr.mockResolvedValue(null);
  mocks.branchFindById.mockResolvedValue({ _id: new Types.ObjectId(BRANCH_A), status: 'active' });
  mocks.countOpenAt.mockResolvedValue(0);
});

describe('adding a place to a branch', () => {
  const input = (over: Record<string, unknown> = {}) =>
    CreateItLocationSchema.parse({
      branchId: BRANCH_A,
      name: { ar: '  غرفة السيرفرات ', en: ' Server room ' },
      ...over,
    });

  it('files it in the branch, active, with its name trimmed — audited, and signalled to the branch', async () => {
    mocks.create.mockImplementation(async (data: Partial<ItLocationDoc>) => place(data));

    const doc = await itLocationService.create(input(), ADMIN);

    expect(mocks.findByBranchAndNameAr).toHaveBeenCalledWith(BRANCH_A, 'غرفة السيرفرات');
    expect(mocks.create).toHaveBeenCalledWith(
      {
        branchId: new Types.ObjectId(BRANCH_A),
        name: { ar: 'غرفة السيرفرات', en: 'Server room' },
        code: null,
        description: null,
        sortOrder: 0,
        isActive: true,
      },
      { by: BY },
    );
    expect(doc.isActive).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'location', entityId: String(doc._id) },
        action: 'create',
      }),
    );
    expect(auditedChanges()).toContainEqual({ field: 'branchId', old: null, new: BRANCH_A });
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        entityRef: { moduleId: 'it', entityType: 'location', entityId: String(doc._id) },
        branchId: BRANCH_A,
      }),
    );
  });

  it('lets a branch keeper add one in the branch the key reaches', async () => {
    mocks.create.mockImplementation(async (data: Partial<ItLocationDoc>) => place(data));
    await itLocationService.create(input({ code: 'CAM' }), KEEPER_A);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'CAM' }), {
      by: BY,
    });
  });

  it('refuses a branch the key does not reach — 403, before anything is read', async () => {
    const refusal = itLocationService.create(input({ branchId: BRANCH_B }), KEEPER_A);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.branchFindById).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['inactive', { _id: new Types.ObjectId(BRANCH_A), status: 'inactive' }],
  ])('refuses an %s branch — body.branchId UNKNOWN', async (_label, branch) => {
    mocks.branchFindById.mockResolvedValue(branch);
    const refusal = itLocationService.create(input(), ADMIN);
    await expect(refusal).rejects.toBeInstanceOf(ValidationError);
    await expect(refusal).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'body.branchId', code: 'UNKNOWN' })],
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a name the branch already has — 409, naming it', async () => {
    mocks.findByBranchAndNameAr.mockResolvedValue(place());
    const refusal = itLocationService.create(input(), ADMIN);
    await expect(refusal).rejects.toBeInstanceOf(ConflictError);
    await expect(refusal).rejects.toMatchObject({
      httpStatus: 409,
      message: '"غرفة السيرفرات" is already a place in this branch',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a name that is only spaces — the contract counts them, the service does not', async () => {
    const refusal = itLocationService.create(input({ name: { ar: '   ', en: 'Room' } }), ADMIN);
    await expect(refusal).rejects.toMatchObject({
      details: [expect.objectContaining({ field: 'body.name.ar', code: 'REQUIRED' })],
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('editing, retiring and bringing back a place', () => {
  const patch = (over: Record<string, unknown>) =>
    UpdateItLocationSchema.parse({ version: 0, ...over });

  it('answers 404 for a place that does not exist', async () => {
    mocks.findById.mockResolvedValue(null);
    await expect(
      itLocationService.update(String(new Types.ObjectId()), patch({ sortOrder: 1 }), ADMIN),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a place in a branch the key does not reach — 403, nothing written', async () => {
    const before = place({ branchId: new Types.ObjectId(BRANCH_B) });
    mocks.findById.mockResolvedValue(before);
    await expect(
      itLocationService.update(String(before._id), patch({ sortOrder: 1 }), KEEPER_A),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.updateById).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('writes only what the body names, at its version — and audits the difference', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue({ ...before, code: null, description: 'الدور الثاني' });

    await itLocationService.update(
      String(before._id),
      patch({ code: null, description: 'الدور الثاني', version: 3 }),
      KEEPER_A,
    );

    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { code: null, description: 'الدور الثاني' },
      { by: BY, version: 3 },
    );
    expect(auditedChanges()).toEqual([
      { field: 'code', old: 'SRV', new: null },
      { field: 'description', old: null, new: 'الدور الثاني' },
    ]);
    expect(mocks.countOpenAt).not.toHaveBeenCalled();
  });

  it('refuses a rename to a name another place of the branch holds — 409', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.findByBranchAndNameAr.mockResolvedValue(
      place({ name: { ar: 'غرفة الكاميرات', en: 'x' } }),
    );

    const refusal = itLocationService.update(
      String(before._id),
      patch({ name: { ar: 'غرفة الكاميرات ', en: 'Camera room' } }),
      ADMIN,
    );
    await expect(refusal).rejects.toMatchObject({
      httpStatus: 409,
      message: '"غرفة الكاميرات" is already a place in this branch',
    });
    expect(mocks.findByBranchAndNameAr).toHaveBeenCalledWith(
      BRANCH_A,
      'غرفة الكاميرات',
      String(before._id),
    );
    expect(mocks.updateById).not.toHaveBeenCalled();
  });

  it('asks nothing when the Arabic name is unchanged — only the English one moved', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue(before);
    await itLocationService.update(
      String(before._id),
      patch({ name: { ar: 'غرفة السيرفرات', en: 'Servers' } }),
      ADMIN,
    );
    expect(mocks.findByBranchAndNameAr).not.toHaveBeenCalled();
    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { name: { ar: 'غرفة السيرفرات', en: 'Servers' } },
      { by: BY, version: 0 },
    );
  });

  it('turns a rename the unique index refused (a race) into the same 409', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.updateById.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    await expect(
      itLocationService.update(
        String(before._id),
        patch({ name: { ar: 'غرفة الشبكة', en: 'Network room' } }),
        ADMIN,
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      message: '"غرفة الشبكة" is already a place in this branch',
    });
  });

  it('refuses to retire a place while assets are held there — 409 with the count', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.countOpenAt.mockResolvedValue(3);

    const refusal = itLocationService.update(String(before._id), patch({ isActive: false }), ADMIN);
    await expect(refusal).rejects.toBeInstanceOf(ConflictError);
    await expect(refusal).rejects.toMatchObject({
      message: '3 assets are held at this place; transfer or return them first',
    });
    expect(mocks.countOpenAt).toHaveBeenCalledWith(String(before._id));
    expect(mocks.updateById).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('retires a place nothing is held at — audited true → false', async () => {
    const before = place();
    mocks.findById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue({ ...before, isActive: false });

    const doc = await itLocationService.update(
      String(before._id),
      patch({ isActive: false }),
      ADMIN,
    );

    expect(doc.isActive).toBe(false);
    expect(auditedChanges()).toEqual([{ field: 'isActive', old: true, new: false }]);
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ branchId: BRANCH_A }));
  });

  it.each([
    ['bringing a retired place back', false, true],
    ['retiring one already retired', false, false],
  ])('counts nothing when %s', async (_label, wasActive, isActive) => {
    const before = place({ isActive: wasActive });
    mocks.findById.mockResolvedValue(before);
    mocks.updateById.mockResolvedValue({ ...before, isActive });
    await itLocationService.update(String(before._id), patch({ isActive }), ADMIN);
    expect(mocks.countOpenAt).not.toHaveBeenCalled();
    expect(mocks.updateById).toHaveBeenCalledWith(
      String(before._id),
      { isActive },
      { by: BY, version: 0 },
    );
  });
});

describe('the catalogs tab', () => {
  const page = (items: ItLocationDoc[]) => ({
    items,
    meta: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 },
  });

  it('filters by branch, status and a search over both names and the code, under the key’s scope', async () => {
    mocks.list.mockResolvedValue(page([]));
    const query = ListItLocationsQuerySchema.parse({
      branchId: BRANCH_B,
      isActive: 'true',
      search: 'غرفة ٢',
    });

    await itLocationService.list(query, KEEPER_A);

    const params = mocks.list.mock.calls[0]?.[0] as {
      filter: { $and: Record<string, unknown>[] };
      scope: { scope: string; branchId: string };
      sorts?: unknown;
    };
    expect(params.filter.$and[0]).toEqual({ branchId: new Types.ObjectId(BRANCH_B) });
    expect(params.filter.$and[1]).toEqual({ isActive: true });
    const search = params.filter.$and[2] as { $or: Record<string, RegExp>[] };
    expect(search.$or.map((clause) => Object.keys(clause)[0])).toEqual([
      'name.ar',
      'name.en',
      'code',
    ]);
    // A digit is found in every digit set: «٢» finds «غرفة 2».
    expect(search.$or[0]?.['name.ar']?.test('غرفة 2')).toBe(true);
    expect(params.scope).toMatchObject({ scope: 'branch', branchId: BRANCH_A });
    // No column chosen: a branch's places in their own order.
    expect(params.sorts).toEqual([
      { by: 'branchId', dir: 'asc' },
      { by: 'sortOrder', dir: 'asc' },
      { by: 'name.ar', dir: 'asc' },
    ]);
  });

  it('sorts by the column the reader chose, and by nothing else', async () => {
    mocks.list.mockResolvedValue(page([]));
    await itLocationService.list(
      ListItLocationsQuerySchema.parse({ sortBy: 'code', sortDir: 'asc' }),
      ADMIN,
    );
    const params = mocks.list.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({ filter: {}, sortBy: 'code', sortDir: 'asc' });
    expect(params.sorts).toBeUndefined();
  });

  it('counts «في عهدته الآن» under the reader’s itAsset.view — 0 for a place holding nothing', async () => {
    const servers = place();
    const cameras = place({ name: { ar: 'غرفة الكاميرات', en: 'Camera room' } });
    mocks.list.mockResolvedValue(page([servers, cameras]));
    mocks.countOpenByLocations.mockResolvedValue(new Map([[String(servers._id), 4]]));

    const { held } = await itLocationService.list(ListItLocationsQuerySchema.parse({}), ADMIN);

    expect(mocks.countOpenByLocations).toHaveBeenCalledWith(
      [String(servers._id), String(cameras._id)],
      expect.objectContaining({ scope: 'organization' }),
    );
    expect(heldOf(held, servers)).toBe(4);
    expect(heldOf(held, cameras)).toBe(0);
  });

  it('counts nothing for a reader without itAsset.view — the column reads null', async () => {
    const servers = place();
    mocks.list.mockResolvedValue(page([servers]));

    const { held } = await itLocationService.list(ListItLocationsQuerySchema.parse({}), KEEPER_A);

    expect(held).toBeNull();
    expect(heldOf(held, servers)).toBeNull();
    expect(mocks.countOpenByLocations).not.toHaveBeenCalled();
  });
});

describe('where the create dialog may file a place', () => {
  it('offers the ACTIVE branches the key reaches as a whole, in the branches’ order', async () => {
    const branchC = String(new Types.ObjectId());
    mocks.branchListAll.mockResolvedValue([
      { _id: new Types.ObjectId(BRANCH_A), status: 'active' },
      { _id: new Types.ObjectId(BRANCH_B), status: 'active' },
      { _id: new Types.ObjectId(branchC), status: 'inactive' },
    ]);
    expect(await itLocationService.branchTargets(ADMIN)).toEqual({
      branchIds: [BRANCH_A, BRANCH_B],
    });
    expect(await itLocationService.branchTargets(KEEPER_A)).toEqual({ branchIds: [BRANCH_A] });
  });
});

describe('the place as the screens read it', () => {
  it('answers every field, and the count it is handed', () => {
    const doc = place({ __v: 2 });
    expect(toItLocationDto(doc, 5)).toEqual({
      id: String(doc._id),
      branchId: BRANCH_A,
      name: { ar: 'غرفة السيرفرات', en: 'Server room' },
      code: 'SRV',
      description: null,
      sortOrder: 10,
      isActive: true,
      heldAssets: 5,
      version: 2,
      createdAt: AT.toISOString(),
      updatedAt: AT.toISOString(),
    });
    expect(toItLocationDto(doc, null).heldAssets).toBeNull();
  });

  it('answers a picker row with names only', () => {
    const doc = place({ isActive: false });
    expect(toItLocationOptionDto(doc)).toEqual({
      id: String(doc._id),
      branchId: BRANCH_A,
      name: { ar: 'غرفة السيرفرات', en: 'Server room' },
      isActive: false,
    });
  });

  it('says the count in the refusal, one or many', () => {
    expect(heldAtPlaceMessage(1)).toBe(
      '1 asset is held at this place; transfer or return it first',
    );
    expect(heldAtPlaceMessage(2)).toBe(
      '2 assets are held at this place; transfer or return them first',
    );
  });
});
