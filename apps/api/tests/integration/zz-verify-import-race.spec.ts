// SCRATCH (review verification, deleted after the run): a register-import coupling that commits
// between the move's machine plan and its machine write — the window an import already running
// when the move starts can hit, since the import checks the fence only once, at its start.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import { SettingKeys, platformPermissions } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { AtmBranchMoveRunModel } from '../../src/modules/atm/branch-links/branch-move-run.model';
import { setBeforeTwinRetireForTests } from '../../src/modules/atm/branch-links/branch-move.service';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { coupleReceipt } from '../../src/modules/atm/register/register-coupling';
import { unitOfWork } from '../../src/platform/kernel/unit-of-work';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminId: string;
let MOH: string;
let OCT: string;

const call = (method: 'get' | 'put' | 'post', path: string, body?: Record<string, unknown>) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
  return body === undefined ? req : req.send(body);
};
const oid = (id: string) => new Types.ObjectId(id);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await bootPlatform({
    mongoUri: replSet.getUri(`zz-verify-${Date.now()}`),
    modules: moduleManifests,
  });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'zz-admin@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
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
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'zz-admin@ecms.local', password: PASSWORD });
  adminToken = (res.body as { data: { accessToken: string } }).data.accessToken;
  const mkBranch = async (code: string, ar: string, en: string) =>
    ((await call('post', '/platform/branches', { code, name: { ar, en } })).body as {
      data: { id: string };
    }).data.id;
  MOH = await mkBranch('80', 'المهندسين', 'Mohandessin');
  OCT = await mkBranch('81', 'أكتوبر', 'October');
  const linked = await call('put', '/atm/branch-links', {
    links: [{ branchId: OCT, actsAsBranchId: MOH }],
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
}, 180_000);

afterAll(async () => {
  setBeforeTwinRetireForTests(null);
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

const seedArchived = (branchId: string, code: string) =>
  AtmMachineModel.create({
    branchId: oid(branchId),
    bankName: 'NBE',
    machineCode: code,
    name: `ATM ${code}`,
    area: 'الدقي',
    isActive: false,
    isDeleted: false,
  });

/** What the import's coupling batch does for an open row of `code` filed (via the link) under MOH. */
const couplingCommitsInWindow = (code: string) => {
  setBeforeTwinRetireForTests(async () => {
    const result = await unitOfWork((session) =>
      coupleReceipt(
        { branchId: MOH, machineCode: code, name: `ATM ${code}`, area: 'الدقي', opsLabel: 'NBE' },
        adminId,
        session,
      ),
    );
    console.log('ZZ coupling result', JSON.stringify({ action: (result as { action?: string }).action, refused: (result as { refused?: string }).refused }));
  });
};

describe('zz verify', () => {
  it('a coupling in the machine-step window: with ux_branch_code', async () => {
    const indexes = await AtmMachineModel.collection.indexes();
    console.log('ZZ ux_branch_code present', indexes.some((i) => i.name === 'ux_branch_code'));
    await seedArchived(OCT, 'Q1');
    const pre = await call('get', `/atm/branch-links/${OCT}/move`);
    console.log('ZZ preview', pre.status, JSON.stringify((pre.body as { data: { blockers: unknown; canMove: boolean } }).data?.blockers), (pre.body as { data: { canMove: boolean } }).data?.canMove);
    couplingCommitsInWindow('Q1');
    const res = await call('post', `/atm/branch-links/${OCT}/move`, { expectedTargetBranchId: MOH });
    console.log('ZZ move', res.status, JSON.stringify(res.body));
    const run = await AtmBranchMoveRunModel.findOne({ sourceBranchId: oid(OCT) }).sort({ startedAt: -1 }).lean().exec();
    console.log('ZZ run', run?.state, run?.error);
    const q1 = await AtmMachineModel.find({ machineCode: 'Q1', isDeleted: false }, { branchId: 1, isActive: 1 }).lean().exec();
    console.log('ZZ Q1 rows', JSON.stringify(q1.map((r) => ({ branch: String(r.branchId) === MOH ? 'MOH' : String(r.branchId) === OCT ? 'OCT' : '?', isActive: r.isActive }))));
  });

  it('the same window where ux_branch_code is missing (risk R-9)', async () => {
    await AtmMachineModel.collection.dropIndex('ux_branch_code');
    await seedArchived(OCT, 'Q2');
    couplingCommitsInWindow('Q2');
    const res = await call('post', `/atm/branch-links/${OCT}/move`, { expectedTargetBranchId: MOH });
    console.log('ZZ move (no index)', res.status, JSON.stringify((res.body as { error?: unknown }).error ?? 'ok'));
    const q2 = await AtmMachineModel.find({ machineCode: 'Q2', isDeleted: false }, { branchId: 1, isActive: 1 }).lean().exec();
    console.log('ZZ Q2 rows', JSON.stringify(q2.map((r) => ({ branch: String(r.branchId) === MOH ? 'MOH' : String(r.branchId) === OCT ? 'OCT' : '?', isActive: r.isActive }))));
  });
});
