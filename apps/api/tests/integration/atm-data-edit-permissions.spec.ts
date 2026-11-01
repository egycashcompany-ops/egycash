// The data-edit split over real HTTP and real RBAC — spec docs/12-planning/atm-efficiency-register.md
// §7.1 and §10.3 "atm-data-edit-permissions.spec.ts".
//
// The register controls which machines exist (D2), so /atm/data-edit became the OPERATIONS page:
// Operations add, rename and archive-toggle bank and area labels and move a machine to another
// area — which moves its open register entry too (DEC-4) — while adding, archiving and deleting
// machines, deleting a label and reassigning by code stay `atmMachine.manage`. What this proves:
//   · every manage-only route answers 403 to the Operations bundle, and still 2xx to a manage holder;
//   · the Operations routes take the new keys, and the key must reach the branch of the machine or
//     label it touches (DEC-29) — a department-scoped holder, or one whose top-bar choice names a
//     branch only an unrelated key reaches, is refused (review finding F-4); a finer-scoped
//     `manage` holder still adds labels in the branch they are placed in (review finding F1);
//   · the nav row's key is corrected through `previousPermission` — and an administrator's own
//     choice is not (lead override O-1: there is NO role or delegation widening, so nothing is
//     asserted about roles gaining keys);
//   · since the bank catalog and the intake (DEC-36, DEC-38) a manage holder's add is also an open
//     register receipt in a mapped branch, a spelling carries its bank, and an area a machine save
//     leaves behind becomes a label of its own — the full intake table is atm-data-edit-register.spec.ts,
//     the labels atm-area-labels.spec.ts.
//
// Every machine code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  AtmSettingKeys,
  SettingKeys,
  platformPermissions,
  type AtmMachineCreateResultDto,
  type AtmMachineDto,
  type AtmRefLabelDto,
  type AtmRefLabelOptionsDto,
  type AtmRegisterEntryDto,
  type AtmRegisterWriteResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { applicationRepository, applicationService } from '../../src/platform/applications';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AtmMachineModel, type AtmMachineDoc } from '../../src/modules/atm/machines/machine.model';
import { syncNavigationCatalog } from '../../src/seed-navigation';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string; // super-admin, organization scope, placed nowhere
let opsAlexToken: string; // the Operations bundle (§12.3), BRANCH scope, placed in Alex
let opsTantaToken: string; // the same bundle, BRANCH scope, placed in Tanta
let opsDeptToken: string; // the same bundle, DEPARTMENT scope, placed in a Tanta department
let opsReachToken: string; // atmRefLabel.create in Alex + an unrelated key reaching Tanta
let viewerToken: string; // atmMachine.view only, Alex
let manageToken: string; // the legacy bundle: atmMachine.view + manage, BRANCH scope, Alex
let manageDeptToken: string; // the legacy bundle, DEPARTMENT scope, placed in a Tanta department
let manageOwnToken: string; // the legacy bundle, OWN scope, placed in Alex
let manageReachToken: string; // atmMachine.manage DELEGATED over Alex, placed in Tanta (ADR-032)
let alexBranchId: string;
let tantaBranchId: string;
let alexAreaLabelId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-data-edit-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (
  email: string,
  placement: { branchId?: string; departmentId?: string } = {},
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: {
        branchId: placement.branchId ?? null,
        departmentId: placement.departmentId ?? null,
        sectionId: null,
        jobTitleId: null,
      },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const call = (
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  activeBranch?: string,
): request.Test => {
  let req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body);
};

/** Admin adds an Operations machine in a branch (the admin is placed nowhere, so the top bar decides). */
const addMachine = async (
  branchId: string,
  machineCode: string,
  area = 'Smouha',
): Promise<string> => {
  const res = await call(
    'post',
    '/atm/machines',
    adminToken,
    { machineCode, name: `ATM ${machineCode}`, bankName: 'NBE', area },
    branchId,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AtmMachineDto>(res).id;
};

const addLabel = async (branchId: string, kind: 'bank' | 'area', name: string): Promise<string> => {
  const res = await call('post', `/atm/ref-labels/${kind}`, adminToken, { name }, branchId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AtmRefLabelDto>(res).id;
};

const machine = async (id: string): Promise<AtmMachineDoc> => {
  const doc = await AtmMachineModel.findById(id).lean<AtmMachineDoc>().exec();
  expect(doc).not.toBeNull();
  return doc as AtmMachineDoc;
};

const versionOf = async (id: string): Promise<number> => (await machine(id)).__v;

const labelVersion = async (id: string): Promise<number> => {
  const res = await call('get', '/atm/ref-labels/bank?pageSize=100', adminToken);
  const areaRes = await call('get', '/atm/ref-labels/area?pageSize=100', adminToken);
  const all = [...data<AtmRefLabelDto[]>(res), ...data<AtmRefLabelDto[]>(areaRes)];
  const found = all.find((label) => label.id === id);
  expect(found).toBeDefined();
  return (found as AtmRefLabelDto).version;
};

/** An open register entry in Alex, received by the admin — the receipt creates its master. */
const openEntry = async (machineCode: string, area: string): Promise<AtmRegisterWriteResultDto> => {
  const res = await call('post', '/atm/register/entries', adminToken, {
    branchId: alexBranchId,
    bankCode: 'NBE',
    machineCode,
    area,
    name: `Register ${machineCode}`,
    startDate: '2026-09-01',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AtmRegisterWriteResultDto>(res);
};

const getEntry = async (id: string): Promise<AtmRegisterEntryDto> => {
  const res = await call('get', `/atm/register/entries/${id}`, adminToken);
  expect(res.status).toBe(200);
  return data<AtmRegisterEntryDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  adminId = await mkUser('data-edit-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('data-edit-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await post('/platform/branches', {
    code: '70',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
  });
  tantaBranchId = await post('/platform/branches', {
    code: '71',
    name: { ar: 'طنطا', en: 'Tanta' },
  });
  const tantaDept = await post('/platform/departments', {
    code: 'DE-T-OPS',
    name: { ar: 'العمليات', en: 'Operations' },
    branchId: tantaBranchId,
  });
  await settingsService.set(ctx, {
    key: AtmSettingKeys.RegisterBranchCodes,
    scope: 'organization',
    value: [
      { code: 'EGYCASH-4', branchId: alexBranchId },
      { code: 'EGYCASH-2', branchId: tantaBranchId },
    ],
  });

  const role = async (en: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId))._id);
  // §12.3 "Operations — machine data".
  const operations = await role('Operations machine data', [
    'atmMachine.view',
    'atmRefLabel.create',
    'atmRefLabel.edit',
    'atmMachine.moveArea',
  ]);

  const opsAlexId = await mkUser('data-edit-ops-alex@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(opsAlexId, operations, 'branch');
  opsAlexToken = await login('data-edit-ops-alex@ecms.local');

  const opsTantaId = await mkUser('data-edit-ops-tanta@ecms.local', { branchId: tantaBranchId });
  await rbacService.ensureAssignment(opsTantaId, operations, 'branch');
  opsTantaToken = await login('data-edit-ops-tanta@ecms.local');

  const opsDeptId = await mkUser('data-edit-ops-dept@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
  });
  await rbacService.ensureAssignment(opsDeptId, operations, 'department');
  opsDeptToken = await login('data-edit-ops-dept@ecms.local');

  // F-4: the label key at home in Alex, and an UNRELATED key whose grant reaches Tanta — together
  // they let the top bar pick Tanta as the acting branch, which the label key never covers.
  const labelOnly = await role('Label adder', ['atmMachine.view', 'atmRefLabel.create']);
  const unrelated = await role('Replenishment reader', ['atmReplenishment.view']);
  const opsReachId = await mkUser('data-edit-ops-reach@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(opsReachId, labelOnly, 'branch');
  await rbacService.assignRole(
    { userId: opsReachId, roleId: unrelated, scope: 'branch', branchIds: [tantaBranchId] },
    adminId,
  );
  opsReachToken = await login('data-edit-ops-reach@ecms.local');

  const viewer = await role('Machine viewer', ['atmMachine.view']);
  const viewerId = await mkUser('data-edit-viewer@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(viewerId, viewer, 'branch');
  viewerToken = await login('data-edit-viewer@ecms.local');

  const manage = await role('Machine administrator', ['atmMachine.view', 'atmMachine.manage']);
  const manageId = await mkUser('data-edit-manage@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(manageId, manage, 'branch');
  manageToken = await login('data-edit-manage@ecms.local');

  const manageDeptId = await mkUser('data-edit-manage-dept@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
  });
  await rbacService.ensureAssignment(manageDeptId, manage, 'department');
  manageDeptToken = await login('data-edit-manage-dept@ecms.local');
  const manageOwnId = await mkUser('data-edit-manage-own@ecms.local', { branchId: alexBranchId });
  await rbacService.ensureAssignment(manageOwnId, manage, 'own');
  manageOwnToken = await login('data-edit-manage-own@ecms.local');
  // A deputy's shape (ADR-032): `manage` DELEGATED over Alexandria to someone placed in Tanta and
  // holding no role. A delegated grant reaches only the unit it names — not home — so the
  // home-branch label fallback (F1, for scopes that reach no whole branch) must not apply to it.
  const manageReachId = await mkUser('data-edit-manage-reach@ecms.local', {
    branchId: tantaBranchId,
  });
  const delegated = await request(app)
    .put(`/api/v1/platform/delegations/users/${manageReachId}/grants`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      branchId: alexBranchId,
      departmentId: null,
      permissionKeys: ['atmMachine.view', 'atmMachine.manage'],
    });
  expect(delegated.status, JSON.stringify(delegated.body)).toBe(200);
  manageReachToken = await login('data-edit-manage-reach@ecms.local');

  alexAreaLabelId = await addLabel(alexBranchId, 'area', 'Smouha');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the Operations bundle on the manage-only routes (D2)', () => {
  it('1 — add, bulk add, delete-by-codes, reassign, edit, archive and label delete are 403', async () => {
    const id = await addMachine(alexBranchId, '88880001');
    const version = await versionOf(id);
    const refused: [string, request.Test][] = [
      [
        'POST /atm/machines',
        call('post', '/atm/machines', opsAlexToken, {
          machineCode: '88880002',
          name: 'New',
          bankName: 'NBE',
          area: 'Smouha',
        }),
      ],
      [
        'POST /atm/machines/bulk',
        call('post', '/atm/machines/bulk', opsAlexToken, {
          bankName: 'NBE',
          area: 'Smouha',
          machines: [{ machineCode: '88880003', name: 'Bulk' }],
        }),
      ],
      [
        'POST /atm/machines/bulk-delete',
        call('post', '/atm/machines/bulk-delete', opsAlexToken, { machineCodes: ['88880001'] }),
      ],
      [
        'POST /atm/machines/reassign-area',
        call('post', '/atm/machines/reassign-area', opsAlexToken, {
          machineCode: '88880001',
          area: 'Miami',
        }),
      ],
      [
        'PATCH /atm/machines/:id (name)',
        call('patch', `/atm/machines/${id}`, opsAlexToken, { name: 'Renamed', version }),
      ],
      [
        'PATCH /atm/machines/:id (archive)',
        call('patch', `/atm/machines/${id}`, opsAlexToken, { isActive: false, version }),
      ],
      [
        'DELETE /atm/ref-labels/area/:id',
        call('delete', `/atm/ref-labels/area/${alexAreaLabelId}`, opsAlexToken),
      ],
    ];
    for (const [label, pending] of refused) {
      const res = await pending;
      expect(res.status, label).toBe(403);
    }
    // Nothing moved: the machine is still active, named and placed as it was; the label lives.
    const after = await machine(id);
    expect(after.isActive).toBe(true);
    expect(after.name).toBe('ATM 88880001');
    expect(after.area).toBe('Smouha');
    expect(after.__v).toBe(version);
    expect(
      await AtmMachineModel.countDocuments({ machineCode: { $in: ['88880002', '88880003'] } }),
    ).toBe(0);
    expect(await labelVersion(alexAreaLabelId)).toBe(0);
  });
});

describe('the Operations routes (D2, DEC-3, DEC-4)', () => {
  it('2 — Operations add a bank label in their branch, then rename and archive it', async () => {
    const created = await call('post', '/atm/ref-labels/bank', opsAlexToken, { name: 'NBE FOREX' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const label = data<AtmRefLabelDto>(created);
    expect(label.branchId).toBe(alexBranchId);
    // An older screen's `{ name }` alone: the spelling gets the bank the boot backfill would give
    // it — `NBE FOREX` is NBE (DEC-16), so the register can take it as an NBE override at once.
    expect(label).toMatchObject({ kind: 'bank', bankCode: 'NBE', origin: 'manual' });

    const renamed = await call('patch', `/atm/ref-labels/bank/${label.id}`, opsAlexToken, {
      name: 'NBE FOREX ATM',
      version: label.version,
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(data<AtmRefLabelDto>(renamed).name).toBe('NBE FOREX ATM');

    const archived = await call('patch', `/atm/ref-labels/bank/${label.id}`, opsAlexToken, {
      isActive: false,
      version: data<AtmRefLabelDto>(renamed).version,
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(data<AtmRefLabelDto>(archived).isActive).toBe(false);
  });

  it('3 — Operations move a machine to another area; its open register entry follows', async () => {
    const received = await openEntry('88881001', 'Smouha');
    const machineId = received.master.machineId as string;
    expect(received.master.action).toBe('create');

    const res = await call('patch', `/atm/machines/${machineId}/area`, opsAlexToken, {
      area: 'Miami',
      version: await versionOf(machineId),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmMachineDto>(res).area).toBe('Miami');
    expect((await machine(machineId)).area).toBe('Miami');
    expect((await getEntry(received.entry.id)).area).toBe('Miami');

    // One audit row each: the machine's own update, and the entry's — area only.
    const machineAudit = await AuditLogModel.find({
      'entityRef.moduleId': 'atm',
      'entityRef.entityType': 'machine',
      'entityRef.entityId': machineId,
      action: 'update',
    })
      .lean()
      .exec();
    expect(machineAudit).toHaveLength(1);
    const entryAudit = await AuditLogModel.find({
      'entityRef.moduleId': 'atm',
      'entityRef.entityType': 'registerEntry',
      'entityRef.entityId': received.entry.id,
      action: 'update',
    })
      .lean()
      .exec();
    expect(entryAudit).toHaveLength(1);
    expect(entryAudit[0]?.changes).toEqual([
      expect.objectContaining({ field: 'area', old: 'Smouha', new: 'Miami' }),
    ]);
  });

  it('3b — a legacy machine without __v/createdAt moves too (DEC-23, at version 0)', async () => {
    const raw = new Types.ObjectId();
    await AtmMachineModel.collection.insertOne({
      _id: raw,
      branchId: new Types.ObjectId(alexBranchId),
      bankName: 'NBE',
      machineCode: '88881002',
      name: 'Legacy ATM',
      zone: '',
      area: 'Smouha',
      isActive: true,
      isDeleted: false,
    });
    const res = await call('patch', `/atm/machines/${String(raw)}/area`, opsAlexToken, {
      area: 'Miami',
      version: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await machine(String(raw));
    expect(after.area).toBe('Miami');
    expect(after.__v).toBe(1);
    expect(after.createdAt).toBeInstanceOf(Date);
  });

  it('4 — no moveArea or manage → 403; a Tanta holder on an Alex machine → 404', async () => {
    const id = await addMachine(alexBranchId, '88881003');
    const version = await versionOf(id);
    const viewer = await call('patch', `/atm/machines/${id}/area`, viewerToken, {
      area: 'Miami',
      version,
    });
    expect(viewer.status).toBe(403);
    const tanta = await call('patch', `/atm/machines/${id}/area`, opsTantaToken, {
      area: 'Miami',
      version,
    });
    expect(tanta.status).toBe(404);
    const tantaLabel = await call(
      'patch',
      `/atm/ref-labels/area/${alexAreaLabelId}`,
      opsTantaToken,
      { name: 'Smouha East', version: await labelVersion(alexAreaLabelId) },
    );
    expect(tantaLabel.status).toBe(404);
    expect((await machine(id)).area).toBe('Smouha');
    expect((await machine(id)).__v).toBe(version);
  });
});

describe('a manage holder keeps every route (regression)', () => {
  it('5 — every data-edit route answers 2xx, and every AREA write moves the open entry (DEC-4)', async () => {
    const received = await openEntry('88882001', 'Smouha');
    const machineId = received.master.machineId as string;

    const single = await call('post', '/atm/machines', manageToken, {
      machineCode: '88882002',
      name: 'Single',
      bankName: 'NBE',
      area: 'Smouha',
    });
    expect(single.status, JSON.stringify(single.body)).toBe(201);
    // DEC-36: Alexandria is mapped, so the add is also an open, flagged receipt in the register.
    expect(data<AtmMachineCreateResultDto>(single)).toMatchObject({
      reactivated: false,
      register: { action: 'created', reason: null, bankCode: 'NBE' },
    });
    const bulk = await call('post', '/atm/machines/bulk', manageToken, {
      bankName: 'NBE',
      area: 'Smouha',
      machines: [{ machineCode: '88882003', name: 'Bulk' }],
    });
    expect(bulk.status, JSON.stringify(bulk.body)).toBe(200);

    // PATCH /:id moving the area → the open entry follows.
    const patched = await call('patch', `/atm/machines/${machineId}`, manageToken, {
      area: 'Gleem',
      version: await versionOf(machineId),
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect((await getEntry(received.entry.id)).area).toBe('Gleem');

    // A NAME edit by an administrator does not flow back into the register (DEC-4).
    const renamed = await call('patch', `/atm/machines/${machineId}`, manageToken, {
      name: 'Renamed by admin',
      version: await versionOf(machineId),
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect((await getEntry(received.entry.id)).name).toBe('Register 88882001');

    // Reassign-by-code → the open entry follows.
    const reassigned = await call('post', '/atm/machines/reassign-area', manageToken, {
      machineCode: '88882001',
      area: 'Sporting',
    });
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(200);
    expect((await getEntry(received.entry.id)).area).toBe('Sporting');

    // The Operations route accepts manage too.
    const moved = await call('patch', `/atm/machines/${machineId}/area`, manageToken, {
      area: 'Miami',
      version: await versionOf(machineId),
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await getEntry(received.entry.id)).area).toBe('Miami');

    const archived = await call(
      'patch',
      `/atm/machines/${data<AtmMachineDto>(single).id}`,
      manageToken,
      {
        isActive: false,
        version: data<AtmMachineDto>(single).version,
      },
    );
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const deleted = await call('post', '/atm/machines/bulk-delete', manageToken, {
      machineCodes: ['88882003'],
    });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);

    // DEC-38: the area move above left an active machine on «Gleem», so Gleem is now a label of the
    // branch, written by the save itself — typing it again is the existing-label 409.
    const automatic = await call('get', '/atm/ref-labels/options', manageToken);
    expect(automatic.status, JSON.stringify(automatic.body)).toBe(200);
    expect(data<AtmRefLabelOptionsDto>(automatic).areas.map((area) => area.name)).toContain(
      'Gleem',
    );
    expect(
      (await call('post', '/atm/ref-labels/area', manageToken, { name: 'Gleem' })).status,
    ).toBe(409);

    const label = await call('post', '/atm/ref-labels/area', manageToken, { name: 'Mandara' });
    expect(label.status, JSON.stringify(label.body)).toBe(201);
    const labelDto = data<AtmRefLabelDto>(label);
    const relabelled = await call('patch', `/atm/ref-labels/area/${labelDto.id}`, manageToken, {
      name: 'Mandara Bay',
      version: labelDto.version,
    });
    expect(relabelled.status, JSON.stringify(relabelled.body)).toBe(200);
    const removed = await call('delete', `/atm/ref-labels/area/${labelDto.id}`, manageToken);
    expect(removed.status).toBe(204);
  });
});

describe('navigation — the data-edit row moves to the Operations key (DEC-5 as narrowed by O-1)', () => {
  it('6 — a row still on atmMachine.manage is corrected; an administrator’s own choice is not', async () => {
    // First sync on an empty catalog seeds every row at today's keys.
    await syncNavigationCatalog();
    const seeded = await applicationRepository.findOne({ route: '/atm/data-edit' });
    expect(seeded?.permissionKey).toBe('atmRefLabel.create');
    expect(await applicationRepository.findOne({ route: '/atm/register' })).not.toBeNull();
    expect(await applicationRepository.findOne({ route: '/atm/register/report' })).not.toBeNull();

    // An install that shipped the row on the old key: corrected on the next boot.
    const old = await applicationService.update(
      String(seeded?._id),
      { permissionKey: 'atmMachine.manage', version: seeded?.__v ?? 0 },
      adminId,
    );
    expect(old.permissionKey).toBe('atmMachine.manage');
    await syncNavigationCatalog();
    const corrected = await applicationRepository.findOne({ route: '/atm/data-edit' });
    expect(corrected?.permissionKey).toBe('atmRefLabel.create');

    // An administrator chose another key: left exactly as chosen.
    await applicationService.update(
      String(corrected?._id),
      { permissionKey: 'atmMachine.moveArea', version: corrected?.__v ?? 0 },
      adminId,
    );
    await syncNavigationCatalog();
    const chosen = await applicationRepository.findOne({ route: '/atm/data-edit' });
    expect(chosen?.permissionKey).toBe('atmMachine.moveArea');
  });
});

describe('branch reach on the Operations paths (DEC-29, F-4)', () => {
  it('9 — a label is never filed in a branch only an unrelated key reaches', async () => {
    const viaTanta = await call(
      'post',
      '/atm/ref-labels/bank',
      opsReachToken,
      { name: 'NBE FOREX' },
      tantaBranchId,
    );
    expect(viaTanta.status, JSON.stringify(viaTanta.body)).toBe(403);

    const atHome = await call('post', '/atm/ref-labels/bank', opsReachToken, {
      name: 'BM FOREX',
    });
    expect(atHome.status, JSON.stringify(atHome.body)).toBe(201);
    expect(data<AtmRefLabelDto>(atHome).branchId).toBe(alexBranchId);
  });

  // Review finding F1: before this feature every `manage` holder could add a label in the branch
  // they act in. A finer-scoped one reaches no whole branch, so the reach check alone took that
  // away; the branch they are PLACED in is still theirs (no other key can stretch it).
  it('9b — a department- or own-scoped manage holder still adds labels in their own branch', async () => {
    for (const [who, token, home] of [
      ['department', manageDeptToken, tantaBranchId],
      ['own', manageOwnToken, alexBranchId],
    ] as const) {
      for (const kind of ['bank', 'area'] as const) {
        const res = await call('post', `/atm/ref-labels/${kind}`, token, {
          name: `${who} ${kind} label`,
        });
        expect(res.status, `${who} ${kind}: ${JSON.stringify(res.body)}`).toBe(201);
        expect(data<AtmRefLabelDto>(res).branchId).toBe(home);
      }
    }
    // The fallback is manage's alone: the new key at department scope still needs whole-branch reach.
    const deptOps = await call('post', '/atm/ref-labels/bank', opsDeptToken, { name: 'Dept bank' });
    expect(deptOps.status, JSON.stringify(deptOps.body)).toBe(403);
  });

  it('9c — a manage grant delegated over Alex files no label in the Tanta its holder is placed in', async () => {
    const placed = await call('post', '/atm/ref-labels/bank', manageReachToken, {
      name: 'Deputy bank',
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(403);
    const reached = await call(
      'post',
      '/atm/ref-labels/bank',
      manageReachToken,
      { name: 'Deputy bank' },
      alexBranchId,
    );
    expect(reached.status, JSON.stringify(reached.body)).toBe(201);
    expect(data<AtmRefLabelDto>(reached).branchId).toBe(alexBranchId);
  });

  it('10 — department-scoped moveArea / label edit on Alex rows → 404; a branch holder in Alex → 200', async () => {
    const id = await addMachine(alexBranchId, '88883001');
    const labelId = await addLabel(alexBranchId, 'area', 'Agami');

    const deptMove = await call('patch', `/atm/machines/${id}/area`, opsDeptToken, {
      area: 'Miami',
      version: await versionOf(id),
    });
    expect(deptMove.status).toBe(404);
    const deptLabel = await call('patch', `/atm/ref-labels/area/${labelId}`, opsDeptToken, {
      name: 'Agami West',
      version: await labelVersion(labelId),
    });
    expect(deptLabel.status).toBe(404);

    const branchMove = await call('patch', `/atm/machines/${id}/area`, opsAlexToken, {
      area: 'Miami',
      version: await versionOf(id),
    });
    expect(branchMove.status, JSON.stringify(branchMove.body)).toBe(200);
    const branchLabel = await call('patch', `/atm/ref-labels/area/${labelId}`, opsAlexToken, {
      name: 'Agami West',
      version: await labelVersion(labelId),
    });
    expect(branchLabel.status, JSON.stringify(branchLabel.body)).toBe(200);
  });
});
