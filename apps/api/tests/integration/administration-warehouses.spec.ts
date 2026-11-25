// Administrative Affairs' warehouses over real HTTP, real RBAC and a real database (design §19.7):
// the stores of each branch, the branch options their screens offer, and the keeper picker (P1a.3).
//
// What a mocked spec cannot see: §7.2's table held by real grants — an organization holder
// narrowed by the top bar, a branch holder, a home-only department holder, department copies by
// role reach and by delegation, `own` — each reading exactly its branches and only the first two
// ever writing; a browser branch that only narrows; the branch options worked out per key and
// per branch; one name per branch and one code per company, held by the unique indexes even when
// two spellings are typed at the same moment; the keeper read from HR, held to the picker's reach,
// a leaver refused, and no name of anybody stored on the row; every refusal answered with its own
// code (§5.15).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import {
  foldName,
  type AdministrationPersonDto,
  type AdministrationWarehouseBranchOptionDto,
  type AdministrationWarehouseDto,
  type MyApplicationCategoryDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { seedAdministration } from '../../src/modules/administration/administration.seed';
import { AdministrationWarehouseModel } from '../../src/modules/administration/warehouses/warehouses/warehouse.model';
import { administrationWarehouseRepository } from '../../src/modules/administration/warehouses/warehouses/warehouse.repository';
import { registerWarehouseHoldChecker } from '../../src/modules/administration/warehouses/warehouses/index';
import { syncNavigationCatalog } from '../../src/seed-navigation';
import {
  administrationApi,
  bootAdministration,
  bootWarehouseWorld,
  data,
  plantEmployee,
  refusal,
  stopAdministration,
  type AdministrationWorld,
  type WarehouseWorld,
} from './helpers/administration-fixtures';

let world: AdministrationWorld;
let wh: WarehouseWorld;
/**
 * Branch A's warehouse and branch B's, written once by the organization holder before the first
 * case. No case edits them, so their `version` stays 0.
 */
let inA: AdministrationWarehouseDto;
let inB: AdministrationWarehouseDto;

const as = (token: string, activeBranchId?: string) =>
  administrationApi(world.app, token, activeBranchId);

// Every case its own codes and names: two cases never share a warehouse.
let serial = 0;
const fresh = () => {
  serial += 1;
  return {
    code: `WH-${String(serial)}`,
    name: { ar: `مخزن رقم ${String(serial)}`, en: `Store ${String(serial)}` },
  };
};

const warehouse = async (
  body: Record<string, unknown> = {},
  token = wh.orgToken,
): Promise<AdministrationWarehouseDto> => {
  const res = await as(token).post('/warehouses', {
    ...fresh(),
    branchId: world.branchAId,
    type: 'main',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AdministrationWarehouseDto>(res);
};

/** The ids a register read returns — every page a test could need is one page here. */
const listed = async (token: string, query = '', activeBranchId?: string): Promise<string[]> => {
  const res = await as(token, activeBranchId).get(`/warehouses?pageSize=100${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AdministrationWarehouseDto[]>(res).map((row) => row.id);
};

const options = async (
  token: string,
  activeBranchId?: string,
): Promise<Map<string, AdministrationWarehouseBranchOptionDto>> => {
  const res = await as(token, activeBranchId).get('/warehouses/branch-options');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return new Map(
    data<AdministrationWarehouseBranchOptionDto[]>(res).map((option) => [option.branchId, option]),
  );
};

const trail = (entityId: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'administration',
    'entityRef.entityType': 'warehouse',
    'entityRef.entityId': entityId,
  })
    .sort({ _id: 1 })
    .lean()
    .exec();

beforeAll(async () => {
  world = await bootAdministration('warehouses');
  wh = await bootWarehouseWorld(world);
  inA = await warehouse();
  inB = await warehouse({ branchId: world.branchBId });
}, 240_000);

afterAll(async () => {
  await stopAdministration();
});

describe('the seed', () => {
  it('builds the indexes one code and one name per branch stand on', async () => {
    // Tests boot with `autoIndex` on; once its build is done the indexes are dropped, and only the
    // seed's `syncDeclaredIndexes` brings them back (§15.3.2).
    const names = async () =>
      (await AdministrationWarehouseModel.collection.indexes()).map((index) => index.name);
    await AdministrationWarehouseModel.init();
    await AdministrationWarehouseModel.collection.dropIndexes();
    expect(await names()).toEqual(['_id_']);
    await seedAdministration();
    expect(await names()).toEqual(
      expect.arrayContaining(['ux_code', 'ux_branch_name_key', 'ix_branch_active']),
    );
  });
});

describe('reads fail closed (§7.2)', () => {
  it('an organization holder reads every branch, and the top bar narrows it', async () => {
    const all = await listed(wh.orgToken);
    expect(all).toEqual(expect.arrayContaining([inA.id, inB.id]));
    const narrowed = await listed(wh.orgToken, '', world.branchAId);
    expect(narrowed).toContain(inA.id);
    expect(narrowed).not.toContain(inB.id);
  });

  it('a branch-A holder reads A alone: B’s warehouse is a 404, on GET and on PATCH', async () => {
    const rows = await listed(wh.branchAToken);
    expect(rows).toContain(inA.id);
    expect(rows).not.toContain(inB.id);
    expect((await as(wh.branchAToken).get(`/warehouses/${inB.id}`)).status).toBe(404);
    const edit = await as(wh.branchAToken).patch(`/warehouses/${inB.id}`, {
      notes: 'ليس لي',
      version: inB.version,
    });
    expect(edit.status).toBe(404);
  });

  it('`own` reads nothing — a store is not its author’s', async () => {
    // A store the `own` holder authored: the base repository's "own = createdBy" would read it.
    const mine = await warehouse();
    await AdministrationWarehouseModel.updateOne(
      { _id: new Types.ObjectId(mine.id) },
      { $set: { createdBy: new Types.ObjectId(wh.ownId) } },
    ).exec();
    const res = await as(wh.ownToken).get('/warehouses');
    expect(res.status).toBe(200);
    expect(data<AdministrationWarehouseDto[]>(res)).toEqual([]);
    expect((await as(wh.ownToken).get(`/warehouses/${mine.id}`)).status).toBe(404);
    expect((await as(wh.ownToken).get(`/warehouses/${inA.id}`)).status).toBe(404);
  });

  it('a home-only department holder reads their branch and writes nothing (OD-10 department (i))', async () => {
    const rows = await listed(wh.departmentToken);
    expect(rows).toContain(inA.id);
    expect(rows).not.toContain(inB.id);
    const one = await as(wh.departmentToken).get(`/warehouses/${inA.id}`);
    expect(one.status).toBe(200);
    expect(data<AdministrationWarehouseDto>(one).canEdit).toBe(false);

    const edit = await as(wh.departmentToken).patch(`/warehouses/${inA.id}`, {
      notes: 'محاولة',
      version: inA.version,
    });
    expect(edit.status).toBe(403);
    const create = await as(wh.departmentToken).post('/warehouses', {
      ...fresh(),
      branchId: world.branchAId,
      type: 'sub',
      departmentId: wh.departmentAId,
    });
    expect(create.status, 'not even for its own department').toBe(403);
  });

  it('department copies by role reach read both copies’ branches and never write', async () => {
    const rows = await listed(wh.copiesToken);
    expect(rows).toEqual(expect.arrayContaining([inA.id, inB.id]));
    expect(
      (await as(wh.copiesToken).patch(`/warehouses/${inB.id}`, { notes: 'x', version: 0 })).status,
    ).toBe(403);
    const create = await as(wh.copiesToken).post('/warehouses', {
      ...fresh(),
      branchId: world.branchBId,
      type: 'sub',
    });
    expect(create.status).toBe(403);
  });

  it('a department copy delegated (ADR-032) reads the copy’s branch, and never writes', async () => {
    const rows = await listed(wh.delegateToken);
    expect(rows).toContain(inB.id);
    expect(rows).not.toContain(inA.id);
    expect((await as(wh.delegateToken).get(`/warehouses/${inA.id}`)).status).toBe(404);
    const one = await as(wh.delegateToken).get(`/warehouses/${inB.id}`);
    expect(data<AdministrationWarehouseDto>(one).canEdit).toBe(false);
    expect(
      (await as(wh.delegateToken).patch(`/warehouses/${inB.id}`, { notes: 'x', version: 0 }))
        .status,
    ).toBe(403);
  });

  it('a browser branch only narrows: inside the reach it filters, outside it is 400 OUT_OF_REACH', async () => {
    expect(await listed(wh.orgToken, `&branchId=${world.branchBId}`)).toEqual(
      expect.arrayContaining([inB.id]),
    );
    expect(await listed(wh.orgToken, `&branchId=${world.branchBId}`)).not.toContain(inA.id);
    // The id as the browser may spell it: canonicalised before the reach compares it.
    expect(await listed(wh.branchAToken, `&branchId=${world.branchAId.toUpperCase()}`)).toContain(
      inA.id,
    );

    const outside = await as(wh.branchAToken).get(`/warehouses?branchId=${world.branchBId}`);
    expect(outside.status).toBe(400);
    expect(refusal(outside)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ field: 'query.branchId', code: 'OUT_OF_REACH' })],
    });
  });

  it('a warehouse reader without any warehouse key is a 403', async () => {
    expect((await as(world.itemViewerToken).get('/warehouses')).status).toBe(403);
    expect((await as(world.outsiderToken).get('/warehouses/branch-options')).status).toBe(403);
  });

  it('every row says whether this reader may edit it, and names its branch', async () => {
    const asOrg = data<AdministrationWarehouseDto>(
      await as(wh.orgToken).get(`/warehouses/${inA.id}`),
    );
    expect(asOrg).toMatchObject({
      branchId: world.branchAId,
      branchName: { ar: 'فرع أ', en: 'Branch A' },
      canEdit: true,
    });
    expect(asOrg, 'the folded key never leaves the server').not.toHaveProperty('nameKey');
    const asBranch = data<AdministrationWarehouseDto>(
      await as(wh.branchAToken).get(`/warehouses/${inA.id}`),
    );
    expect(asBranch.canEdit).toBe(true);
    const asViewer = data<AdministrationWarehouseDto>(
      await as(wh.viewerToken).get(`/warehouses/${inB.id}`),
    );
    expect(asViewer.canEdit).toBe(false);
  });
});

describe('writes are the key’s in the warehouse’s branch (OD-10 A)', () => {
  it('a create in B with an A key is a 403; in A it is theirs', async () => {
    const elsewhere = await as(wh.branchAToken).post('/warehouses', {
      ...fresh(),
      branchId: world.branchBId,
      type: 'branch',
    });
    expect(elsewhere.status).toBe(403);
    expect(refusal(elsewhere).code).toBe('FORBIDDEN');

    const mine = await warehouse({ type: 'branch' }, wh.branchAToken);
    expect(mine).toMatchObject({ branchId: world.branchAId, type: 'branch', canEdit: true });
    const [row] = await trail(mine.id);
    expect(row?.action).toBe('create');
  });

  it('a create names an active branch: a closed one or none at all is a 404', async () => {
    for (const branchId of [wh.closedBranchId, String(new Types.ObjectId())]) {
      const res = await as(wh.orgToken).post('/warehouses', { ...fresh(), branchId, type: 'main' });
      expect(res.status, branchId).toBe(404);
      expect(refusal(res).code).toBe('NOT_FOUND');
    }
  });

  it('the branch is set once: an edit that sends one is refused, and the store stays put', async () => {
    const res = await as(wh.orgToken).patch(`/warehouses/${inA.id}`, {
      branchId: world.branchBId,
      version: inA.version,
    });
    expect(res.status).toBe(400);
    expect(refusal(res).code).toBe('VALIDATION_FAILED');
    const stored = await AdministrationWarehouseModel.findById(inA.id).lean().exec();
    expect(String(stored?.branchId)).toBe(world.branchAId);
  });

  it('edits with its version; a stale version is 409 STALE_DOCUMENT — before any rule', async () => {
    const store = await warehouse();
    const edited = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      name: { ar: 'مخزن قطع الغيار', en: 'Spare parts store' },
      type: 'sub',
      location: 'الدور الثاني',
      version: store.version,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(data<AdministrationWarehouseDto>(edited)).toMatchObject({
      name: { ar: 'مخزن قطع الغيار', en: 'Spare parts store' },
      type: 'sub',
      location: 'الدور الثاني',
      version: 1,
    });
    const stored = await AdministrationWarehouseModel.findById(store.id).lean().exec();
    expect(stored?.nameKey, 'a rename folds the new name').toBe(foldName('مخزن قطع الغيار'));

    // Stale AND naming a leaver: the version is answered first, never a 422 over the old row.
    const stale = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: wh.leaverAId,
      version: store.version,
    });
    expect(stale.status).toBe(409);
    expect(refusal(stale).code).toBe('STALE_DOCUMENT');

    const rows = await trail(store.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update']);
  });

  it('a department is an active copy in the warehouse’s own branch — any other is a 404', async () => {
    const owned = await warehouse({ departmentId: wh.departmentAId });
    expect(owned.departmentId).toBe(wh.departmentAId);

    const otherBranch = await as(wh.orgToken).post('/warehouses', {
      ...fresh(),
      branchId: world.branchAId,
      type: 'main',
      departmentId: wh.departmentBId,
    });
    expect(otherBranch.status).toBe(404);
    const moved = await as(wh.orgToken).patch(`/warehouses/${owned.id}`, {
      departmentId: wh.departmentBId,
      version: owned.version,
    });
    expect(moved.status).toBe(404);

    const cleared = await as(wh.orgToken).patch(`/warehouses/${owned.id}`, {
      departmentId: null,
      version: owned.version,
    });
    expect(cleared.status).toBe(200);
    expect(data<AdministrationWarehouseDto>(cleared).departmentId).toBeNull();
  });
});

describe('one code in the company, one name in a branch (§2.1, §2.3.5)', () => {
  it('a code a live warehouse holds anywhere is 409 ADMINISTRATION_DUPLICATE on code', async () => {
    const res = await as(wh.orgToken).post('/warehouses', {
      code: inA.code,
      name: { ar: 'مخزن آخر في ب', en: 'Another store in B' },
      branchId: world.branchBId,
      type: 'main',
    });
    expect(res.status).toBe(409);
    expect(refusal(res)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'code' }],
    });
  });

  it('a name another spelling of a live one in the branch is 409 on name; another branch may hold it', async () => {
    await warehouse({ name: { ar: 'مخزن الأدوات الكهربائية', en: 'Electrical tools' } });
    const again = await as(wh.orgToken).post('/warehouses', {
      ...fresh(),
      name: { ar: 'مخزن الادوات الكهربائيه', en: 'Electric tools' },
      branchId: world.branchAId,
      type: 'sub',
    });
    expect(again.status).toBe(409);
    expect(refusal(again)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
    await warehouse({
      name: { ar: 'مخزن الأدوات الكهربائية', en: 'Electrical tools' },
      branchId: world.branchBId,
    });
  });

  it('two spellings typed at the same moment in one branch: one 201, one 409 on name', async () => {
    // The design's pair (§19.7): «مخزن الأدوات» and «مخزن الادوات».
    const [first, second] = await Promise.all([
      as(wh.orgToken).post('/warehouses', {
        ...fresh(),
        name: { ar: 'مخزن الأدوات', en: 'Tools A' },
        branchId: world.branchBId,
        type: 'main',
      }),
      as(wh.orgToken).post('/warehouses', {
        ...fresh(),
        name: { ar: 'مخزن الادوات', en: 'Tools B' },
        branchId: world.branchBId,
        type: 'main',
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refusal(refused)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'name' }],
    });
    const stored = await AdministrationWarehouseModel.countDocuments({
      branchId: new Types.ObjectId(world.branchBId),
      nameKey: foldName('مخزن الأدوات'),
    }).exec();
    expect(stored).toBe(1);
  });

  it('a write racing past the early checks meets the index, with the same answer', async () => {
    // The early check told "free" once, as it would be for the second of two simultaneous writes.
    const named = await warehouse({ name: { ar: 'مخزن المكاتب', en: 'Office store' } });
    const nameSpy = vi
      .spyOn(administrationWarehouseRepository, 'findLiveByBranchAndNameKey')
      .mockResolvedValueOnce(null);
    const byName = await as(wh.orgToken).post('/warehouses', {
      ...fresh(),
      name: { ar: 'مخزن المكاتب', en: 'Offices' },
      branchId: world.branchAId,
      type: 'sub',
    });
    nameSpy.mockRestore();
    expect(byName.status).toBe(409);
    expect(refusal(byName).details).toEqual([expect.objectContaining({ field: 'name' })]);

    // An edit's refusal arrives raw from `findOneAndUpdate`: the other half of the same answer.
    const other = await warehouse();
    const codeSpy = vi
      .spyOn(administrationWarehouseRepository, 'findLiveByCode')
      .mockResolvedValueOnce(null);
    const byCode = await as(wh.orgToken).patch(`/warehouses/${other.id}`, {
      code: named.code,
      version: other.version,
    });
    codeSpy.mockRestore();
    expect(byCode.status).toBe(409);
    expect(refusal(byCode)).toMatchObject({
      code: 'ADMINISTRATION_DUPLICATE',
      details: [{ field: 'code' }],
    });
  });

  it('a retired warehouse keeps its code and name — reactivate it, never type it again', async () => {
    const retired = await warehouse({ name: { ar: 'مخزن الأرشيف', en: 'Archive store' } });
    const off = await as(wh.orgToken).patch(`/warehouses/${retired.id}`, {
      isActive: false,
      version: 0,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(data<AdministrationWarehouseDto>(off).isActive).toBe(false);

    const again = await as(wh.orgToken).post('/warehouses', {
      ...fresh(),
      name: { ar: 'مخزن الارشيف', en: 'Archive' },
      branchId: world.branchAId,
      type: 'main',
    });
    expect(again.status).toBe(409);
    expect(refusal(again).details).toEqual([expect.objectContaining({ field: 'name' })]);

    // Codes are company-wide: another branch may not take it either.
    const sameCode = await as(wh.orgToken).post('/warehouses', {
      code: retired.code,
      name: { ar: 'مخزن آخر', en: 'Other' },
      branchId: world.branchBId,
      type: 'main',
    });
    expect(sameCode.status).toBe(409);
    expect(refusal(sameCode).details).toEqual([expect.objectContaining({ field: 'code' })]);
  });
});

describe('retiring a warehouse (OD-70 B)', () => {
  it('retires freely — nothing holds stock in Phase 1 — and comes back: `deactivate`, `activate`', async () => {
    const store = await warehouse();
    const off = await as(wh.branchAToken).patch(`/warehouses/${store.id}`, {
      isActive: false,
      version: 0,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(data<AdministrationWarehouseDto>(off).isActive).toBe(false);
    expect(await listed(wh.orgToken, '&isActive=false')).toContain(store.id);
    expect(await listed(wh.orgToken, '&isActive=true')).not.toContain(store.id);
    const retired = await as(wh.orgToken).get(`/warehouses/${store.id}`);
    expect(retired.status, 'a retired warehouse still answers by id').toBe(200);

    const on = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      isActive: true,
      version: 1,
    });
    expect(on.status).toBe(200);

    const rows = await trail(store.id);
    expect(rows.map((row) => row.action)).toEqual(['create', 'deactivate', 'activate']);
    expect(rows[1]?.changes).toEqual([{ field: 'isActive', old: true, new: false }]);
  });

  it('asks what holds it on a retirement — a hold refuses it, 422 ADMINISTRATION_DEACTIVATION_BLOCKED', async () => {
    // Phase 1 registers no checker; this one answers for its own store alone, so no other case
    // meets it.
    const held = await warehouse();
    registerWarehouseHoldChecker((id) => Promise.resolve(id === held.id ? 'holdsStock' : null));

    const off = await as(wh.orgToken).patch(`/warehouses/${held.id}`, {
      isActive: false,
      version: 0,
    });
    expect(off.status).toBe(422);
    expect(refusal(off)).toMatchObject({
      code: 'ADMINISTRATION_DEACTIVATION_BLOCKED',
      details: [{ field: 'isActive', code: 'holdsStock' }],
    });
    const stored = await AdministrationWarehouseModel.findById(held.id).lean().exec();
    expect(stored?.isActive).toBe(true);
    expect((await trail(held.id)).map((row) => row.action)).toEqual(['create']);

    // An edit that does not retire it is never asked.
    const edit = await as(wh.orgToken).patch(`/warehouses/${held.id}`, {
      notes: 'ما زال يحوي أصنافًا',
      version: 0,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
  });
});

describe('the keeper (§7.8; OD-10 keeper (i))', () => {
  it('the picker is a 403 without the create or edit key', async () => {
    for (const token of [wh.viewerToken, world.outsiderToken, world.managerToken]) {
      expect((await as(token).get('/people')).status).toBe(403);
      expect((await as(token).get(`/people/${wh.keeperAId}`)).status).toBe(403);
    }
  });

  it('offers the people who work here today, within the keys’ reach — never a leaver', async () => {
    const org = await as(wh.orgToken).get('/people?search=ADM-K');
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    const people = data<AdministrationPersonDto[]>(org);
    expect(people.map((person) => person.employeeId).sort()).toEqual(
      [wh.keeperAId, wh.keeperBId].sort(),
    );
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual([
        'branchId',
        'code',
        'departmentId',
        'employeeId',
        'fullNameAr',
        'jobTitleId',
        'status',
      ]);
    }

    const branchA = data<AdministrationPersonDto[]>(
      await as(wh.branchAToken).get('/people?search=ADM-K'),
    );
    expect(branchA.map((person) => person.employeeId)).toEqual([wh.keeperAId]);

    const narrowed = data<AdministrationPersonDto[]>(
      await as(wh.orgToken).get(`/people?search=ADM-K&branchId=${world.branchBId}`),
    );
    expect(narrowed.map((person) => person.employeeId)).toEqual([wh.keeperBId]);
  });

  it('opens the picker to an editor without the create key, in the edit key’s reach', async () => {
    const { token } = await world.person(
      'wh-editor-a',
      ['administrationWarehouse.edit'],
      'branch',
      {
        branchId: world.branchAId,
      },
    );
    const res = await as(token).get('/people?search=ADM-K');
    expect(res.status).toBe(200);
    expect(data<AdministrationPersonDto[]>(res).map((person) => person.employeeId)).toEqual([
      wh.keeperAId,
    ]);
  });

  it('resolves one person by id, a leaver too; outside the reach a 404', async () => {
    const leaver = await as(wh.orgToken).get(`/people/${wh.leaverAId}`);
    expect(leaver.status).toBe(200);
    expect(data<AdministrationPersonDto>(leaver)).toMatchObject({
      employeeId: wh.leaverAId,
      status: 'exited',
    });
    expect((await as(wh.branchAToken).get(`/people/${wh.keeperBId}`)).status).toBe(404);
    expect((await as(wh.orgToken).get('/people/not-an-id')).status).toBe(400);
  });

  it('refuses a leaver as keeper: 422 ADMINISTRATION_EMPLOYEE_EXITED, on a create and an edit', async () => {
    const create = await as(wh.orgToken).post('/warehouses', {
      ...fresh(),
      branchId: world.branchAId,
      type: 'main',
      responsibleEmployeeId: wh.leaverAId,
    });
    expect(create.status).toBe(422);
    expect(refusal(create)).toMatchObject({
      code: 'ADMINISTRATION_EMPLOYEE_EXITED',
      details: [{ field: 'responsibleEmployeeId', code: 'exited' }],
    });

    const store = await warehouse();
    const edit = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: wh.leaverAId,
      version: store.version,
    });
    expect(edit.status).toBe(422);
    expect(refusal(edit).code).toBe('ADMINISTRATION_EMPLOYEE_EXITED');
  });

  it('names a keeper at work, read from HR at every read and stored as an id alone', async () => {
    const store = await warehouse({ responsibleEmployeeId: wh.keeperAId });
    expect(store).toMatchObject({
      responsibleEmployeeId: wh.keeperAId,
      keeper: {
        employeeId: wh.keeperAId,
        code: 'ADM-K-01',
        fullNameAr: 'أمين مخزن الفرع',
        status: 'active',
      },
    });
    const stored = await AdministrationWarehouseModel.findById(store.id).lean().exec();
    // The keeper's name is nowhere on the row — HR's permanent delete has nothing to chase here —
    // and the only path ending in `name` is the store's own {ar, en}.
    expect(JSON.stringify(stored)).not.toContain('أمين مخزن الفرع');
    expect(Object.keys(stored ?? {}).filter((key) => /name$/i.test(key))).toEqual(['name']);

    const listedRow = data<AdministrationWarehouseDto[]>(
      await as(wh.orgToken).get(`/warehouses?search=${encodeURIComponent(store.code)}`),
    );
    expect(listedRow[0]?.keeper?.fullNameAr).toBe('أمين مخزن الفرع');
  });

  it('a keeper is somebody the writer’s keys reach — anybody else is a 404, on a create and an edit', async () => {
    // Branch A's writer: the picker hides B's people from them, so the body cannot name one.
    const code = fresh().code;
    const create = await as(wh.branchAToken).post('/warehouses', {
      code,
      name: { ar: 'مخزن بأمين من ب', en: 'Store with a B keeper' },
      branchId: world.branchAId,
      type: 'main',
      responsibleEmployeeId: wh.keeperBId,
    });
    expect(create.status).toBe(404);
    expect(refusal(create).code).toBe('NOT_FOUND');
    expect(await AdministrationWarehouseModel.countDocuments({ code }).exec()).toBe(0);

    const store = await warehouse({}, wh.branchAToken);
    const edit = await as(wh.branchAToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: wh.keeperBId,
      version: store.version,
    });
    expect(edit.status).toBe(404);
    const stored = await AdministrationWarehouseModel.findById(store.id).lean().exec();
    expect(stored?.responsibleEmployeeId).toBeNull();

    // A leaver outside the reach is a 404 too, never a 422: their status is not told.
    const leaverBId = await plantEmployee(
      'ADM-K-08',
      'أمين مخزن ب سابق',
      world.branchBId,
      wh.departmentBId,
      'exited',
    );
    const leaver = await as(wh.branchAToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: leaverBId,
      version: store.version,
    });
    expect(leaver.status).toBe(404);

    // Their own branch's keeper they name.
    const named = await as(wh.branchAToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: wh.keeperAId,
      version: store.version,
    });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(data<AdministrationWarehouseDto>(named).keeper?.employeeId).toBe(wh.keeperAId);
  });

  it('passes an id the directory cannot read, and shows no keeper for it', async () => {
    const nobody = String(new Types.ObjectId());
    const store = await warehouse({ responsibleEmployeeId: nobody });
    expect(store).toMatchObject({ responsibleEmployeeId: nobody, keeper: null });
  });

  it('a keeper who left later is kept by every edit that leaves them, and marked as gone', async () => {
    const keeperId = await plantEmployee(
      'ADM-K-09',
      'أمين مخزن مؤقت',
      world.branchAId,
      wh.departmentAId,
      'active',
    );
    const store = await warehouse({ responsibleEmployeeId: keeperId });
    await EmployeeModel.collection.updateOne(
      { _id: new Types.ObjectId(keeperId) },
      { $set: { status: 'exited' } },
    );
    const edit = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      notes: 'بانتظار أمين جديد',
      // The same keeper sent back as the form holds it is not a keeper named anew.
      responsibleEmployeeId: keeperId,
      version: store.version,
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(data<AdministrationWarehouseDto>(edit).keeper).toMatchObject({ status: 'exited' });

    const cleared = await as(wh.orgToken).patch(`/warehouses/${store.id}`, {
      responsibleEmployeeId: null,
      version: store.version + 1,
    });
    expect(data<AdministrationWarehouseDto>(cleared)).toMatchObject({
      responsibleEmployeeId: null,
      keeper: null,
    });
  });
});

describe('the branch options (§19.3)', () => {
  /** The branches the top bar's switcher lists, in its order. */
  const switcher = async (): Promise<string[]> => {
    const res = await request(world.app)
      .get('/api/v1/platform/branches/options')
      .set('Authorization', `Bearer ${world.adminToken}`);
    expect(res.status).toBe(200);
    return data<OrgUnitOptionDto[]>(res).map((branch) => branch.id);
  };

  it('lists every active branch, named and ordered as the switcher, a closed one never', async () => {
    const res = await as(wh.orgToken).get('/warehouses/branch-options');
    const rows = data<AdministrationWarehouseBranchOptionDto[]>(res);
    expect(rows.map((row) => row.branchId)).toEqual(await switcher());
    expect(rows.map((row) => row.branchId)).not.toContain(wh.closedBranchId);
    expect(rows.find((row) => row.branchId === world.branchAId)).toEqual({
      branchId: world.branchAId,
      name: { ar: 'فرع أ', en: 'Branch A' },
      canView: true,
      canCreate: true,
    });
  });

  it('answers each branch by its own key’s reach — outside both, both false', async () => {
    const branchA = await options(wh.branchAToken);
    expect(branchA.get(world.branchAId)).toMatchObject({ canView: true, canCreate: true });
    expect(branchA.get(world.branchBId)).toMatchObject({ canView: false, canCreate: false });

    const creatorA = await options(wh.creatorAToken);
    expect(creatorA.get(world.branchAId)).toMatchObject({ canView: true, canCreate: true });
    expect(creatorA.get(world.branchBId)).toMatchObject({ canView: true, canCreate: false });

    const department = await options(wh.departmentToken);
    expect(department.get(world.branchAId)).toMatchObject({ canView: true, canCreate: false });
    expect(department.get(world.branchBId)).toMatchObject({ canView: false, canCreate: false });

    const own = await options(wh.ownToken);
    expect([...own.values()].every((row) => !row.canView && !row.canCreate)).toBe(true);
    expect(own.size, 'every active branch is still listed').toBe((await switcher()).length);
  });

  it('the top bar narrows what may be viewed and where a store may be created (ADR-028)', async () => {
    const narrowed = await options(wh.orgToken, world.branchAId);
    expect(narrowed.get(world.branchAId)).toMatchObject({ canView: true, canCreate: true });
    expect(narrowed.get(world.branchBId)).toMatchObject({ canView: false, canCreate: false });
    const whole = await options(wh.orgToken);
    expect(whole.get(world.branchBId)).toMatchObject({ canView: true, canCreate: true });
  });

  it('a create past the top bar’s branch is 400 OUT_OF_REACH; the whole company files it', async () => {
    const body = { ...fresh(), branchId: world.branchBId, type: 'branch' };
    const before = await AdministrationWarehouseModel.countDocuments({}).exec();
    const narrowed = await as(wh.orgToken, world.branchAId).post('/warehouses', body);
    expect(narrowed.status, JSON.stringify(narrowed.body)).toBe(400);
    expect(refusal(narrowed)).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ field: 'body.branchId', code: 'OUT_OF_REACH' })],
    });
    expect(await AdministrationWarehouseModel.countDocuments({}).exec(), 'nothing written').toBe(
      before,
    );

    const res = await as(wh.orgToken).post('/warehouses', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const store = data<AdministrationWarehouseDto>(res);
    expect(store.canEdit).toBe(true);
    const fromA = await as(wh.orgToken, world.branchAId).get(`/warehouses/${store.id}`);
    expect(fromA.status, 'narrowed to A, a store in B is out of sight').toBe(404);
  });

  it('takes no query', async () => {
    expect((await as(wh.orgToken).get('/warehouses/branch-options?branchId=x')).status).toBe(400);
  });
});

// From P1a.W (§19.7, §19.10.2): the sidebar the API hands a reader is exactly the rows of the keys
// they hold — the `operations-navigation.spec.ts` precedent, over the seeded catalog.
describe('the sidebar', () => {
  /** The routes of one reader's sidebar, sections included, by category. */
  const sidebarOf = async (token: string): Promise<Map<string, string[]>> => {
    const res = await request(world.app)
      .get('/api/v1/platform/me/applications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return new Map(
      data<MyApplicationCategoryDto[]>(res).map((group) => [
        group.name.en,
        [
          ...group.applications.map((a) => a.route),
          ...group.sections.flatMap((section) => section.applications.map((a) => a.route)),
        ],
      ]),
    );
  };

  beforeAll(async () => {
    await syncNavigationCatalog();
  });

  it('a role holding only `administrationWarehouse.view` gets exactly the Warehouses row', async () => {
    const reader = await world.person(
      'sidebar-reader',
      ['administrationWarehouse.view'],
      'organization',
    );
    const sidebar = await sidebarOf(reader.token);
    expect([...sidebar.entries()]).toEqual([
      ['Administrative Affairs', ['/administration/warehouses']],
    ]);
  });

  it('the super-admin sees the module’s five rows, under its own category', async () => {
    const sidebar = await sidebarOf(world.adminToken);
    expect(sidebar.get('Administrative Affairs')).toEqual([
      '/administration',
      '/administration/warehouses',
      '/administration/items',
      '/administration/catalogs',
      '/administration/suppliers',
    ]);
    // Never filed under System Administration, whose English name it must not take.
    expect(sidebar.get('Administration') ?? []).not.toContain('/administration/warehouses');
  });
});
