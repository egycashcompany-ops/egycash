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
import {
  queueMaterializerService,
  registerQueueMaterializer,
  resetQueueMaterializerRegistration,
} from '../../src/modules/hr/recruitment/materializer';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { InterviewModel } from '../../src/modules/hr/recruitment/interviews/interview.model';

const PASSWORD = 'Str0ng#Pass!';
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
 * A distinct valid Egyptian national ID per call, each carrying a birth date of its own. The ID
 * gate refuses to verify a candidate who has none, and a live candidate's national ID is unique,
 * so every applicant needs its own.
 *
 * The date moves with the serial for the reason spelled out in `helpers/national-id.ts`: a
 * National ID derives the applicant's birth date, duplicate detection matches on
 * `{ searchName, birthDate }`, and every candidate in this file shares one name — so a constant
 * date would make each registration a "duplicate" of the one before it.
 */
let nidCounter = 10_000;
const nextNationalId = (): string => {
  const n = nidCounter++;
  const dd = String((n % 28) + 1).padStart(2, '0');
  const mm = String((Math.floor(n / 28) % 12) + 1).padStart(2, '0');
  const yy = String((1980 + (Math.floor(n / 336) % 20)) % 100).padStart(2, '0');
  return `2${yy}${mm}${dd}01${String(n).padStart(5, '0')}`;
};

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
      sourceId: await sourceId(),
      intakeChannel: 'internal',
      identity: { nationalId: nextNationalId(), fullNameAr: 'أحمد محمد', nationality: 'Egyptian' },
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
  // `resetWorkflowConsumers()` drops EVERY subscriber, so the queue materializer has to be put
  // back too — it subscribes through the same registry, and without this it stays silently
  // unsubscribed for the rest of the file: registration still opens a screening row (that path
  // runs through the Applicants seam), but nothing would ever open the interview row an accepted
  // screening implies.
  resetWorkflowConsumers();
  resetRecruitmentWorkflowConsumerRegistration();
  registerRecruitmentWorkflowConsumers();
  resetQueueMaterializerRegistration();
  registerQueueMaterializer();
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

/**
 * I8/I11 — the boot backfill. `waiting` is a persisted row, so a candidate with no row is invisible
 * to every queue, counter and badge. Two populations have exactly that shape: applicants who moved
 * through the pipeline before I11 existed, and applicants whose materialization threw and was
 * swallowed so the decision that triggered it would still commit.
 *
 * Both are reproduced the same way — delete the row the live path created — because after the
 * deletion the two are indistinguishable in storage, which is the point: the backfill repairs a
 * STATE, not a history of how that state came about.
 */
describe('waiting-row backlog backfill (I8/I11)', () => {
  const liveScreenings = async (applicantId: string): Promise<{ status: string; attempt: number }[]> =>
    ScreeningModel.find({ applicantId, supersededAt: null, isDeleted: false })
      .select('status attempt -_id')
      .lean<{ status: string; attempt: number }[]>()
      .exec();

  const liveInterviews = async (
    applicantId: string,
  ): Promise<{ status: string; attempt: number; stageOrder: number }[]> =>
    InterviewModel.find({ applicantId, supersededAt: null, isDeleted: false })
      .select('status attempt stageOrder -_id')
      .lean<{ status: string; attempt: number; stageOrder: number }[]>()
      .exec();

  const acceptScreening = async (applicantId: string): Promise<void> => {
    const [row] = await ScreeningModel.find({ applicantId, supersededAt: null }).lean().exec();
    const res = await request(app)
      .post(`/api/v1/hr/screenings/${String(row!._id)}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'accepted', version: row!.__v });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  it('opens the screening row a candidate registered before I11 never got', async () => {
    const applicant = await registerApplicant();
    expect(await liveScreenings(applicant.id)).toHaveLength(1);

    // Rewind to the pre-refactor world: the applicant exists, the queue row does not.
    await ScreeningModel.deleteMany({ applicantId: applicant.id }).exec();
    expect(await liveScreenings(applicant.id)).toHaveLength(0);

    const report = await queueMaterializerService.backfillWaitingBacklog();

    expect(report.repaired).toBeGreaterThanOrEqual(1);
    expect(report.failed).toBe(0);
    expect(await liveScreenings(applicant.id)).toEqual([{ status: 'waiting', attempt: 1 }]);
  });

  it('resolves the stage from the candidate’s own records, not a stored cursor (I1)', async () => {
    const applicant = await registerApplicant();
    await verifyIdentity(applicant);
    await acceptScreening(applicant.id);
    const opened = await liveInterviews(applicant.id);
    expect(opened, 'accepting screening materializes the first interview stage').toHaveLength(1);

    // The screening decision survives; only the row it implied is gone.
    await InterviewModel.deleteMany({ applicantId: applicant.id }).exec();
    expect(await liveInterviews(applicant.id)).toHaveLength(0);

    await queueMaterializerService.backfillWaitingBacklog();

    const repaired = await liveInterviews(applicant.id);
    expect(repaired).toHaveLength(1);
    expect(repaired[0]?.status).toBe('waiting');
    expect(repaired[0]?.stageOrder).toBe(opened[0]?.stageOrder);
  });

  it('re-running writes nothing — which is what makes it safe on every boot', async () => {
    const applicant = await registerApplicant();
    await ScreeningModel.deleteMany({ applicantId: applicant.id }).exec();

    const first = await queueMaterializerService.backfillWaitingBacklog();
    expect(first.repaired).toBeGreaterThanOrEqual(1);
    const after = await liveScreenings(applicant.id);

    const second = await queueMaterializerService.backfillWaitingBacklog();

    expect(second.repaired).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.scanned).toBe(first.scanned);
    expect(await liveScreenings(applicant.id)).toEqual(after);
  });

  it('never re-opens a stage the candidate already left', async () => {
    const applicant = await registerApplicant();
    await verifyIdentity(applicant);
    await acceptScreening(applicant.id);
    const decided = await liveScreenings(applicant.id);
    expect(decided).toEqual([{ status: 'accepted', attempt: 1 }]);

    await queueMaterializerService.backfillWaitingBacklog();

    // A decided screening is not a missing one: no second attempt, no `waiting` row beside it.
    expect(await liveScreenings(applicant.id)).toEqual(decided);
  });

  it('leaves a departed candidate out of the pipeline entirely', async () => {
    const applicant = await registerApplicant();
    const withdrawn = await request(app)
      .post(`/api/v1/hr/applicants/${applicant.id}/withdraw`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'took another offer', version: applicant.version });
    expect(withdrawn.status).toBe(200);
    await ScreeningModel.deleteMany({ applicantId: applicant.id }).exec();

    await queueMaterializerService.backfillWaitingBacklog();

    // Withdrawal is a lifecycle terminal (I14); nothing re-admits them to a queue.
    expect(await liveScreenings(applicant.id)).toHaveLength(0);
  });
});
