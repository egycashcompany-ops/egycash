// A-3 — the automation registry: workflows and variables over HTTP.
//
// The rules under test are the ones the design calls central and that nothing else can enforce:
// a workflow runs as its OWNER, in the owner's branch; a deactivated owner's workflows are
// suspended rather than left running; enabling is a separate grant from editing and a stricter
// gate than saving; and a trigger is validated against the real event catalogue.
//
// The module is registered explicitly here rather than via `moduleManifests`, because
// `AUTOMATION_ENABLED` is off by default — which is itself asserted below.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  automationPermissions,
  platformPermissions,
  SettingKeys,
  type AutomationWorkflowDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { automationModule } from '../../src/modules/automation/automation.module';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { type AuthContext } from '../../src/shared/types';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

// Privileged accounts must enroll TOTP at login when `TotpEnforcedForPrivileged` is on (its
// declared default). These tests grant a system role, so without turning it off the login
// returns an enrollment challenge with no access token and every request 401s. The seed disables
// it; bootPlatform does not run that seed, so the suite does it explicitly (mirrors platform.spec).
const disableTotpEnforcement = async (userId: string): Promise<void> => {
  const ctx: AuthContext = {
    userId,
    sessionId: 'test-setup',
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
};

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let ownerId: string;
let superAdminId: string;
let ownerToken: string;
let editorToken: string; // workflow.view/create/edit but NOT workflow.enable
let branchAId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-automation-registry-test-${Date.now()}`;
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

const createWorkflow = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/automation/workflows')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: { en: 'Welcome email', ar: 'بريد ترحيبي' },
      trigger: { kind: 'event', event: 'hr.employee.created' },
      ...body,
    });

const body = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;

let keyCounter = 0;
const nextKey = (): string => `wf-${(keyCounter += 1)}-${Date.now() % 100000}`;

beforeAll(async () => {
  await bootPlatform({
    mongoUri: await resolveMongoUri(),
    modules: [...moduleManifests, automationModule],
  });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...automationPermissions].map((p) => p.key),
  );
  superAdminId = String(superAdmin._id);
  const adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, superAdminId, 'organization');
  await disableTotpEnforcement(adminId);
  adminToken = await login('admin@ecms.local');

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { en: 'Cairo', ar: 'القاهرة' }, code: '01' });
  expect(branchRes.status).toBe(201);
  branchAId = body<{ id: string }>(branchRes).id;

  ownerId = await mkUser('owner@ecms.local', branchAId);
  await rbacService.ensureAssignment(ownerId, superAdminId, 'organization');

  // Can author a workflow, cannot decide it may start running (§7.1).
  const editorRole = await rbacService.createRole(
    {
      name: { en: 'Automation author', ar: 'محرر الأتمتة' },
      permissionKeys: ['workflow.view', 'workflow.create', 'workflow.edit'],
    },
    adminId,
  );
  const editorId = await mkUser('editor@ecms.local', branchAId);
  await rbacService.ensureAssignment(editorId, String(editorRole._id), 'organization');

  ownerToken = await login('owner@ecms.local');
  editorToken = await login('editor@ecms.local');
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('the feature flag', () => {
  it('keeps automation out of the default manifest list', () => {
    // `AUTOMATION_ENABLED` is off by default, so a deploy of `main` mounts none of this. The suite
    // registers the module explicitly, which is exactly what flipping the flag does at boot.
    expect(moduleManifests.map((m) => m.id)).not.toContain('automation');
  });
});

describe('creating a workflow', () => {
  it('creates it as a draft owned by the caller, in the caller′s branch', async () => {
    const res = await createWorkflow(ownerToken, { key: nextKey() });
    expect(res.status).toBe(201);
    const workflow = body<AutomationWorkflowDto>(res);
    // Never `active`: the first anyone hears of a new automation must not be it having run.
    expect(workflow.status).toBe('draft');
    expect(workflow.owner.id).toBe(ownerId);
    expect(workflow.branchId).toBe(branchAId);
    expect(workflow.providerRef).toBeNull();
  });

  it('refuses a trigger on an event nobody publishes', async () => {
    const res = await createWorkflow(ownerToken, {
      key: nextKey(),
      trigger: { kind: 'event', event: 'hr.employee.promoted' },
    });
    expect(res.status).toBe(422);
  });

  it('refuses a filter on a field the event does not carry', async () => {
    const res = await createWorkflow(ownerToken, {
      key: nextKey(),
      trigger: {
        kind: 'event',
        event: 'hr.employee.created',
        filters: [{ field: 'salary', op: 'gt', value: 1 }],
      },
    });
    expect(res.status).toBe(422);
  });

  it('returns warnings without blocking the save', async () => {
    const res = await createWorkflow(ownerToken, {
      key: nextKey(),
      trigger: {
        kind: 'event',
        event: 'hr.jobOffer.sent',
        filters: [{ field: 'applicantCode', op: 'eq', value: 'A-1' }],
      },
    });
    expect(res.status).toBe(201);
    expect(body<{ warnings: unknown[] }>(res).warnings.length).toBeGreaterThan(0);
  });

  it('refuses a duplicate key', async () => {
    const key = nextKey();
    expect((await createWorkflow(ownerToken, { key })).status).toBe(201);
    expect((await createWorkflow(ownerToken, { key })).status).toBe(422);
  });
});

describe('enabling', () => {
  it('is refused to someone who may edit but not enable', async () => {
    const created = await createWorkflow(editorToken, { key: nextKey() });
    expect(created.status).toBe(201);
    const workflow = body<AutomationWorkflowDto>(created);

    const res = await request(app)
      .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ enabled: true, version: workflow.version });
    expect(res.status).toBe(403);
  });

  it('activates a valid workflow and deactivates it again', async () => {
    const workflow = body<AutomationWorkflowDto>(await createWorkflow(ownerToken, { key: nextKey() }));

    const on = await request(app)
      .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ enabled: true, version: workflow.version });
    expect(on.status).toBe(200);
    expect(body<AutomationWorkflowDto>(on).status).toBe('active');

    const off = await request(app)
      .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ enabled: false, version: body<AutomationWorkflowDto>(on).version });
    expect(body<AutomationWorkflowDto>(off).status).toBe('disabled');
  });

  it('refuses to enable a workflow on an event with no publisher', async () => {
    // Saveable as a draft, but enabling would put a permanently inert workflow in the active list.
    const workflow = body<AutomationWorkflowDto>(
      await createWorkflow(ownerToken, {
        key: nextKey(),
        trigger: { kind: 'event', event: 'hr.evaluation.opened' },
      }),
    );
    const res = await request(app)
      .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ enabled: true, version: workflow.version });
    expect(res.status).toBe(422);
  });
});

describe('editing a live workflow', () => {
  it('drops it back to draft when the trigger changes', async () => {
    const workflow = body<AutomationWorkflowDto>(await createWorkflow(ownerToken, { key: nextKey() }));
    const enabled = body<AutomationWorkflowDto>(
      await request(app)
        .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ enabled: true, version: workflow.version }),
    );

    // Re-pointing a running automation at a different event silently changes what fires it.
    const res = await request(app)
      .patch(`/api/v1/automation/workflows/${workflow.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        trigger: { kind: 'event', event: 'hr.employee.exited' },
        version: enabled.version,
      });
    expect(res.status).toBe(200);
    expect(body<AutomationWorkflowDto>(res).status).toBe('draft');
  });

  it('refuses to delete an active workflow', async () => {
    const workflow = body<AutomationWorkflowDto>(await createWorkflow(ownerToken, { key: nextKey() }));
    const enabled = body<AutomationWorkflowDto>(
      await request(app)
        .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ enabled: true, version: workflow.version }),
    );
    const res = await request(app)
      .delete(`/api/v1/automation/workflows/${enabled.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(422);
  });
});

describe('ownership (§7.2)', () => {
  it('suspends a deactivated owner′s active workflows', async () => {
    const victimId = await mkUser('leaver@ecms.local', branchAId);
    await rbacService.ensureAssignment(victimId, superAdminId, 'organization');
    const victimToken = await login('leaver@ecms.local');

    const workflow = body<AutomationWorkflowDto>(
      await createWorkflow(victimToken, { key: nextKey() }),
    );
    await request(app)
      .post(`/api/v1/automation/workflows/${workflow.id}/enabled`)
      .set('Authorization', `Bearer ${victimToken}`)
      .send({ enabled: true, version: workflow.version });

    // Offboarding has to stop what they set in motion; otherwise a revoked account keeps acting.
    const victim = await userService.getById(victimId);
    await userService.changeStatus(
      victimId,
      { status: 'suspended', version: victim.__v },
      victimId,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    const after = await request(app)
      .get(`/api/v1/automation/workflows/${workflow.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(body<AutomationWorkflowDto>(after).status).toBe('suspended');
  });

  it('refuses to re-enable a suspended workflow without a transfer', async () => {
    const list = await request(app)
      .get('/api/v1/automation/workflows')
      .query({ status: 'suspended' })
      .set('Authorization', `Bearer ${adminToken}`);
    const [suspended] = body<AutomationWorkflowDto[]>(list);
    expect(suspended).toBeDefined();

    const res = await request(app)
      .post(`/api/v1/automation/workflows/${String(suspended?.id)}/enabled`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, version: suspended?.version });
    expect(res.status).toBe(422);

    // A transfer clears the suspension but leaves it as a draft: what it may now do has changed.
    const transferred = await request(app)
      .post(`/api/v1/automation/workflows/${String(suspended?.id)}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ownerUserId: ownerId, version: suspended?.version });
    expect(transferred.status).toBe(200);
    expect(body<AutomationWorkflowDto>(transferred).status).toBe('draft');
    expect(body<AutomationWorkflowDto>(transferred).owner.id).toBe(ownerId);
  });
});

describe('the event catalogue endpoint', () => {
  it('serves the self-describing document', async () => {
    const res = await request(app)
      .get('/api/v1/automation/events')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const document = body<{ catalogVersion: string; digest: string; eventCount: number }>(res);
    expect(document.eventCount).toBeGreaterThan(50);
    expect(res.headers.etag).toBe(`"${document.digest}"`);
  });

  it('answers 304 when the client already has it', async () => {
    const first = await request(app)
      .get('/api/v1/automation/events')
      .set('Authorization', `Bearer ${ownerToken}`);
    const res = await request(app)
      .get('/api/v1/automation/events')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('If-None-Match', String(first.headers.etag));
    expect(res.status).toBe(304);
  });
});

describe('variables', () => {
  it('upserts by key rather than by id', async () => {
    const put = () =>
      request(app)
        .put('/api/v1/automation/variables/approverEmail')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'hr@ecms.local', scope: 'global' });

    const first = await put();
    expect(first.status).toBe(200);
    const second = await put();
    // Same row, not a duplicate — otherwise a workflow reads whichever the index returns first.
    expect(body<{ id: string }>(second).id).toBe(body<{ id: string }>(first).id);
  });

  it('requires the reference its scope depends on', async () => {
    const res = await request(app)
      .put('/api/v1/automation/variables/threshold')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '10', scope: 'branch' });
    expect(res.status).toBe(422);
  });

  it('refuses a caller without variable.edit', async () => {
    const res = await request(app)
      .put('/api/v1/automation/variables/threshold')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ value: '10', scope: 'global' });
    expect(res.status).toBe(403);
  });
});
