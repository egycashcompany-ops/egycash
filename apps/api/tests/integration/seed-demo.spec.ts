// The demo-pipeline seed, exercised for real: it is the only way to know the cohorts actually
// land where they claim to. The seeder drives the REAL services, so a wrong call order does not
// produce slightly-off data — it throws, or it leaves a candidate at the wrong stage, and both
// show up here.
//
// The placement assertions are deliberately PER COHORT, looked up by each cohort's own intake key,
// not aggregate counts. An aggregate "ten are waiting at interviews" is satisfied by the wrong ten;
// "every member of the interview cohort has a waiting round, and nobody in the screening cohort
// has any interview at all" is not. The last case also reads the candidate TIMELINE, which only
// the workflow engine's projection writes — so it is evidence the candidates moved through the
// pipeline rather than being planted at their destination.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { seedDevData } from '../../src/seed-data';
import {
  DEMO_COHORT_SIZE,
  DEMO_INTAKE_PREFIX,
  DEMO_STAGES,
  resetDemoPipeline,
  seedDemoPipeline,
  type DemoStage,
} from '../../src/seed-demo';
import { ApplicantModel } from '../../src/modules/hr/recruitment/applicants/applicant.model';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { InterviewModel } from '../../src/modules/hr/recruitment/interviews/interview.model';
import { EvaluationModel } from '../../src/modules/hr/recruitment/evaluations/evaluation.model';
import { JobOfferModel } from '../../src/modules/hr/recruitment/job-offers/job-offer.model';
import { RecruitmentTimelineModel } from '../../src/modules/hr/recruitment/timeline/recruitment-timeline.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

let replSet: MongoMemoryReplSet | null = null;
let adminId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-seed-demo-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const demoFilter = { intakeKey: { $regex: `^${DEMO_INTAKE_PREFIX}` } };

/** The ten applicants of one cohort, found by the intake key that cohort stamps. */
const cohort = async (stage: DemoStage): Promise<Types.ObjectId[]> => {
  const rows = await ApplicantModel.find(
    { intakeKey: { $regex: `^${DEMO_INTAKE_PREFIX}${stage}:` } },
    { _id: 1 },
  )
    .lean()
    .exec();
  return rows.map((r) => r._id as Types.ObjectId);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  const seeded = await seedDevData();
  adminId = seeded.adminId;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('demo pipeline seed', () => {
  it('creates ten candidates per stage', async () => {
    const report = await seedDemoPipeline(adminId);

    expect(report.total).toBe(DEMO_STAGES.length * DEMO_COHORT_SIZE);
    for (const [stage, count] of Object.entries(report.created)) {
      expect(count, `${stage} cohort`).toBe(DEMO_COHORT_SIZE);
    }
    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(
      DEMO_STAGES.length * DEMO_COHORT_SIZE,
    );
    for (const stage of DEMO_STAGES) {
      expect((await cohort(stage)).length, `${stage} cohort size`).toBe(DEMO_COHORT_SIZE);
    }
  }, 300_000);

  it('leaves the `applicants` cohort at the ID gate and nowhere further', async () => {
    const ids = await cohort('applicants');
    const mine = { applicantId: { $in: ids } };

    expect(await ApplicantModel.countDocuments({ _id: { $in: ids }, identityVerification: 'unverified' }))
      .toBe(DEMO_COHORT_SIZE);
    // A screening row opens at registration (I11), so they sit there too — but nothing beyond.
    expect(await ScreeningModel.countDocuments({ ...mine, status: 'waiting' })).toBe(DEMO_COHORT_SIZE);
    expect(await InterviewModel.countDocuments(mine)).toBe(0);
    expect(await EvaluationModel.countDocuments(mine)).toBe(0);
    expect(await JobOfferModel.countDocuments(mine)).toBe(0);
  });

  it('leaves the `screening` cohort verified and waiting in the screening queue', async () => {
    const ids = await cohort('screening');
    const mine = { applicantId: { $in: ids } };

    expect(await ApplicantModel.countDocuments({ _id: { $in: ids }, identityVerification: 'verified' }))
      .toBe(DEMO_COHORT_SIZE);
    expect(await ScreeningModel.countDocuments({ ...mine, status: 'waiting' })).toBe(DEMO_COHORT_SIZE);
    // They have NOT been decided, so no round was ever materialized for them.
    expect(await InterviewModel.countDocuments(mine)).toBe(0);
  });

  it('leaves the `interview` cohort past screening with an undecided round waiting', async () => {
    const ids = await cohort('interview');
    const mine = { applicantId: { $in: ids } };

    expect(await ScreeningModel.countDocuments({ ...mine, status: 'accepted' })).toBe(DEMO_COHORT_SIZE);
    // Exactly one round each, materialized by the acceptance and still undecided.
    expect(await InterviewModel.countDocuments({ ...mine, outcome: 'pending' })).toBe(DEMO_COHORT_SIZE);
    expect(await InterviewModel.countDocuments({ ...mine, outcome: 'passed' })).toBe(0);
    expect(await EvaluationModel.countDocuments(mine)).toBe(0);
    expect(await JobOfferModel.countDocuments(mine)).toBe(0);
  });

  it('leaves the `evaluation` cohort past every interview with evaluations open', async () => {
    const ids = await cohort('evaluation');
    const mine = { applicantId: { $in: ids } };

    expect(await InterviewModel.countDocuments({ ...mine, outcome: 'pending' })).toBe(0);
    expect(await InterviewModel.countDocuments({ ...mine, outcome: 'passed' })).toBeGreaterThanOrEqual(
      DEMO_COHORT_SIZE,
    );
    // At least one open evaluation each — the phase catalog decides how many apply.
    const waiting = await EvaluationModel.distinct('applicantId', { ...mine, status: 'waiting' });
    expect(waiting).toHaveLength(DEMO_COHORT_SIZE);
    // Not yet moved to the offer stage, and therefore no offer.
    expect(await ApplicantModel.countDocuments({ _id: { $in: ids }, movedToOfferAt: null })).toBe(
      DEMO_COHORT_SIZE,
    );
    expect(await JobOfferModel.countDocuments(mine)).toBe(0);
  });

  it('leaves the `jobOffer` cohort moved to the offer stage with a sent offer', async () => {
    const ids = await cohort('jobOffer');
    const mine = { applicantId: { $in: ids } };

    expect(await EvaluationModel.countDocuments({ ...mine, status: 'waiting' })).toBe(0);
    expect(await ApplicantModel.countDocuments({ _id: { $in: ids }, movedToOfferAt: { $ne: null } }))
      .toBe(DEMO_COHORT_SIZE);
    expect(await JobOfferModel.countDocuments({ ...mine, status: 'sent' })).toBe(DEMO_COHORT_SIZE);
    expect(await JobOfferModel.countDocuments({ ...mine, status: 'accepted' })).toBe(0);
  });

  it('leaves the `employeesReady` cohort holding an accepted offer', async () => {
    const ids = await cohort('employeesReady');
    const mine = { applicantId: { $in: ids } };

    expect(await JobOfferModel.countDocuments({ ...mine, status: 'accepted' })).toBe(DEMO_COHORT_SIZE);
    expect(await JobOfferModel.countDocuments({ ...mine, status: 'sent' })).toBe(0);
  });

  /**
   * The evidence that this is a real journey and not a planted end-state: the candidate timeline
   * is written ONLY by the services and the workflow projection, so a candidate who was inserted
   * at the finish line would have an empty history.
   */
  it('records the whole journey on the timeline of the deepest cohort', async () => {
    const ids = await cohort('employeesReady');
    for (const applicantId of ids) {
      const types = await RecruitmentTimelineModel.distinct('type', { applicantId });
      expect(types, 'applied').toContain('applied');
      expect(types, 'identityVerified').toContain('identityVerified');
      expect(types, 'screeningDecided').toContain('screeningDecided');
      expect(types, 'interviewCompleted').toContain('interviewCompleted');
      expect(types, 'offerAccepted').toContain('offerAccepted');
    }
  });

  it('is idempotent — a second run creates nobody', async () => {
    const before = await ApplicantModel.countDocuments(demoFilter);
    const screeningsBefore = await ScreeningModel.countDocuments({});
    const offersBefore = await JobOfferModel.countDocuments({});

    const report = await seedDemoPipeline(adminId);

    expect(report.existing).toBe(DEMO_STAGES.length * DEMO_COHORT_SIZE);
    for (const [stage, count] of Object.entries(report.created)) {
      expect(count, `${stage} cohort re-created`).toBe(0);
    }
    // Nothing downstream was duplicated either — not just the applicants.
    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(before);
    expect(await ScreeningModel.countDocuments({})).toBe(screeningsBefore);
    expect(await JobOfferModel.countDocuments({})).toBe(offersBefore);
  }, 300_000);

  it('reset removes the demo cohorts and what they produced — and nothing else', async () => {
    // A real applicant, registered outside the demo key, must survive the reset untouched.
    const anyDemo = await ApplicantModel.findOne(demoFilter).lean().exec();
    const real = await ApplicantModel.create({
      code: 'APP-REAL-0001',
      fullNameAr: 'مرشح حقيقي',
      sourceId: anyDemo?.sourceId,
      contact: { primaryPhone: '01999888777' },
      status: 'new',
      identityVerification: 'unverified',
      intakeChannel: 'internal',
      intakeKey: null,
    });
    // …and a stage row of their own, to prove the sweep is keyed on the demo applicants and does
    // not simply empty the collections.
    await ScreeningModel.create({
      applicantId: real._id,
      applicantCode: 'APP-REAL-0001',
      applicantName: 'مرشح حقيقي',
      status: 'waiting',
      attempt: 1,
    });

    const { applicants } = await resetDemoPipeline();
    expect(applicants).toBe(DEMO_STAGES.length * DEMO_COHORT_SIZE);

    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(0);
    expect(await InterviewModel.countDocuments({})).toBe(0);
    expect(await EvaluationModel.countDocuments({})).toBe(0);
    expect(await JobOfferModel.countDocuments({})).toBe(0);

    // The real applicant and their screening are still there.
    expect(await ApplicantModel.findById(real._id).lean().exec()).not.toBeNull();
    expect(await ScreeningModel.countDocuments({ applicantId: real._id })).toBe(1);
  }, 120_000);
});
