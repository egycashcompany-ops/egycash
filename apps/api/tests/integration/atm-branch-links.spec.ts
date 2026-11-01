// /atm/branch-links — «فروع تعمل معاً» on /atm/settings, and what a link does to a request, over
// real HTTP and real RBAC.
//
// The owner (2026-10-28), for ATM only: «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم
// والبيانات دي متسجله إنها المهندسين — يعني أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى
// والمهندسين شايف أكتوبر إنه شغال معاه بردو». So, with October linked to Mohandessin: an October
// employee with branch-scoped ATM keys reads Mohandessin's rows, what they write is filed under
// Mohandessin — which is how Mohandessin's people see it — and on every route outside ATM the same
// employee is still in October. A link that could misfile work (a branch acting as itself, a
// chain, a branch that does not exist or is retired) is a 400, and only `atmSettings.manage` held
// company-wide may change the list.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type AtmBranchLinksDto,
  type AtmMachineDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let mohandessinToken: string; // the operating bundle at BRANCH scope, placed in Mohandessin
let octoberToken: string; // the same bundle, placed in October
let branchHolderToken: string; // atmSettings.manage at BRANCH scope
let mohandessinId: string;
let octoberId: string;
let tantaId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-branch-links-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
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
  method: 'get' | 'put' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

const putLinks = (token: string, links: { branchId: string; actsAsBranchId: string }[]) =>
  call('put', '/atm/branch-links', token, { links });

const machineCodes = async (token: string): Promise<string[]> => {
  const res = await call('get', '/atm/machines?pageSize=100', token);
  expect(res.status).toBe(200);
  return data<AtmMachineDto[]>(res)
    .map((machine) => machine.machineCode)
    .sort();
};

const addMachine = async (token: string, machineCode: string): Promise<void> => {
  const res = await call('post', '/atm/machines/bulk', token, {
    bankName: 'SYN BANK',
    area: 'SYN AREA',
    machines: [{ machineCode, name: `SYN ${machineCode}` }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const userEmails = async (token: string): Promise<string[]> => {
  const res = await call('get', '/platform/users?pageSize=100', token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<{ email: string }[]>(res).map((user) => user.email);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-links-admin@ecms.local');
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
  adminToken = await login('atm-links-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await call('post', '/platform/branches', adminToken, { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  mohandessinId = await mkBranch('70', 'المهندسين', 'Mohandessin');
  octoberId = await mkBranch('71', 'أكتوبر', 'October');
  tantaId = await mkBranch('72', 'طنطا', 'Tanta');

  // The ATM operating bundle, branch-scoped — plus `user.view`, the non-ATM read the last
  // assertions use to show the same person is still in October outside ATM.
  const operatorRole = await rbacService.createRole(
    {
      name: { en: 'ATM operator', ar: 'مشغل صراف آلي' },
      permissionKeys: [
        'atmMachine.view',
        'atmMachine.manage',
        'atmMaintenance.view',
        'atmMaintenance.create',
        'user.view',
      ],
    },
    adminId,
  );
  const mohandessinUser = await mkUser('atm-links-mohandessin@ecms.local', mohandessinId);
  await rbacService.ensureAssignment(mohandessinUser, String(operatorRole._id), 'branch');
  mohandessinToken = await login('atm-links-mohandessin@ecms.local');
  const octoberUser = await mkUser('atm-links-october@ecms.local', octoberId);
  await rbacService.ensureAssignment(octoberUser, String(operatorRole._id), 'branch');
  octoberToken = await login('atm-links-october@ecms.local');

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holder = await mkUser('atm-links-holder@ecms.local', mohandessinId);
  await rbacService.ensureAssignment(holder, String(settingsRole._id), 'branch');
  branchHolderToken = await login('atm-links-holder@ecms.local');

  // Mohandessin's master, before any link.
  await addMachine(mohandessinToken, '8101');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('before any link, October is October', () => {
  it('starts with an empty list', async () => {
    const res = await call('get', '/atm/branch-links', adminToken);
    expect(res.status).toBe(200);
    expect(data<AtmBranchLinksDto>(res)).toEqual({ links: [] });
  });

  it('shows an October employee none of Mohandessin’s machines', async () => {
    expect(await machineCodes(octoberToken)).toEqual([]);
    expect(await machineCodes(mohandessinToken)).toEqual(['8101']);
  });
});

describe('October linked to Mohandessin', () => {
  it('saves the link and answers it with both names', async () => {
    const res = await putLinks(adminToken, [
      { branchId: octoberId, actsAsBranchId: mohandessinId },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const expected: AtmBranchLinksDto = {
      links: [
        {
          branchId: octoberId,
          branchName: { ar: 'أكتوبر', en: 'October' },
          actsAsBranchId: mohandessinId,
          actsAsBranchName: { ar: 'المهندسين', en: 'Mohandessin' },
        },
      ],
    };
    expect(data<AtmBranchLinksDto>(res)).toEqual(expected);
    expect(data<AtmBranchLinksDto>(await call('get', '/atm/branch-links', adminToken))).toEqual(
      expected,
    );
  });

  it('lets October see Mohandessin’s ATM work', async () => {
    expect(await machineCodes(octoberToken)).toEqual(['8101']);
  });

  it('files what October writes under Mohandessin — where Mohandessin sees it', async () => {
    await addMachine(octoberToken, '8102');
    const stored = await AtmMachineModel.findOne({ machineCode: '8102' }).lean().exec();
    expect(String(stored?.branchId)).toBe(mohandessinId);
    expect(await machineCodes(mohandessinToken)).toEqual(['8101', '8102']);
    expect(await machineCodes(octoberToken)).toEqual(['8101', '8102']);
  });

  // Express routes these to the ATM handlers too (case-insensitive, a doubled slash let through);
  // were the link to miss them, a crafted URL would read and file ATM work as October.
  it('applies however the ATM path is spelled', async () => {
    for (const path of [
      '/api/v1/ATM/machines?pageSize=100',
      '/api/v1//atm/machines?pageSize=100',
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${octoberToken}`);
      expect(res.status, path).toBe(200);
      expect(
        data<AtmMachineDto[]>(res)
          .map((machine) => machine.machineCode)
          .sort(),
        path,
      ).toEqual(['8101', '8102']);
    }
  });

  it('changes nothing outside ATM: the same person still lists October’s users', async () => {
    const seen = await userEmails(octoberToken);
    expect(seen).toContain('atm-links-october@ecms.local');
    expect(seen).not.toContain('atm-links-mohandessin@ecms.local');
  });
});

describe('a list that could misfile work is refused', () => {
  const refused = async (
    links: { branchId: string; actsAsBranchId: string }[],
    field: string,
    expected: string,
  ): Promise<void> => {
    const res = await putLinks(adminToken, links);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const details = (
      res.body as { error: { details: { field: string; code: string; message: string }[] } }
    ).error.details;
    expect(
      details.some((d) => d.field === field && (d.message === expected || d.code === expected)),
    ).toBe(true);
  };

  it('a branch acting as itself, a chain, a source on two rows', async () => {
    await refused(
      [{ branchId: octoberId, actsAsBranchId: octoberId }],
      'body.links.0.actsAsBranchId',
      'sameBranch',
    );
    await refused(
      [
        { branchId: octoberId, actsAsBranchId: mohandessinId },
        { branchId: mohandessinId, actsAsBranchId: tantaId },
      ],
      'body.links.0.actsAsBranchId',
      'chain',
    );
    await refused(
      [
        { branchId: octoberId, actsAsBranchId: mohandessinId },
        { branchId: octoberId, actsAsBranchId: tantaId },
      ],
      'body.links.1.branchId',
      'duplicateSource',
    );
  });

  it('a branch that does not exist, or is no longer active', async () => {
    const ghost = new Types.ObjectId().toHexString();
    await refused(
      [{ branchId: octoberId, actsAsBranchId: ghost }],
      'body.links.0.actsAsBranchId',
      'BRANCH_NOT_ACTIVE',
    );
    await BranchModel.updateOne(
      { _id: new Types.ObjectId(tantaId) },
      { $set: { status: 'inactive' } },
    ).exec();
    await refused(
      [{ branchId: tantaId, actsAsBranchId: mohandessinId }],
      'body.links.0.branchId',
      'BRANCH_NOT_ACTIVE',
    );
  });

  it('leaves the stored list as it was', async () => {
    const res = await call('get', '/atm/branch-links', adminToken);
    expect(data<AtmBranchLinksDto>(res).links.map((l) => [l.branchId, l.actsAsBranchId])).toEqual([
      [octoberId, mohandessinId],
    ]);
  });
});

describe('who may change the list', () => {
  it('refuses the key held for one branch, and a caller without it', async () => {
    expect((await call('get', '/atm/branch-links', branchHolderToken)).status).toBe(403);
    expect((await putLinks(branchHolderToken, [])).status).toBe(403);
    expect((await call('get', '/atm/branch-links', octoberToken)).status).toBe(403);
  });
});

describe('unlinked again', () => {
  it('puts October back in October at once', async () => {
    const res = await putLinks(adminToken, []);
    expect(res.status).toBe(200);
    expect(await machineCodes(octoberToken)).toEqual([]);
    expect(await machineCodes(mohandessinToken)).toEqual(['8101', '8102']);
  });
});
