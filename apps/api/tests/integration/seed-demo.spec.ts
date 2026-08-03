// The demo-pipeline seed, exercised for real: it is the only way to know the cohorts actually
// land where they claim to. The seeder drives the REAL services, so a wrong call order does not
// produce slightly-off data — it throws, or it leaves a candidate at the wrong stage, and both
// show up here.
//
// Covers the three promises the seeder makes: ten candidates rest at each stage, a second run
// changes nothing, and the reset removes the demo cohorts and only those.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { seedDevData } from '../../src/seed-data';
import {
  DEMO_COHORT_SIZE,
  DEMO_INTAKE_PREFIX,
  resetDemoPipeline,
  seedDemoPipeline,
} from '../../src/seed-demo';
import { ApplicantModel } from '../../src/modules/hr/recruitment/applicants/applicant.model';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { InterviewModel } from '../../src/modules/hr/recruitment/interviews/interview.model';
import { EvaluationModel } from '../../src/modules/hr/recruitment/evaluations/evaluation.model';
import { JobOfferModel } from '../../src/modules/hr/recruitment/job-offers/job-offer.model';
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
  it('places ten candidates at each of the six recruitment stages', async () => {
    const report = await seedDemoPipeline(adminId);

    expect(report.total).toBe(6 * DEMO_COHORT_SIZE);
    for (const [stage, count] of Object.entries(report.created)) {
      expect(count, `${stage} cohort`).toBe(DEMO_COHORT_SIZE);
    }
    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(6 * DEMO_COHORT_SIZE);

    // Where each cohort RESTS, read from the same collections the queues read.
    // The `applicants` cohort stops at the ID gate; every later cohort passed it.
    expect(await ApplicantModel.countDocuments({ ...demoFilter, identityVerification: 'unverified' }))
      .toBe(DEMO_COHORT_SIZE);

    const demoIds = (await ApplicantModel.find(demoFilter, { _id: 1 }).lean().exec()).map((a) => a._id);
    const mine = { applicantId: { $in: demoIds } };

    // Screening: the two earliest cohorts are still waiting — a screening row opens at
    // registration (I11), so the unverified cohort sits there too. Everyone deeper was accepted.
    expect(await ScreeningModel.countDocuments({ ...mine, status: 'waiting' })).toBe(
      DEMO_COHORT_SIZE * 2,
    );
    expect(await ScreeningModel.countDocuments({ ...mine, status: 'accepted' })).toBe(
      DEMO_COHORT_SIZE * 4,
    );

    // Interviews exist only from the interview cohort onward, and the four deeper cohorts
    // cleared theirs.
    expect(await InterviewModel.countDocuments({ ...mine, status: 'waiting' })).toBeGreaterThanOrEqual(
      DEMO_COHORT_SIZE,
    );
    expect(await InterviewModel.countDocuments({ ...mine, outcome: 'passed' })).toBeGreaterThan(0);

    // Evaluations open once interviews clear; the offer cohorts approved theirs.
    expect(await EvaluationModel.countDocuments({ ...mine, status: 'waiting' })).toBeGreaterThanOrEqual(
      DEMO_COHORT_SIZE,
    );

    // Offers: ten sent and awaiting a response, ten accepted and awaiting the hire.
    expect(await JobOfferModel.countDocuments({ ...mine, status: 'sent' })).toBe(DEMO_COHORT_SIZE);
    expect(await JobOfferModel.countDocuments({ ...mine, status: 'accepted' })).toBe(DEMO_COHORT_SIZE);
  }, 300_000);

  it('is idempotent — a second run creates nobody', async () => {
    const before = await ApplicantModel.countDocuments(demoFilter);
    const report = await seedDemoPipeline(adminId);

    expect(report.existing).toBe(6 * DEMO_COHORT_SIZE);
    for (const [stage, count] of Object.entries(report.created)) {
      expect(count, `${stage} cohort re-created`).toBe(0);
    }
    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(before);
  }, 300_000);

  it('reset removes the demo cohorts and what they produced — and nothing else', async () => {
    // A real applicant, registered outside the demo key, must survive the reset untouched.
    const real = await ApplicantModel.create({
      code: 'APP-REAL-0001',
      fullNameAr: 'مرشح حقيقي',
      sourceId: (await ApplicantModel.findOne(demoFilter).lean().exec())?.sourceId,
      primaryPhone: '01999888777',
      status: 'new',
      identityVerification: 'unverified',
      intakeChannel: 'internal',
      intakeKey: null,
    });

    const { applicants } = await resetDemoPipeline();
    expect(applicants).toBe(6 * DEMO_COHORT_SIZE);

    expect(await ApplicantModel.countDocuments(demoFilter)).toBe(0);
    expect(await ScreeningModel.countDocuments({})).toBe(0);
    expect(await InterviewModel.countDocuments({})).toBe(0);
    expect(await EvaluationModel.countDocuments({})).toBe(0);
    expect(await JobOfferModel.countDocuments({})).toBe(0);

    // The real applicant is still there.
    expect(await ApplicantModel.findById(real._id).lean().exec()).not.toBeNull();
  }, 120_000);
});
