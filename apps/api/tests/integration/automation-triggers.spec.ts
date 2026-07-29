// A-5 — the trigger bridge: a published event becomes automation runs.
//
// The rules under test are the ones that make dispatch safe: only ACTIVE workflows for the event
// fire, filters decide match against the real payload, the same event never starts two runs for
// one workflow (idempotency), a re-entrant depth is refused, and a workflow with no provider yet is
// recorded as `skipped` rather than dropped.
//
// Workflows are created through the API (draft → active), then given a providerRef directly in the
// DB — that is A-6's job, which does not exist yet, so the test stands in for it to reach the
// dispatch path the bridge owns.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  automationPermissions,
  platformPermissions,
  SettingKeys,
  type AutomationWorkflowDto,
  type EventEnvelope,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { automationModule } from '../../src/modules/automation/automation.module';
import { moduleManifests } from '../../src/modules';
import { dispatchForEvent, handleTriggerEvent } from '../../src/modules/automation/triggers';
import { AutomationWorkflowModel } from '../../src/modules/automation/workflows/workflow.model';
import { AutomationExecutionModel } from '../../src/modules/automation/executions/execution.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { type AuthContext } from '../../src/shared/types';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let ownerId: string;
let keyCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-automation-triggers-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
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

// Privileged accounts must enroll TOTP at login when `TotpEnforcedForPrivileged` is on (its
// declared default). This suite grants a system role, so without turning it off the login returns
// an enrollment challenge with no access token and every request 401s. The seed disables it;
// bootPlatform does not run that seed, so the suite does it explicitly (mirrors platform.spec).
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

const body = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const nextKey = (): string => `wf-${(keyCounter += 1)}-${Date.now() % 100000}`;

/** Create → enable → (stand in for A-6) give it a provider ref so dispatch has a target. */
const liveWorkflow = async (
  event: string,
  filters: Record<string, unknown>[] = [],
  withProvider = true,
): Promise<AutomationWorkflowDto> => {
  const created = await request(app)
    .post('/api/v1/automation/workflows')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      key: nextKey(),
      name: { en: 'W', ar: 'و' },
      trigger: { kind: 'event', event, filters },
    });
  expect(created.status).toBe(201);
  const wf = body<AutomationWorkflowDto>(created);

  await request(app)
    .post(`/api/v1/automation/workflows/${wf.id}/enabled`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled: true, version: wf.version });

  await AutomationWorkflowModel.updateOne(
    { _id: new Types.ObjectId(wf.id) },
    {
      $set: withProvider
        ? { providerRef: { providerId: 'null', ref: `wf_${wf.id}` } }
        : { providerRef: null },
    },
  ).exec();
  return wf;
};

let eventCounter = 0;
const envelope = (name: string, payload: unknown): EventEnvelope => ({
  id: `evt_${(eventCounter += 1)}_${Date.now()}`,
  name,
  schemaVersion: 1,
  occurredAt: new Date(),
  payload,
});

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
  ownerId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(ownerId, String(superAdmin._id), 'organization');
  await disableTotpEnforcement(ownerId);
  adminToken = await login('admin@ecms.local');
}, 120_000);

beforeEach(async () => {
  await AutomationExecutionModel.deleteMany({}).exec();
  await AutomationWorkflowModel.deleteMany({}).exec();
});

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('dispatch', () => {
  it('fires an active workflow subscribed to the event and records a running execution', async () => {
    const wf = await liveWorkflow('hr.employee.created');
    const summary = await dispatchForEvent(
      envelope('hr.employee.created', { employeeId: 'e1', origin: 'direct' }),
    );

    expect(summary).toMatchObject({ matched: 1, dispatched: 1 });
    const rows = await AutomationExecutionModel.find({ workflowId: wf.id }).lean().exec();
    expect(rows).toHaveLength(1);
    // The null provider accepted the dispatch, so the run is `running` with its provider ref.
    expect(rows[0]?.status).toBe('running');
    expect(rows[0]?.providerRef?.providerId).toBe('null');
    expect(rows[0]?.actorUserId?.toString()).toBe(ownerId);
  });

  it('does not fire a workflow that is only a draft', async () => {
    const created = await request(app)
      .post('/api/v1/automation/workflows')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: nextKey(), name: { en: 'W', ar: 'و' }, trigger: { kind: 'event', event: 'hr.employee.created' } });
    // Never enabled — still a draft.
    const summary = await dispatchForEvent(envelope('hr.employee.created', {}));
    expect(created.status).toBe(201);
    expect(summary.matched).toBe(0);
  });

  it('does not fire a workflow subscribed to a different event', async () => {
    await liveWorkflow('hr.employee.exited');
    const summary = await dispatchForEvent(envelope('hr.employee.created', {}));
    expect(summary.matched).toBe(0);
  });

  it('records `skipped` for a workflow that has no provider workflow yet', async () => {
    // An enabled workflow before A-6 has pushed a graph: dispatch has no target, so the run is
    // recorded as skipped rather than invented or dropped.
    const wf = await liveWorkflow('hr.employee.created', [], false);
    const summary = await dispatchForEvent(envelope('hr.employee.created', {}));
    expect(summary.skipped).toBe(1);
    const row = await AutomationExecutionModel.findOne({ workflowId: wf.id }).lean().exec();
    expect(row?.status).toBe('skipped');
  });
});

describe('filters decide the match', () => {
  it('fires when the filter passes', async () => {
    await liveWorkflow('hr.employee.created', [{ field: 'origin', op: 'eq', value: 'direct' }]);
    const summary = await dispatchForEvent(
      envelope('hr.employee.created', { origin: 'direct' }),
    );
    expect(summary.dispatched).toBe(1);
  });

  it('does not fire, and records nothing, when the filter fails', async () => {
    await liveWorkflow('hr.employee.created', [{ field: 'origin', op: 'eq', value: 'direct' }]);
    const summary = await dispatchForEvent(
      envelope('hr.employee.created', { origin: 'recruitment' }),
    );
    expect(summary).toMatchObject({ matched: 1, filteredOut: 1, dispatched: 0 });
    expect(await AutomationExecutionModel.countDocuments({})).toBe(0);
  });
});

describe('idempotency', () => {
  it('starts at most one run per (event, workflow), even on redelivery', async () => {
    const wf = await liveWorkflow('hr.employee.created');
    const env = envelope('hr.employee.created', { employeeId: 'e1' });

    await dispatchForEvent(env);
    // The bus can redeliver the same event (a retry, two workers). The second pass must not create
    // a second run — the unique index on (eventId, workflowId) is what guarantees it.
    const second = await dispatchForEvent(env);

    expect(second.dispatched).toBe(0);
    expect(await AutomationExecutionModel.countDocuments({ workflowId: wf.id })).toBe(1);
  });
});

describe('re-entrancy guard', () => {
  it('refuses to dispatch past the depth ceiling', async () => {
    await liveWorkflow('hr.employee.created');
    // A depth beyond MAX_TRIGGER_DEPTH is where `entity.updated → update entity` would loop.
    const summary = await dispatchForEvent(envelope('hr.employee.created', {}), 4);
    expect(summary).toMatchObject({ matched: 0, dispatched: 0 });
    expect(await AutomationExecutionModel.countDocuments({})).toBe(0);
  });

  it('carries the depth onto the execution row', async () => {
    const wf = await liveWorkflow('hr.employee.created');
    await dispatchForEvent(envelope('hr.employee.created', {}), 2);
    const row = await AutomationExecutionModel.findOne({ workflowId: wf.id }).lean().exec();
    expect(row?.depth).toBe(2);
  });
});

describe('the async path (event handler → queue job → dispatch)', () => {
  it('runs the dispatch through the automation queue, not on the event handler', async () => {
    // `handleTriggerEvent` only enqueues; the job handler does the work. In tests `enqueue` runs
    // the registered handler inline, so this proves the full wiring — subscription → enqueue →
    // job handler → execution row — end to end.
    const wf = await liveWorkflow('hr.employee.created');
    await handleTriggerEvent(envelope('hr.employee.created', { employeeId: 'e-async' }));

    const rows = await AutomationExecutionModel.find({ workflowId: wf.id }).lean().exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('running');
  });

  it('is idempotent across the queue: a redelivered event creates one run', async () => {
    const wf = await liveWorkflow('hr.employee.created');
    const env = envelope('hr.employee.created', { employeeId: 'e-dup' });
    await handleTriggerEvent(env);
    await handleTriggerEvent(env); // same event id — the execution index rejects the second run
    expect(await AutomationExecutionModel.countDocuments({ workflowId: wf.id })).toBe(1);
  });
});

describe('the snapshot is redacted', () => {
  it('never stores a secret-shaped field from the event payload', async () => {
    const wf = await liveWorkflow('hr.employee.created');
    await dispatchForEvent(
      envelope('hr.employee.created', { employeeId: 'e1', apiKey: 'sk-should-not-persist' }),
    );
    const row = await AutomationExecutionModel.findOne({ workflowId: wf.id }).lean().exec();
    expect(JSON.stringify(row?.inputSnapshot)).not.toContain('sk-should-not-persist');
  });
});
