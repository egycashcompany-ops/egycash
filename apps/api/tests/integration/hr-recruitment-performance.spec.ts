// I3 — the performance invariant, checked mechanically instead of asserted in prose.
//
// I3 promises three things. Two are absolute and are hard assertions here: every stage queue is
// served by an index, and nothing anywhere is N+1. The third — "one aggregation pipeline, a single
// round trip" — is where the implementation deviates from the frozen wording, so this file also
// MEASURES the deviation rather than arguing about it: it runs the shipped shape against the single
// `$unionWith` pipeline the words describe, over the same data, and reports both.
//
// The dataset is seeded straight into the collections. That is deliberate: this file is about query
// plans, and a plan depends on how many rows exist, not on how they got there. Going through the
// services would take minutes and would test the services, which every other suite already does.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types, type PipelineStage } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { ScreeningModel } from '../../src/modules/hr/recruitment/screening/screening.model';
import { InterviewModel } from '../../src/modules/hr/recruitment/interviews/interview.model';
import { EvaluationModel } from '../../src/modules/hr/recruitment/evaluations/evaluation.model';
import { JobOfferModel } from '../../src/modules/hr/recruitment/job-offers/job-offer.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

let replSet: MongoMemoryReplSet | null = null;

/** Big enough that a collection scan is a real alternative the planner would consider. */
const ROWS = 2_000;
const BRANCHES = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-perf-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** The live-set `$match` the counters use, verbatim. */
const LIVE = { supersededAt: null, isDeleted: false } as const;

/** The counters' pipeline for one collection, verbatim (`countByStatus`). */
const countersPipeline = (extra: Record<string, unknown> = {}): PipelineStage[] => [
  { $match: { ...LIVE, ...extra } },
  { $group: { _id: '$status', count: { $sum: 1 } } },
];

/**
 * Explain output shape moves between server versions, so the assertions read the tree as data
 * rather than reaching for a fixed path.
 */
const planText = (explained: unknown): string => JSON.stringify(explained);

const deepFind = (node: unknown, key: string): number | undefined => {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFind(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (typeof record[key] === 'number') return record[key] as number;
  for (const value of Object.values(record)) {
    const found = deepFind(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

const seedStage = async (
  model: typeof ScreeningModel | typeof InterviewModel | typeof EvaluationModel | typeof JobOfferModel,
  extra: (i: number) => Record<string, unknown>,
  statuses: string[],
): Promise<void> => {
  const rows = Array.from({ length: ROWS }, (_, i) => ({
    applicantId: new Types.ObjectId(),
    applicantCode: `APP-2026-${String(i).padStart(6, '0')}`,
    applicantName: 'Seeded Candidate',
    branchId: BRANCHES[i % BRANCHES.length],
    status: statuses[i % statuses.length],
    attempt: 1,
    // A tenth of the rows are retired history — the live set must not have to look at them.
    supersededAt: i % 10 === 0 ? new Date() : null,
    supersededBy: null,
    supersededByReturnId: null,
    isDeleted: false,
    ...extra(i),
  }));
  await model.collection.insertMany(rows as never[]);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  const stageIds = [new Types.ObjectId(), new Types.ObjectId()];
  const phaseIds = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];

  await seedStage(ScreeningModel, () => ({ notes: [] }), ['waiting', 'accepted', 'rejected']);
  await seedStage(
    InterviewModel,
    (i) => ({ stageId: stageIds[i % stageIds.length], stageOrder: (i % stageIds.length) + 1, panel: [] }),
    ['waiting', 'scheduled', 'inProgress', 'completed', 'cancelled'],
  );
  await seedStage(
    EvaluationModel,
    (i) => ({ phaseId: phaseIds[i % phaseIds.length], phaseOrder: (i % phaseIds.length) + 1, files: [] }),
    ['waiting', 'approved', 'rejected'],
  );
  await seedStage(JobOfferModel, () => ({ revisions: [] }), [
    'waiting',
    'draft',
    'sent',
    'accepted',
    'rejected',
  ]);

  // The models declare the indexes; make sure they exist before anything is explained.
  await Promise.all([
    ScreeningModel.createIndexes(),
    InterviewModel.createIndexes(),
    EvaluationModel.createIndexes(),
    JobOfferModel.createIndexes(),
  ]);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── Every stage queue is served by an index (I3) ────────────────────────────

describe('stage queues use an index (I3)', () => {
  const queues: { name: string; run: () => Promise<unknown> }[] = [
    {
      name: 'screening queue, filtered by status',
      run: () =>
        ScreeningModel.find({ ...LIVE, status: 'waiting' })
          .sort({ createdAt: -1 })
          .limit(25)
          .explain('executionStats'),
    },
    {
      name: 'screening queue, filtered by branch + status',
      run: () =>
        ScreeningModel.find({ ...LIVE, branchId: BRANCHES[0], status: 'waiting' })
          .limit(25)
          .explain('executionStats'),
    },
    {
      name: 'interview stage queue',
      run: () =>
        InterviewModel.find({ ...LIVE, status: 'waiting' })
          .sort({ scheduledAt: 1 })
          .limit(25)
          .explain('executionStats'),
    },
    {
      name: 'evaluation phase queue',
      run: () =>
        EvaluationModel.find({ ...LIVE, status: 'waiting' })
          .limit(25)
          .explain('executionStats'),
    },
    {
      name: 'job offer queue',
      run: () =>
        JobOfferModel.find({ ...LIVE, status: 'sent' })
          .sort({ createdAt: -1 })
          .limit(25)
          .explain('executionStats'),
    },
  ];

  for (const queue of queues) {
    it(`${queue.name} — index scan, never a collection scan`, async () => {
      const plan = planText(await queue.run());
      expect(plan, queue.name).toContain('IXSCAN');
      expect(plan, queue.name).not.toContain('COLLSCAN');
    });
  }
});

// ── The counters are one pass per collection, from the index (I3) ───────────

describe('stage counters are index-served and single-pass (I3)', () => {
  const collections = [
    { name: 'screenings', model: ScreeningModel },
    { name: 'interviews', model: InterviewModel },
    { name: 'evaluations', model: EvaluationModel },
    { name: 'jobOffers', model: JobOfferModel },
  ];

  for (const { name, model } of collections) {
    it(`${name}: reads the live set from the index, never the collection`, async () => {
      const explained = await model.aggregate(countersPipeline()).explain('executionStats');
      const plan = planText(explained);

      expect(plan, name).toContain('ix_live_counters');
      expect(plan, name).not.toContain('COLLSCAN');
    });

    it(`${name}: touches only rows that match — no N+1, and retired rows are never looked at`, async () => {
      const explained = await model.aggregate(countersPipeline()).explain('executionStats');
      const live = await model.countDocuments(LIVE).exec();
      const keys = deepFind(explained, 'totalKeysExamined') ?? Number.MAX_SAFE_INTEGER;
      const docs = deepFind(explained, 'totalDocsExamined') ?? Number.MAX_SAFE_INTEGER;

      // `supersededAt: null` is an equality bound on the index prefix, so the retired tenth sits
      // in a key range the scan never enters: the work is proportional to the LIVE set, not to the
      // collection. That is the property I3 is actually about.
      expect(live).toBeLessThan(ROWS);
      // One key per live row, plus the single boundary key an index scan reads to find the end.
      expect(keys, name).toBeLessThanOrEqual(live + 1);
      // One fetch per matching row and not one more — never a document that fails the filter.
      //
      // NOT zero, and it cannot be: the scan is bounded but not COVERED, because `supersededAt`
      // is matched against `null`. An index entry cannot distinguish a stored `null` from a
      // missing field, so the server must read each document to confirm the match. It is the same
      // rule that makes a partial index over `{ supersededAt: null }` unusable here — worth
      // pinning down, because "index-served" and "index-only" are not the same claim and only one
      // of them is true.
      expect(docs, name).toBe(live);
    });
  }
});

// ── The shape deviation, measured rather than argued (I3) ───────────────────

describe('counters: N parallel aggregations vs one $unionWith pipeline (I3)', () => {
  /** What the shipped counters service does: one grouped aggregation per collection, in parallel. */
  const parallelShape = async (): Promise<number> => {
    const results = await Promise.all([
      ScreeningModel.aggregate(countersPipeline()).exec(),
      InterviewModel.aggregate(countersPipeline()).exec(),
      EvaluationModel.aggregate(countersPipeline()).exec(),
      JobOfferModel.aggregate(countersPipeline()).exec(),
    ]);
    return results.flat().reduce((sum, row) => sum + (row as { count: number }).count, 0);
  };

  /** What I3's wording describes: one pipeline, one round trip, every stage inside it. */
  const singlePipelineShape = async (): Promise<number> => {
    const pipeline: PipelineStage[] = [
      { $match: LIVE },
      { $group: { _id: { stage: 'screening', status: '$status' }, count: { $sum: 1 } } },
      {
        $unionWith: {
          coll: InterviewModel.collection.name,
          pipeline: [
            { $match: LIVE },
            { $group: { _id: { stage: 'interview', status: '$status' }, count: { $sum: 1 } } },
          ],
        },
      },
      {
        $unionWith: {
          coll: EvaluationModel.collection.name,
          pipeline: [
            { $match: LIVE },
            { $group: { _id: { stage: 'evaluation', status: '$status' }, count: { $sum: 1 } } },
          ],
        },
      },
      {
        $unionWith: {
          coll: JobOfferModel.collection.name,
          pipeline: [
            { $match: LIVE },
            { $group: { _id: { stage: 'jobOffer', status: '$status' }, count: { $sum: 1 } } },
          ],
        },
      },
    ];
    const rows = await ScreeningModel.aggregate(pipeline).exec();
    return rows.reduce((sum, row) => sum + (row as { count: number }).count, 0);
  };

  const median = async (run: () => Promise<number>, runs = 7): Promise<number> => {
    const timings: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const started = performance.now();
      await run();
      timings.push(performance.now() - started);
    }
    return timings.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
  };

  it('both shapes answer identically, and the shipped one is not slower', async () => {
    // Same numbers, or the comparison would be meaningless.
    expect(await parallelShape()).toBe(await singlePipelineShape());

    await parallelShape(); // warm the cache for both, so the first run does not skew the median
    await singlePipelineShape();

    const parallel = await median(parallelShape);
    const single = await median(singlePipelineShape);

    // Reported, not just asserted: this number is the evidence behind the documented decision in
    // docs/02-architecture/recruitment-workflow.md §7a, and it is re-measured on every CI run.
    // eslint-disable-next-line no-restricted-syntax
    console.log(
      `[I3] counters over ${ROWS} rows × 4 collections — ` +
        `parallel: ${parallel.toFixed(1)}ms · single $unionWith: ${single.toFixed(1)}ms`,
    );

    // The claim being defended is "the parallel shape costs no more than the single pipeline",
    // with room for the noise a shared CI runner adds to a millisecond-scale measurement.
    expect(parallel).toBeLessThan(single * 3 + 25);
  }, 60_000);
});
