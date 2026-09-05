// Boot migration for recruitment-era legacy documents (I8: automatic, idempotent, no manual
// step; safe on every boot).
//
// ① `hr_applicants` — fields added after the first applicant release do not exist on old
//    documents, and `.lean()` reads skip schema defaults; one missing `movedToOfferAt` used
//    to 500 the whole applicants list. Each late-added field is backfilled to its schema
//    default, guarded by `$exists: false` so re-runs are no-ops.
// ② Stage collections (screenings, interviews, evaluations, job offers) predate the
//    denormalized `applicantName` — tables showed bare codes. Backfilled from the applicant
//    registry so every list shows the person's display name without a join.
// ②b `hr_recruitment_timeline` — entries written before the schema stopped minimizing lost their
//    empty `metadata` on the way to the database, so the timeline renderer read `undefined` where
//    the DTO promises an object. Same `$exists: false` guard, same one-shot shape.
// ③ Workflow-refactor backfills (§15): attempt markers, placement snapshots, the `pending` →
//    `waiting` rename, evaluation phase typing, the business-order phase reorder, offer terms,
//    and the one-shot unique indexes the attempt-based ones replace.
// ③b `hr_job_offers.ux_code` — built as a plain unique index before the schema made it partial,
//    so on an older database every codeless `waiting` offer after the first fails on a shared
//    `null` and its applicant never enters the queue. Rebuilt to the declared shape, and only
//    when no two live offers share a code (`job-offers/code-index-migration.ts`).
import { type Model, type Types } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { decideCodeIndexRebuild } from './job-offers/code-index-migration';
import { ApplicantModel } from './applicants/applicant.model';
import { ScreeningModel } from './screening/screening.model';
import { InterviewModel } from './interviews/interview.model';
import { EvaluationModel } from './evaluations/evaluation.model';
import { EvaluationPhaseModel } from './evaluations/evaluation-phase.model';
import { JobOfferModel } from './job-offers/job-offer.model';
import { RecruitmentTimelineModel } from './timeline/recruitment-timeline.model';

const APPLICANT_FIELD_DEFAULTS: Record<string, unknown> = {
  jobRequisitionId: null,
  branchId: null,
  sourceDetail: null,
  intakeChannel: 'internal',
  intakeKey: null,
  expectedSalary: null,
  earliestStartDate: null,
  willingToRelocate: false,
  willingToTravel: false,
  willingToShiftWork: false,
  externalRef: null,
  identityVerification: 'unverified',
  identityVerifiedBy: null,
  identityVerifiedAt: null,
  fullNameEn: null,
  nationalId: null,
  birthDate: null,
  gender: null,
  placeOfBirth: null,
  photoFileId: null,
  maritalStatus: null,
  religion: null,
  nationalIdExpiry: null,
  dependentsCount: null,
  officialAddress: null,
  currentAddress: null,
  military: null,
  education: null,
  experience: [],
  drivingLicenses: [],
  certifications: [],
  references: [],
  duplicateFlag: false,
  duplicateOf: [],
  attachmentCount: 0,
  withdrawnReason: null,
  withdrawnAt: null,
  movedToOfferAt: null,
  movedToOfferBy: null,
};

/**
 * Stage collections that carry the shared workflow fields (attempt, supersede, placement). The
 * migration only touches those shared fields, so it addresses them through one structural type
 * rather than four unrelated document types.
 */
interface StageLike {
  _id: Types.ObjectId;
  branchId: Types.ObjectId | null;
  attempt: number;
  status: string;
}

const STAGE_MODELS: Model<StageLike>[] = [
  ScreeningModel,
  InterviewModel,
  EvaluationModel,
  JobOfferModel,
] as unknown as Model<StageLike>[];

/**
 * The one-shot unique indexes the attempt-based ones replace (§15.5). Dropping by name is
 * guarded — an index that is already gone is not an error, it is the steady state.
 */
const REPLACED_INDEXES: { model: Model<StageLike>; name: string }[] = [
  { model: ScreeningModel as unknown as Model<StageLike>, name: 'ux_screening_applicant' },
  { model: EvaluationModel as unknown as Model<StageLike>, name: 'ux_applicant_phase' },
  { model: JobOfferModel as unknown as Model<StageLike>, name: 'ux_active_offer' },
];

/** Phase typing derived from the seeded keys; admin-added phases keep the generic defaults. */
const PHASE_TYPING: Record<
  string,
  { kind: string; permissionResource: string; applicability: string; appointmentEnabled: boolean }
> = {
  securityCheck: {
    kind: 'batch',
    permissionResource: 'securityCheck',
    applicability: 'all',
    appointmentEnabled: false,
  },
  drivingTest: {
    kind: 'batch',
    permissionResource: 'drivingTest',
    applicability: 'driversOnly',
    appointmentEnabled: false,
  },
  medicalExam: {
    kind: 'individual',
    permissionResource: 'medicalCheck',
    applicability: 'all',
    appointmentEnabled: true,
  },
};

/** §15.1 — every stage record gains its attempt marker. */
const backfillAttemptMarkers = async (): Promise<void> => {
  for (const model of STAGE_MODELS) {
    await model.updateMany({ attempt: { $exists: false } } as never, { $set: { attempt: 1 } }).exec();
    await model
      .updateMany(
        { supersededAt: { $exists: false } } as never,
        { $set: { supersededAt: null, supersededBy: null, supersededByReturnId: null } },
      )
      .exec();
  }
};

/**
 * §15.2 — placement. The applicant's live placement comes from the branch they were registered
 * against (position/title unknown historically); each stage record freezes the applicant's branch
 * as it stood, and offers use their own terms, which are the more specific truth.
 */
const backfillPlacement = async (): Promise<void> => {
  const empty = {
    jobTitleId: null,
    departmentId: null,
    branchId: null,
    sectionId: null,
  };
  const emptyLabel = { position: null, branch: null, department: null };

  await ApplicantModel.updateMany({ placementHistory: { $exists: false } }, { $set: { placementHistory: [] } }).exec();
  await ApplicantModel.updateMany({ placementLabel: { $exists: false } }, { $set: { placementLabel: emptyLabel } }).exec();
  const applicantsMissingPlacement = await ApplicantModel.find(
    { placement: { $exists: false } },
    { branchId: 1 },
  )
    .lean<{ _id: Types.ObjectId; branchId: Types.ObjectId | null }[]>()
    .exec();
  for (const applicant of applicantsMissingPlacement) {
    await ApplicantModel.updateOne(
      { _id: applicant._id },
      { $set: { placement: { ...empty, branchId: applicant.branchId ?? null } } },
    ).exec();
  }

  for (const model of STAGE_MODELS) {
    await model
      .updateMany(
        { placementSnapshotLabel: { $exists: false } } as never,
        { $set: { placementSnapshotLabel: emptyLabel } },
      )
      .exec();
    // The stage record already denormalizes the branch it belonged to — the snapshot is that
    // branch, per record, not the applicant's branch today.
    const missing = await model
      .find({ placementSnapshot: { $exists: false } } as never, { branchId: 1 })
      .lean<{ _id: Types.ObjectId; branchId: Types.ObjectId | null }[]>()
      .exec();
    for (const record of missing) {
      await model
        .updateOne(
          { _id: record._id },
          { $set: { placementSnapshot: { ...empty, branchId: record.branchId ?? null } } } as never,
        )
        .exec();
    }
  }

  // An offer's own terms are more specific than its branch — use them where they exist.
  const offers = await JobOfferModel.find(
    { 'terms.branchId': { $exists: true } },
    { terms: 1 },
  )
    .lean<
      {
        _id: Types.ObjectId;
        terms: {
          branchId: Types.ObjectId | null;
          departmentId: Types.ObjectId | null;
          jobTitleId: Types.ObjectId | null;
          sectionId?: Types.ObjectId | null;
        } | null;
      }[]
    >()
    .exec();
  for (const offer of offers) {
    if (offer.terms === null) continue;
    await JobOfferModel.updateOne(
      { _id: offer._id, 'placementSnapshot.branchId': null },
      {
        $set: {
          placementSnapshot: {
            jobTitleId: offer.terms.jobTitleId ?? null,
            departmentId: offer.terms.departmentId ?? null,
            branchId: offer.terms.branchId ?? null,
            sectionId: offer.terms.sectionId ?? null,
          },
        },
      },
    ).exec();
  }
};

/**
 * F-REQ-1 — fill the department mirror on the rows written before it existed.
 *
 * NOT A DERIVATION. The applicant's answer is `placement.departmentId`, stored on the same
 * document; the stage rows' answer is the applicant's, exactly as `branchId` is today. Nothing is
 * inferred from a date, an action log or a job title — every value copied here was already in the
 * database, one field away, which is why this needs no rule and states none.
 *
 * IDEMPOTENT BY FILTER, not by a flag: both halves match only rows whose mirror is still absent or
 * null, so a second run finds nothing and a row somebody corrected by hand is never overwritten.
 * An applicant placed in no department keeps `null` — invisible to a department-scoped reader,
 * which is the point of the axis and matches what D-DEPT-4 already settled for payroll.
 */
const backfillDepartmentScope = async (): Promise<void> => {
  const placed = await ApplicantModel.find(
    { 'placement.departmentId': { $ne: null } },
    { placement: 1 },
  )
    .lean<{ _id: Types.ObjectId; placement: { departmentId: Types.ObjectId | null } }[]>()
    .exec();

  // One update per DEPARTMENT rather than per applicant: the same value for many rows. The id
  // read off the document is reused as the value written — never re-parsed from its string form.
  const byDepartment = new Map<string, { value: Types.ObjectId; ids: Types.ObjectId[] }>();
  for (const applicant of placed) {
    const departmentId = applicant.placement?.departmentId ?? null;
    if (departmentId === null) continue;
    const key = String(departmentId);
    const group = byDepartment.get(key) ?? { value: departmentId, ids: [] };
    group.ids.push(applicant._id);
    byDepartment.set(key, group);
  }

  for (const { value, ids } of byDepartment.values()) {
    await ApplicantModel.updateMany(
      { _id: { $in: ids }, departmentId: null },
      { $set: { departmentId: value } },
    ).exec();
    // The stage rows follow the applicant, the same direction `syncApplicantScope` pushes.
    for (const model of STAGE_MODELS) {
      await model
        .updateMany(
          { applicantId: { $in: ids }, departmentId: null } as never,
          { $set: { departmentId: value } },
        )
        .exec();
    }
  }

  // A row that never had the field at all — absent, not null — so the filters above skip it.
  await ApplicantModel.updateMany(
    { departmentId: { $exists: false } },
    { $set: { departmentId: null } },
  ).exec();
  for (const model of STAGE_MODELS) {
    await model
      .updateMany({ departmentId: { $exists: false } } as never, { $set: { departmentId: null } })
      .exec();
  }
};

/** `pending` becomes the explicit `waiting` status (I11) on the two stages that used it. */
const renamePendingToWaiting = async (): Promise<void> => {
  await ScreeningModel.updateMany({ status: 'pending' }, { $set: { status: 'waiting' } }).exec();
  await EvaluationModel.updateMany({ status: 'pending' }, { $set: { status: 'waiting' } }).exec();
};

/** §15.3 — phase typing (kind, permission resource, applicability, appointments). */
const backfillPhaseTyping = async (): Promise<void> => {
  const phases = await EvaluationPhaseModel.find(
    {},
    { key: 1, driversOnly: 1, kind: 1, permissionResource: 1, applicability: 1 },
  )
    .lean<
      {
        _id: Types.ObjectId;
        key: string;
        driversOnly?: boolean;
        kind?: string;
        permissionResource?: string;
        applicability?: string;
      }[]
    >()
    .exec();

  for (const phase of phases) {
    const typing = PHASE_TYPING[phase.key];
    const set: Record<string, unknown> = {};
    if (phase.kind === undefined) set.kind = typing?.kind ?? 'individual';
    if (phase.permissionResource === undefined) {
      set.permissionResource = typing?.permissionResource ?? 'evaluation';
    }
    if (phase.applicability === undefined) {
      set.applicability = typing?.applicability ?? (phase.driversOnly === true ? 'driversOnly' : 'all');
    }
    if (Object.keys(set).length > 0) {
      await EvaluationPhaseModel.updateOne({ _id: phase._id }, { $set: set }).exec();
    }
  }
  await EvaluationPhaseModel.updateMany(
    { appointmentEnabled: { $exists: false } },
    { $set: { appointmentEnabled: false } },
  ).exec();
  await EvaluationPhaseModel.updateMany(
    { requiresResultDocument: { $exists: false } },
    { $set: { requiresResultDocument: false } },
  ).exec();
  await EvaluationPhaseModel.updateOne(
    { key: 'medicalExam', appointmentEnabled: false },
    { $set: { appointmentEnabled: true } },
  ).exec();
};

/**
 * §15.3b — phases run in real business order, Medical last (OQ-1): `drivingTest` 3 → 2 and
 * `medicalExam` 2 → 3. `ux_active_order` is unique among active phases, so the swap goes through
 * a temporary high order. Guarded on the PRE-migration orders, so an admin who has already
 * reordered them is never overridden; re-running is then a no-op.
 */
const reorderPhasesToBusinessOrder = async (): Promise<void> => {
  const [driving, medical] = await Promise.all([
    EvaluationPhaseModel.findOne({ key: 'drivingTest' }, { order: 1 }).lean<{ _id: Types.ObjectId; order: number }>().exec(),
    EvaluationPhaseModel.findOne({ key: 'medicalExam' }, { order: 1 }).lean<{ _id: Types.ObjectId; order: number }>().exec(),
  ]);
  if (driving === null || medical === null) return;
  if (driving.order !== 3 || medical.order !== 2) return;

  await EvaluationPhaseModel.updateOne({ _id: medical._id }, { $set: { order: 900 } }).exec();
  await EvaluationPhaseModel.updateOne({ _id: driving._id }, { $set: { order: 2 } }).exec();
  await EvaluationPhaseModel.updateOne({ _id: medical._id }, { $set: { order: 3 } }).exec();
};

/**
 * §15.4 — offer terms gained the section the hire fills (RW3).
 *
 * The seat half of this backfill is gone with P-ORG-1: there is one job concept now, and a field
 * nobody has is not a field to fill in.
 */
const backfillOfferTerms = async (): Promise<void> => {
  await JobOfferModel.updateMany(
    { terms: { $ne: null }, 'terms.sectionId': { $exists: false } },
    { $set: { 'terms.sectionId': null } },
  ).exec();
  await JobOfferModel.updateMany(
    { hiredEmployeeId: { $exists: false } },
    { $set: { hiredEmployeeId: null } },
  ).exec();
};

/**
 * §15.5 — drop the one-shot unique indexes the attempt-based ones replace. Mongoose creates the
 * new indexes from the schema; only the removals need doing here, and only once.
 */
const dropReplacedIndexes = async (): Promise<void> => {
  for (const { model, name } of REPLACED_INDEXES) {
    try {
      await model.collection.dropIndex(name);
    } catch {
      // Already dropped (the steady state) or never created — either way, nothing to do.
    }
  }
};

/** Live offer codes held by more than one document — what makes a rebuild unsafe. */
const duplicateOfferCodes = async (): Promise<string[]> => {
  const rows = await JobOfferModel.collection
    .aggregate<{ _id: string }>([
      { $match: { code: { $type: 'string' } } },
      { $group: { _id: '$code', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();
  return rows.map((r) => r._id);
};

/**
 * Rebuild `ux_code` as the PARTIAL index the schema declares (see `code-index-migration.ts`).
 *
 * On a database built before the partial filter was added, the index still counts every codeless
 * offer as the same `null`: the second `waiting` row fails with `E11000 ... dup key: { code: null }`
 * and the applicant never enters the queue. Nothing retries it, so it repeats on every boot.
 *
 * Runs BEFORE `materializeWaitingBacklog`, which is the step the old index breaks — repairing the
 * index and then leaving the backlog for the next boot would fix nothing today.
 */
const rebuildJobOfferCodeIndex = async (): Promise<void> => {
  try {
    const indexes = await JobOfferModel.collection.indexes();
    const existing = indexes.find((ix) => ix.name === 'ux_code');
    // Only pay for the duplicate scan when a rebuild is actually on the table.
    const needsCheck = existing !== undefined && existing.partialFilterExpression === undefined;
    const verdict = decideCodeIndexRebuild(existing, needsCheck ? await duplicateOfferCodes() : []);

    if (verdict.action === 'skip') return;
    if (verdict.action === 'blocked') {
      logger.error(
        { duplicates: verdict.duplicates },
        'job offers: ux_code left as it is — these codes are held by more than one offer, and ' +
          'rebuilding a unique index over them would fail and leave the collection with none. ' +
          'Resolve the duplicates and the next boot will repair the index.',
      );
      return;
    }

    await JobOfferModel.collection.dropIndex('ux_code');
    await JobOfferModel.createIndexes();
    logger.info(
      'job offers: ux_code rebuilt as a partial index — offers with no code yet no longer collide',
    );
  } catch (error) {
    // Never fail the boot over an index repair: the old shape still enforces uniqueness, and the
    // symptom is a backlog that does not open, not corruption.
    logger.warn({ err: error }, 'job offers: ux_code index migration skipped');
  }
};

/**
 * I14 — a candidate who has left the pipeline must hold no OPEN stage record, because a queue is
 * a plain read over statuses and nothing else marks them as gone (I1/I10). Rows written before
 * the lifecycle closed its stages are still sitting in `waiting` / `scheduled` / `draft`, so they
 * would keep appearing in queues and counters forever.
 *
 * The backfill writes the same terminal statuses the engine now writes. It is a data repair of
 * history, not a transition: there is no actor and no event to publish for something that should
 * have happened months ago, and inventing either would put fiction on the timeline.
 */
const closeStagesOfDepartedApplicants = async (): Promise<void> => {
  const gone = await ApplicantModel.find({ status: { $ne: 'new' } }, { _id: 1 }).lean().exec();
  const goneIds = gone.map((a) => a._id);
  if (goneIds.length === 0) return;

  const closures: [Model<{ applicantId: Types.ObjectId }>, string[], string][] = [
    [ScreeningModel as never, ['waiting'], 'cancelled'],
    [InterviewModel as never, ['waiting', 'scheduled', 'inProgress'], 'cancelled'],
    [EvaluationModel as never, ['waiting'], 'cancelled'],
    [JobOfferModel as never, ['waiting', 'draft', 'sent'], 'withdrawn'],
  ];
  for (const [model, open, to] of closures) {
    await model
      .updateMany(
        { applicantId: { $in: goneIds }, supersededAt: null, isDeleted: false, status: { $in: open } },
        { $set: { status: to } },
      )
      .exec();
  }
};

/**
 * I5 — an evaluation used to log every re-decision in its own `decisionHistory[]`, alongside the
 * `evaluationDecided` entries the canonical timeline records for exactly the same from/to/reason/
 * actor. Two histories of one fact can only drift, so the aggregate's copy is dropped. Nothing is
 * lost: the timeline holds every one of those decisions, and it always did.
 */
/**
 * §15 / I11 — every live applicant gets the `waiting` row their position already implies.
 *
 * Pre-refactor applicants moved through a pipeline where "waiting" meant *no row*, so every one of
 * them stands at a stage the new queues cannot see. The materializer knows how to resolve and open
 * that row and is idempotent by construction (I12), so this is a walk plus a no-op on every
 * subsequent boot. Imported lazily: the materializer pulls in the workflow engine and all four
 * stage services, and the migration module must stay loadable without them.
 */
const materializeWaitingBacklog = async (): Promise<void> => {
  const { queueMaterializerService } = await import('./materializer');
  await queueMaterializerService.backfillWaitingBacklog();
};

const dropEvaluationDecisionHistory = async (): Promise<void> => {
  await EvaluationModel.updateMany(
    { decisionHistory: { $exists: true } } as never,
    { $unset: { decisionHistory: '' } },
  ).exec();
};

export const migrateRecruitmentWorkflow = async (): Promise<void> => {
  await backfillAttemptMarkers();
  await dropEvaluationDecisionHistory();
  await closeStagesOfDepartedApplicants();
  await backfillPlacement();
  // AFTER `backfillPlacement`, which is what puts `placement.departmentId` on the rows that
  // predate the placement shape — reading before it would find nothing to copy.
  await backfillDepartmentScope();
  await renamePendingToWaiting();
  await backfillPhaseTyping();
  await reorderPhasesToBusinessOrder();
  await backfillOfferTerms();
  await dropReplacedIndexes();
  // BEFORE the backlog below, which is the step the drifted `ux_code` breaks.
  await rebuildJobOfferCodeIndex();
  // LAST — I11's backlog. Every step above normalizes the rows that already exist; this one opens
  // the `waiting` rows that never existed, and it must read the normalized shape (attempt markers,
  // the `pending` → `waiting` rename, phase typing) to resolve where each candidate stands.
  await materializeWaitingBacklog();
};

export const migrateRecruitmentLegacy = async (): Promise<void> => {
  // ① Applicant field backfill — one targeted update per late-added field.
  for (const [field, value] of Object.entries(APPLICANT_FIELD_DEFAULTS)) {
    await ApplicantModel.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } })
      .exec();
  }

  // ② Denormalized applicant display name on the stage collections.
  const stageModels = [ScreeningModel, InterviewModel, EvaluationModel, JobOfferModel] as const;
  for (const model of stageModels) {
    const missing = await model.exists({ applicantName: { $exists: false } });
    if (missing === null) continue;
    const applicants = await ApplicantModel.find({}, { fullNameAr: 1 }).lean().exec();
    for (const applicant of applicants) {
      await model
        .updateMany(
          { applicantId: applicant._id, applicantName: { $exists: false } },
          { $set: { applicantName: applicant.fullNameAr } },
        )
        .exec();
    }
    // Orphans (applicant hard-gone): empty display name rather than a missing field.
    await model
      .updateMany({ applicantName: { $exists: false } }, { $set: { applicantName: '' } })
      .exec();
  }

  // ③ Timeline entries stored before `minimize: false` — same class as ①, one collection further
  //    on. Mongoose minimization dropped an empty `metadata` on the way to the database, so the
  //    entries written with nothing to add (`identityVerified` and `note`; every other type
  //    supplies metadata) lack the field the DTO promises. The schema now persists it going
  //    forward; the rows already stored still need it.
  //
  //    `$exists: false` is the whole safety argument: a row that HAS metadata — real or empty —
  //    does not match, so a populated `{ attempt: n }` can never be reset, and a second run
  //    matches nothing. It touches one field, no index covers it, and the collection's identity
  //    and idempotency keys (`eventId`, `sourceKey`) are not in the update.
  await RecruitmentTimelineModel.updateMany(
    { metadata: { $exists: false } },
    { $set: { metadata: {} } },
  ).exec();

  // ④ Workflow refactor.
  await migrateRecruitmentWorkflow();
};
