// Recovery machinery for the recruitment module: the outbox sweep (I15) and the timeline repair
// task (I5).
//
// Both exist for the same reason and neither can be tested by a happy path: they are what runs when
// something ALREADY went wrong. So every test here breaks the database on purpose — deleting a
// timeline entry, un-dispatching an event, wedging a consumer — and then asserts that the scheduled
// task puts it back, exactly once, without inventing anything.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type ApplicantDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { reconcileRecruitmentTimeline } from '../../src/modules/hr/recruitment/recruitment.reconciler';
import { RecruitmentTimelineModel } from '../../src/modules/hr/recruitment/timeline/recruitment-timeline.model';
import { WorkflowEventModel } from '../../src/modules/hr/recruitment/workflow/workflow-event.model';
import {
  dispatchPendingWorkflowEvents,
  onWorkflowEvent,
  registerRecruitmentWorkflowConsumers,
  resetRecruitmentWorkflowConsumerRegistration,
  resetWorkflowConsumers,
} from '../../src/modules/hr/recruitment/workflow';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { mutated } from './helpers/workflow-envelope';

const PASSWORD = 'Str0ng#Pass!';
const REQUISITION_ID = '64b1f0aaaaaaaaaaaaaaaaaa';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let phoneCounter = 70_000_000;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-recovery-test-${Date.now()}`;
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

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/**
 * A distinct valid Egyptian national ID per call. The ID gate refuses to verify a candidate who
 * has none, and a live candidate's national ID is unique, so every applicant needs its own.
 */
let nidCounter = 10_000;
const nextNationalId = (): string => `299123101${String(nidCounter++).padStart(5, '0')}`;

const sourceId = async (): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/hr/applicant-sources')
    .query({ pageSize: 50 })
    .set('Authorization', `Bearer ${adminToken}`);
  const found = (res.body as { data: { id: string; key: string }[] }).data.find(
    (s) => s.key === 'internalHr',
  );
  if (found === undefined) throw new Error('internalHr source not seeded');
  return found.id;
};

const registerApplicant = async (): Promise<ApplicantDto> => {
  const res = await request(app)
    .post('/api/v1/hr/applicants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      jobRequisitionId: REQUISITION_ID,
      sourceId: await sourceId(),
      intakeChannel: 'internal',
      identity: { fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
    });
  expect(res.status).toBe(201);
  return mutated<ApplicantDto>(res);
};

const verifyIdentity = async (applicant: ApplicantDto): Promise<void> => {
  const res = await request(app)
    .post(`/api/v1/hr/applicants/${applicant.id}/verify-identity`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ nationalId: nextNationalId(), version: applicant.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

/** Entries as they actually sit in the collection — the tests break and inspect storage directly. */
const entries = async (applicantId: string): Promise<{ eventId: string; type: string; sourceKey: string }[]> =>
  RecruitmentTimelineModel.find({ applicantId })
    .select('eventId type sourceKey')
    .lean<{ eventId: string; type: string; sourceKey: string }[]>()
    .exec();

const eventsFor = async (
  applicantId: string,
): Promise<{ eventId: string; name: string; dispatchedAt: Date | null; dispatchAttempts: number }[]> =>
  WorkflowEventModel.find({ applicantId })
    .select('eventId name dispatchedAt dispatchAttempts')
    .lean<{ eventId: string; name: string; dispatchedAt: Date | null; dispatchAttempts: number }[]>()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
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

  adminToken = await (async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@ecms.local', password: PASSWORD });
    expect(res.status).toBe(200);
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  })();
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

afterEach(async () => {
  await getCache().delByPrefix('rl:');
  // Whatever a test wedged into the dispatcher, the next one starts from the real consumer set.
  resetWorkflowConsumers();
  resetRecruitmentWorkflowConsumerRegistration();
  registerRecruitmentWorkflowConsumers();
});

describe('outbox recovery sweep (I15)', () => {
  it('delivers an event that was committed but whose dispatch never ran', async () => {
    const applicant = await registerApplicant();
    const [event] = await eventsFor(applicant.id);
    expect(event, 'registration materializes the screening row and publishes stageEntered').toBeDefined();
    expect(event?.dispatchedAt).not.toBeNull();

    // The crash: the transaction committed, the process died before the publish. Both halves of
    // that state are reproduced — the event is back in the queue and its projection never happened.
    await WorkflowEventModel.updateOne(
      { eventId: event!.eventId },
      { $set: { dispatchedAt: null } },
    ).exec();
    await RecruitmentTimelineModel.deleteOne({ eventId: event!.eventId }).exec();
    expect((await entries(applicant.id)).map((e) => e.eventId)).not.toContain(event!.eventId);

    const dispatched = await dispatchPendingWorkflowEvents();

    expect(dispatched).toBeGreaterThanOrEqual(1);
    expect((await entries(applicant.id)).map((e) => e.eventId)).toContain(event!.eventId);
    const [after] = await eventsFor(applicant.id);
    expect(after?.dispatchedAt).not.toBeNull();
  });

  it('leaves the event queued when a consumer fails, and delivers it once the consumer recovers', async () => {
    const applicant = await registerApplicant();
    const [event] = await eventsFor(applicant.id);
    await WorkflowEventModel.updateOne(
      { eventId: event!.eventId },
      { $set: { dispatchedAt: null } },
    ).exec();
    await RecruitmentTimelineModel.deleteOne({ eventId: event!.eventId }).exec();

    // The interruption: one consumer is down. The healthy ones still run — that is the point of
    // per-consumer isolation — but the event must NOT be marked delivered.
    let down = true;
    onWorkflowEvent('test.flaky-consumer', '*', async () => {
      if (down) throw new Error('projection store unreachable');
    });

    expect(await dispatchPendingWorkflowEvents()).toBe(0);
    const wedged = (await eventsFor(applicant.id)).find((e) => e.eventId === event!.eventId);
    expect(wedged?.dispatchedAt).toBeNull();
    expect(wedged?.dispatchAttempts).toBeGreaterThanOrEqual(1);

    // The consumer comes back; the next sweep is all it takes.
    down = false;
    expect(await dispatchPendingWorkflowEvents()).toBeGreaterThanOrEqual(1);
    const healed = (await eventsFor(applicant.id)).find((e) => e.eventId === event!.eventId);
    expect(healed?.dispatchedAt).not.toBeNull();
    expect((await entries(applicant.id)).map((e) => e.eventId)).toContain(event!.eventId);
  });

  it('is safe to run when there is nothing to do', async () => {
    await dispatchPendingWorkflowEvents();
    expect(await dispatchPendingWorkflowEvents()).toBe(0);
  });

  it('never delivers the same event twice — the projection keeps one entry per eventId', async () => {
    const applicant = await registerApplicant();
    const [event] = await eventsFor(applicant.id);

    await WorkflowEventModel.updateOne(
      { eventId: event!.eventId },
      { $set: { dispatchedAt: null } },
    ).exec();
    await dispatchPendingWorkflowEvents();
    await WorkflowEventModel.updateOne(
      { eventId: event!.eventId },
      { $set: { dispatchedAt: null } },
    ).exec();
    await dispatchPendingWorkflowEvents();

    const projected = (await entries(applicant.id)).filter((e) => e.eventId === event!.eventId);
    expect(projected).toHaveLength(1);
  });
});

describe('timeline reconciliation (I5)', () => {
  it('replays an event whose projection is missing, keeping the original eventId', async () => {
    const applicant = await registerApplicant();
    const [event] = await eventsFor(applicant.id);
    await RecruitmentTimelineModel.deleteOne({ eventId: event!.eventId }).exec();

    const report = await reconcileRecruitmentTimeline();

    expect(report.eventsReplayed).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBe(0);
    // The identity is the event's, not a fresh one: deep links and client caches key on it (I9).
    const rebuilt = (await entries(applicant.id)).find((e) => e.eventId === event!.eventId);
    expect(rebuilt).toBeDefined();
  });

  it('rebuilds the `applied` entry a swallowed write lost', async () => {
    const applicant = await registerApplicant();
    const before = (await entries(applicant.id)).find((e) => e.type === 'applied');
    expect(before, 'registration writes `applied`').toBeDefined();

    // `applied` has no workflow event behind it: its writer is `recordSafe`, which logs and
    // swallows so a history failure never fails a registration. Nothing would replay it.
    await RecruitmentTimelineModel.deleteOne({ sourceKey: before!.sourceKey }).exec();
    expect((await entries(applicant.id)).some((e) => e.type === 'applied')).toBe(false);

    const report = await reconcileRecruitmentTimeline();

    expect(report.appliedRebuilt).toBeGreaterThanOrEqual(1);
    const rebuilt = (await entries(applicant.id)).find((e) => e.type === 'applied');
    expect(rebuilt).toBeDefined();
    // The SAME key — which is what makes the rebuild a no-op next time instead of a duplicate.
    expect(rebuilt?.sourceKey).toBe(before!.sourceKey);
  });

  it('rebuilds `identityVerified`, discriminated by the verification instant', async () => {
    const applicant = await registerApplicant();
    await verifyIdentity(applicant);
    const before = (await entries(applicant.id)).find((e) => e.type === 'identityVerified');
    expect(before).toBeDefined();

    await RecruitmentTimelineModel.deleteOne({ sourceKey: before!.sourceKey }).exec();
    const report = await reconcileRecruitmentTimeline();

    expect(report.identityRebuilt).toBeGreaterThanOrEqual(1);
    const rebuilt = (await entries(applicant.id)).find((e) => e.type === 'identityVerified');
    expect(rebuilt?.sourceKey).toBe(before!.sourceKey);
  });

  it('changes nothing on a healthy database, however often it runs', async () => {
    const applicant = await registerApplicant();
    await verifyIdentity(applicant);
    await reconcileRecruitmentTimeline();

    const before = (await entries(applicant.id)).map((e) => e.sourceKey).sort();
    const report = await reconcileRecruitmentTimeline();

    expect(report).toEqual({ eventsReplayed: 0, appliedRebuilt: 0, identityRebuilt: 0, failed: 0 });
    expect((await entries(applicant.id)).map((e) => e.sourceKey).sort()).toEqual(before);
  });

  it('repairs a candidate whose history was lost entirely', async () => {
    const applicant = await registerApplicant();
    await verifyIdentity(applicant);
    const before = (await entries(applicant.id)).map((e) => e.sourceKey).sort();
    expect(before.length).toBeGreaterThanOrEqual(3); // applied + stageEntered + identityVerified

    await RecruitmentTimelineModel.deleteMany({ applicantId: applicant.id }).exec();
    expect(await entries(applicant.id)).toHaveLength(0);

    await reconcileRecruitmentTimeline();

    expect((await entries(applicant.id)).map((e) => e.sourceKey).sort()).toEqual(before);
  });
});
