// Demo pipeline DATA (development/staging only) — 10 synthetic candidates resting at each of the
// six recruitment stages, so every queue, board and counter has something real to show.
//
// THE CANDIDATES ARE DRIVEN THROUGH THE REAL SERVICES, never written straight into collections.
// A candidate "at the interview stage" got there by having their screening accepted, which is what
// materializes the interview round (I11) — so the queues, the workflow state, the stage counters
// and the candidate timeline all agree, exactly as they would in production. Planting rows would
// produce data that looks right on one screen and is wrong on every other.
//
// Idempotency is the platform's own: every registration carries an `intakeKey` under `demo:`, and
// `applicantService.register` returns the existing applicant for a repeated key (§ idempotent
// intake). Re-running therefore changes nothing rather than minting a second cohort.
//
// Synthetic data only, and never production (Security Architecture §6): `seedDemoPipeline` refuses
// to run when NODE_ENV is `production`. The reset counterpart removes ONLY rows carrying the demo
// intake key and what those candidates produced.
import { type Types } from 'mongoose';
import {
  type AcceptJobOffer,
  type CreateJobOffer,
  type DecideEvaluation,
  type DecideInterview,
  type DecideScreening,
  type RegisterApplicant,
  type SendJobOffer,
} from '@ecms/contracts';
import { logger } from './infrastructure/logging/logger';
import { type AuthContext } from './shared/types';

/** Every demo applicant is stamped with this, which is how a re-run and the reset find them. */
export const DEMO_INTAKE_PREFIX = 'demo:';

/** The six stages, in pipeline order — each gets its own cohort of ten. */
export const DEMO_STAGES = [
  'applicants',
  'screening',
  'interview',
  'evaluation',
  'jobOffer',
  'employeesReady',
] as const;
export type DemoStage = (typeof DEMO_STAGES)[number];

export const DEMO_COHORT_SIZE = 10;

export interface DemoSeedReport {
  /** How many candidates each stage received on this run (0 when they already existed). */
  created: Record<DemoStage, number>;
  /** Candidates that were already present from an earlier run and were left alone. */
  existing: number;
  total: number;
}

// ── The people ──────────────────────────────────────────────────────────────
// Common Egyptian names, obviously synthetic in combination. Arabic is the primary name because
// that is the field the platform treats as authoritative.

const FIRST_NAMES: { ar: string; en: string }[] = [
  { ar: 'أحمد', en: 'Ahmed' },
  { ar: 'محمد', en: 'Mohamed' },
  { ar: 'محمود', en: 'Mahmoud' },
  { ar: 'مصطفى', en: 'Mostafa' },
  { ar: 'كريم', en: 'Karim' },
  { ar: 'عمرو', en: 'Amr' },
  { ar: 'هدى', en: 'Hoda' },
  { ar: 'منى', en: 'Mona' },
  { ar: 'سارة', en: 'Sara' },
  { ar: 'ندى', en: 'Nada' },
  { ar: 'ياسمين', en: 'Yasmin' },
  { ar: 'فاطمة', en: 'Fatma' },
];

const FAMILY_NAMES: { ar: string; en: string }[] = [
  { ar: 'عبد العال', en: 'Abdelaal' },
  { ar: 'السيد', en: 'Elsayed' },
  { ar: 'حسن', en: 'Hassan' },
  { ar: 'إبراهيم', en: 'Ibrahim' },
  { ar: 'عبد الرحمن', en: 'Abdelrahman' },
  { ar: 'شعبان', en: 'Shaaban' },
  { ar: 'الشناوي', en: 'Elshennawy' },
  { ar: 'زكي', en: 'Zaki' },
  { ar: 'فؤاد', en: 'Fouad' },
  { ar: 'رمضان', en: 'Ramadan' },
];

/**
 * A syntactically valid Egyptian national id for a 1990s birth: century digit 2, YYMMDD, a
 * governorate code, a serial, and a check digit position the platform does not verify. Distinct
 * per candidate because the live-applicant uniqueness rule is real.
 */
const demoNationalId = (index: number): string => {
  const day = String((index % 28) + 1).padStart(2, '0');
  const month = String((index % 12) + 1).padStart(2, '0');
  const year = String(90 + (index % 9)).padStart(2, '0');
  const serial = String(1000 + index).padStart(5, '0');
  return `2${year}${month}${day}01${serial}`.slice(0, 14);
};

const demoPhone = (index: number): string => `01${String(100_000_000 + index).slice(0, 9)}`;

interface DemoPerson {
  intakeKey: string;
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  phone: string;
  email: string;
}

/** Stable per (stage, slot): the same run twice produces the same person, hence the same key. */
const personFor = (stage: DemoStage, slot: number): DemoPerson => {
  const index = DEMO_STAGES.indexOf(stage) * DEMO_COHORT_SIZE + slot;
  const first = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const family = FAMILY_NAMES[(index * 3) % FAMILY_NAMES.length]!;
  return {
    intakeKey: `${DEMO_INTAKE_PREFIX}${stage}:${String(slot).padStart(2, '0')}`,
    fullNameAr: `${first.ar} ${family.ar}`,
    fullNameEn: `${first.en} ${family.en}`,
    nationalId: demoNationalId(index),
    phone: demoPhone(index),
    email: `demo.${stage.toLowerCase()}.${slot}@example.test`,
  };
};

// ── Driving the pipeline ────────────────────────────────────────────────────

interface Deps {
  ctx: AuthContext;
  sourceId: string;
}

/**
 * The privileged context the seeder acts as. Every service call is audited under the seeding
 * admin, so demo rows are attributable exactly like real ones.
 */
const demoContext = (adminId: string, permissions: string[]): AuthContext => ({
  userId: adminId,
  sessionId: 'seed-demo',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
  permissionVersion: 0,
  isPrivileged: true,
});

const HR_PERMISSIONS = [
  'applicant.view',
  'applicant.create',
  'applicant.edit',
  'applicant.verifyIdentity',
  'screening.view',
  'screening.create',
  'screening.edit',
  'screening.decide',
  'interview.view',
  'interview.create',
  'interview.edit',
  'interview.decide',
  'evaluation.view',
  'evaluation.create',
  'evaluation.edit',
  'evaluation.decide',
  'securityCheck.view',
  'securityCheck.decide',
  'drivingTest.view',
  'drivingTest.decide',
  'medicalCheck.view',
  'medicalCheck.decide',
  'jobOffer.view',
  'jobOffer.create',
  'jobOffer.edit',
  'jobOffer.send',
  'jobOffer.respond',
  'employee.create',
  'employee.view',
];

/** Register one candidate. Returns the applicant id; a repeat key returns the first one. */
const register = async (deps: Deps, person: DemoPerson): Promise<string> => {
  const { applicantService } = await import('./modules/hr/recruitment/applicants');
  const input: RegisterApplicant = {
    sourceId: deps.sourceId,
    intakeChannel: 'internal',
    intakeKey: person.intakeKey,
    identity: {
      fullNameAr: person.fullNameAr,
      fullNameEn: person.fullNameEn,
      nationalId: person.nationalId,
      nationality: 'Egyptian',
    },
    contact: { primaryPhone: person.phone, email: person.email },
  } as RegisterApplicant;
  const doc = await applicantService.register(deps.ctx, input);
  return String(doc._id);
};

/** The ID gate (§ identity verification) — a real action, not a field write. */
const verifyIdentity = async (deps: Deps, applicantId: string, nationalId: string): Promise<void> => {
  const { applicantService } = await import('./modules/hr/recruitment/applicants');
  const current = await applicantService.findByIdSystem(applicantId);
  if (current === null || current.identityVerification === 'verified') return;
  await applicantService.confirmIdentity(
    deps.ctx,
    applicantId,
    { nationalId, version: current.__v },
    orgScope(deps.ctx),
  );
};

const orgScope = (ctx: AuthContext) => ({
  scope: 'organization' as const,
  userId: ctx.userId,
  branchId: null,
  departmentId: null,
  sectionId: null,
});

/** Accept the waiting screening, which materializes the first interview round. */
const acceptScreening = async (deps: Deps, applicantId: string): Promise<void> => {
  const { screeningService } = await import('./modules/hr/recruitment/screening');
  const screening = await screeningService.findByApplicantId(applicantId);
  if (screening === null || screening.status !== 'waiting') return;
  const input: DecideScreening = { outcome: 'accepted', version: screening.__v };
  await screeningService.decide(deps.ctx, String(screening._id), input, orgScope(deps.ctx));
};

/** Clear every interview stage the candidate still has waiting. */
const passAllInterviews = async (deps: Deps, applicantId: string): Promise<void> => {
  const { interviewService } = await import('./modules/hr/recruitment/interviews');
  const { interviewStageService } = await import('./modules/hr/recruitment/interviews');
  const stages = await interviewStageService.list({
    page: 1,
    pageSize: 50,
    sortDir: 'asc',
    active: true,
  });
  for (const stage of stages.items) {
    // Start the round immediately (RW12/A3) rather than scheduling then starting — the seeder
    // wants the candidate PAST the round, and this is the platform's own one-step path.
    const started = await interviewService.start(
      deps.ctx,
      { applicantId, stageId: String(stage._id), interviewerIds: [] },
      orgScope(deps.ctx),
    );
    // `start` puts the caller on the panel as `pending`, and a round cannot be decided while any
    // panel member still is — the seeder submits its own evaluation first, exactly as the
    // interviewer would on screen.
    const evaluated = await interviewService.submitEvaluation(
      deps.ctx,
      String(started._id),
      { recommendation: 'recommend', rating: 4, version: started.__v },
      orgScope(deps.ctx),
    );
    const decision: DecideInterview = { outcome: 'passed', version: evaluated.__v };
    await interviewService.decide(deps.ctx, String(evaluated._id), decision, orgScope(deps.ctx));
  }
};

/** Approve every evaluation the candidate has open. */
const passAllEvaluations = async (deps: Deps, applicantId: string): Promise<void> => {
  const { evaluationService } = await import('./modules/hr/recruitment/evaluations');
  const evaluations = await evaluationService.listByApplicant(applicantId);
  for (const evaluation of evaluations) {
    if (evaluation.status !== 'waiting') continue;
    const decision: DecideEvaluation = { decision: 'approved', version: evaluation.__v };
    await evaluationService.decide(deps.ctx, String(evaluation._id), decision, orgScope(deps.ctx));
  }
};

interface OfferTargets {
  jobTitleId: string;
  departmentId: string;
  branchId: string;
}

/** Draft + send an offer. Returns the offer id so the accepting cohort can carry on. */
const sendOffer = async (
  deps: Deps,
  applicantId: string,
  targets: OfferTargets,
): Promise<string | null> => {
  const { jobOfferService } = await import('./modules/hr/recruitment/job-offers');
  const existing = await jobOfferService.listByApplicant(applicantId);
  const live = existing.find((o) => o.status === 'draft' || o.status === 'sent');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 30);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 14);

  const offer =
    live ??
    (await jobOfferService.create(
      deps.ctx,
      {
        applicantId,
        terms: {
          jobTitleId: targets.jobTitleId,
          departmentId: targets.departmentId,
          branchId: targets.branchId,
          employmentType: 'fullTime',
          allowances: [],
          benefits: [],
          probationMonths: 3,
          startDate,
          validUntil,
        },
      } as CreateJobOffer,
      orgScope(deps.ctx),
    ));

  if (offer.status === 'draft') {
    const send: SendJobOffer = { version: offer.__v };
    const sent = await jobOfferService.send(deps.ctx, String(offer._id), send, orgScope(deps.ctx));
    return String(sent._id);
  }
  return String(offer._id);
};

/** Record the candidate's acceptance — this is what puts them in the employees-ready queue. */
const acceptOffer = async (deps: Deps, offerId: string): Promise<void> => {
  const { jobOfferService } = await import('./modules/hr/recruitment/job-offers');
  const offer = await jobOfferService.getById(offerId, orgScope(deps.ctx));
  if (offer.status !== 'sent') return;
  const input: AcceptJobOffer = { version: offer.__v };
  await jobOfferService.accept(deps.ctx, offerId, input, orgScope(deps.ctx));
};

// ── Prerequisites the offer stage needs ─────────────────────────────────────

/**
 * An offer must name a job title, a department and a branch. A demo database may have none, so
 * the seeder ensures a minimal set of its own — reusing whatever already exists first, because a
 * real organization structure is always better demo data than an invented one.
 */
const ensureOfferTargets = async (adminId: string): Promise<OfferTargets | null> => {
  const { branchService, departmentService, jobTitleService } = await import('./platform/organization');
  const scope = { scope: 'organization' as const, userId: adminId, branchId: null, departmentId: null, sectionId: null };

  const branches = await branchService.list({ page: 1, pageSize: 1, sortDir: 'asc' }, scope);
  const branch =
    branches.items[0] ??
    (await branchService.create(
      { code: 'DEMO', name: { ar: 'فرع تجريبي', en: 'Demo Branch' } },
      adminId,
    ));

  const departments = await departmentService.list({ page: 1, pageSize: 1, sortDir: 'asc' }, scope);
  const department =
    departments.items[0] ??
    (await departmentService.create(
      { code: 'DEMO-OPS', name: { ar: 'إدارة تجريبية', en: 'Demo Department' }, branchId: String(branch._id) },
      adminId,
    ));

  const titles = await jobTitleService.list({ page: 1, pageSize: 1, sortDir: 'asc' }, scope);
  const title =
    titles.items[0] ??
    (await jobTitleService.create(
      { code: 'DEMO-T1', name: { ar: 'مسمى تجريبي', en: 'Demo Title' }, jobGrade: 'G1' },
      adminId,
    ));

  return {
    branchId: String(branch._id),
    departmentId: String(department._id),
    jobTitleId: String(title._id),
  };
};

const resolveSourceId = async (): Promise<string | null> => {
  const { applicantSourceService } = await import('./modules/hr/recruitment/applicants');
  const sources = await applicantSourceService.list({ page: 1, pageSize: 50, sortDir: 'asc' });
  const internal = sources.items.find((s) => s.key === 'internalHr') ?? sources.items[0];
  return internal === undefined ? null : String(internal._id);
};

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * Place ten candidates at each recruitment stage. Idempotent: a second run finds every
 * `intakeKey` already taken and does nothing.
 */
export const seedDemoPipeline = async (adminId: string): Promise<DemoSeedReport> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('the demo pipeline seed never runs against production');
  }

  const sourceId = await resolveSourceId();
  if (sourceId === null) {
    throw new Error('no applicant source found — run the reference seed (npm run seed) first');
  }
  const targets = await ensureOfferTargets(adminId);
  if (targets === null) throw new Error('could not resolve an offer target (branch/department/title)');

  const deps: Deps = { ctx: demoContext(adminId, HR_PERMISSIONS), sourceId };
  const { ApplicantModel } = await import('./modules/hr/recruitment/applicants/applicant.model');

  const created: Record<DemoStage, number> = {
    applicants: 0,
    screening: 0,
    interview: 0,
    evaluation: 0,
    jobOffer: 0,
    employeesReady: 0,
  };
  let existing = 0;

  for (const stage of DEMO_STAGES) {
    for (let slot = 0; slot < DEMO_COHORT_SIZE; slot += 1) {
      const person = personFor(stage, slot);
      const already = await ApplicantModel.exists({ intakeKey: person.intakeKey });
      if (already !== null) {
        existing += 1;
        continue;
      }

      const applicantId = await register(deps, person);
      created[stage] += 1;

      // Stage `applicants`: registered and waiting at the ID gate — nothing further.
      if (stage === 'applicants') continue;

      await verifyIdentity(deps, applicantId, person.nationalId);
      if (stage === 'screening') continue; // rests in the screening queue

      await acceptScreening(deps, applicantId);
      if (stage === 'interview') continue; // rests at the first interview round

      await passAllInterviews(deps, applicantId);
      if (stage === 'evaluation') continue; // rests at the open evaluations

      await passAllEvaluations(deps, applicantId);
      const offerId = await sendOffer(deps, applicantId, targets);
      if (stage === 'jobOffer' || offerId === null) continue; // rests with a sent offer

      await acceptOffer(deps, offerId);
      // `employeesReady`: an accepted offer awaiting the hire.
    }
    logger.info({ stage, created: created[stage] }, 'demo cohort seeded');
  }

  return { created, existing, total: DEMO_STAGES.length * DEMO_COHORT_SIZE };
};

/**
 * Remove every demo candidate and what they produced. Scoped by the demo intake key, so a real
 * applicant can never be caught by it.
 */
export const resetDemoPipeline = async (): Promise<{ applicants: number }> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('the demo pipeline reset never runs against production');
  }

  const { ApplicantModel } = await import('./modules/hr/recruitment/applicants/applicant.model');
  const { ScreeningModel } = await import('./modules/hr/recruitment/screening/screening.model');
  const { InterviewModel } = await import('./modules/hr/recruitment/interviews/interview.model');
  const { EvaluationModel } = await import('./modules/hr/recruitment/evaluations/evaluation.model');
  const { JobOfferModel } = await import('./modules/hr/recruitment/job-offers/job-offer.model');
  const { RecruitmentTimelineModel } = await import(
    './modules/hr/recruitment/timeline/recruitment-timeline.model'
  );

  const demo = await ApplicantModel.find(
    { intakeKey: { $regex: `^${DEMO_INTAKE_PREFIX}` } },
    { _id: 1 },
  )
    .lean()
    .exec();
  const ids = demo.map((d) => d._id as Types.ObjectId);
  if (ids.length === 0) return { applicants: 0 };

  const byApplicant = { applicantId: { $in: ids } };
  await ScreeningModel.deleteMany(byApplicant).exec();
  await InterviewModel.deleteMany(byApplicant).exec();
  await EvaluationModel.deleteMany(byApplicant).exec();
  await JobOfferModel.deleteMany(byApplicant).exec();
  await RecruitmentTimelineModel.deleteMany(byApplicant).exec();
  await ApplicantModel.deleteMany({ _id: { $in: ids } }).exec();

  logger.info({ applicants: ids.length }, 'demo pipeline removed');
  return { applicants: ids.length };
};
