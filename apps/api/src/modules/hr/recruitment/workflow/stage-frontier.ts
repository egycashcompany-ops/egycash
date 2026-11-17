// How far the candidate has got, and therefore which stages are behind them (I-FRONTIER).
//
// THE PROBLEM THIS ANSWERS. Every stage page used to decide what a recruiter may do from the
// STATUS OF ITS OWN ROW, which cannot see the rest of the pipeline. So a candidate sitting at the
// security check still had «بدء المقابلة» and «تعديل القرار» offered on their screening and
// «نقل لمرحلة عرض العمل» on their first interview — each button correct about its own record and
// wrong about the person. Pressing one re-opened a stage the candidate had left, or jumped them
// past stages nobody had decided.
//
// So the question is asked once, here, about the WHOLE pipeline: what is the furthest place this
// candidate has a record at, and is this record behind it? A stage behind the frontier is history:
// its result, its notes and its files are still readable, and nothing on it may move.
//
// WHY A FRONTIER AND NOT "THE CURRENT STAGE". `currentStage` (workflow-state.ts) answers "what
// happens next?" and must return ONE row to do it. Evaluation phases are deliberately parallel —
// `openEvaluationPhases` opens the security check and the medical check together, and the comment
// there says phases are independent — so "the one current row" is an arbitrary choice between two
// rows that are equally live. Deciding either must be allowed. A frontier compares POSITIONS
// rather than picking a row, so two phases at the same position are both at it.
//
// WHY THE OFFER IS NOT SPECIAL-CASED. Nothing comes after the offer, so an accepted offer is never
// behind the frontier and the rulebook's deliberate late moves — withdrawing an accepted offer and
// re-offering (RW3/OQ-3) — keep working without an exception written for them here.
import { Types, type ClientSession, type Model } from 'mongoose';
import { type LocalizedString, type RecruitmentStageKind } from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { stageBindingsInOrder } from './workflow-engine';
import { type StageObject } from './workflow-transitions';

/**
 * Pipeline order, as positions rather than as a list. The gap between objects is wide enough that
 * no interview round or evaluation phase order can reach the next object — a candidate's eleventh
 * interview round is still an interview.
 */
const OBJECT_POSITION: Record<StageObject, number> = {
  screening: 1000,
  interview: 2000,
  evaluation: 3000,
  offer: 4000,
};

export const STAGE_KIND: Record<StageObject, RecruitmentStageKind> = {
  screening: 'screening',
  interview: 'interview',
  evaluation: 'evaluation',
  offer: 'jobOffer',
};

/**
 * Where one stage record sits in the pipeline.
 *
 * THE ORDER COUNTS FOR INTERVIEW ROUNDS AND FOR NOTHING ELSE, because only rounds are sequential:
 * `advanceAfterInterview` opens the next round only once the previous one has been passed, so the
 * second round really is past the first. Evaluation phases are the opposite —
 * `openEvaluationPhases` opens every applicable phase together and each is decided on its own, so
 * their catalogue `order` is the order they are LISTED in, not an order they happen in. Counting it
 * here would have put «الفحص الأمني» (order 1) behind «الفحص الطبي» (order 2) and made the security
 * check read-only while it was still waiting to be decided — which is the bug this whole file
 * exists to prevent, reintroduced one layer down.
 */
export const stageRank = (object: StageObject, order: number | null | undefined): number =>
  OBJECT_POSITION[object] + (object === 'interview' && typeof order === 'number' ? order : 0);

/** The statuses that mean "this record still has work on it" — the same table `workflow-state` uses. */
export const OPEN_STATUSES: Record<StageObject, readonly string[]> = {
  screening: ['waiting'],
  interview: ['waiting', 'scheduled', 'inProgress'],
  evaluation: ['waiting'],
  offer: ['waiting', 'draft', 'sent'],
};

/** One live stage record, as far as the frontier cares. */
export interface LiveStageRow {
  object: StageObject;
  recordId: string;
  /** `screening` · `interview:<stageId>` · `evaluation:<phaseId>` · `jobOffer`. */
  key: string;
  refId: string | null;
  /** The round's or phase's own name, denormalized on the row — «المقابلة الأولى», «الفحص الأمني». */
  name: LocalizedString | null;
  status: string;
  attempt: number;
  rank: number;
  open: boolean;
}

interface RawRow {
  _id: Types.ObjectId;
  status: string;
  attempt: number;
  stageId?: Types.ObjectId;
  phaseId?: Types.ObjectId;
  stageOrder?: number;
  phaseOrder?: number;
  stageName?: LocalizedString;
  phaseName?: LocalizedString;
}

/**
 * Every live stage record this candidate holds, in pipeline order.
 *
 * Live means not superseded and not deleted — a retired attempt is already read-only by I1 and has
 * no business setting the frontier, or a return to an earlier stage would leave the candidate
 * looking as if they were still at the stage they were sent back from.
 */
export const liveStageRows = async (
  applicantId: string,
  session?: ClientSession,
): Promise<LiveStageRow[]> => {
  if (!Types.ObjectId.isValid(applicantId)) return [];
  const oid = new Types.ObjectId(applicantId);
  const rows: LiveStageRow[] = [];
  for (const binding of stageBindingsInOrder()) {
    const query = (binding.model as unknown as Model<RawRow>)
      .find({ applicantId: oid, supersededAt: null, isDeleted: false })
      .sort({ attempt: 1 })
      .lean<RawRow[]>();
    const found = await (session === undefined ? query.exec() : query.session(session).exec());
    for (const row of found) {
      const refId =
        binding.stageField === 'stageId'
          ? (row.stageId ?? null)
          : binding.stageField === 'phaseId'
            ? (row.phaseId ?? null)
            : null;
      const kind = STAGE_KIND[binding.object];
      rows.push({
        object: binding.object,
        recordId: String(row._id),
        refId: refId === null ? null : String(refId),
        key: refId === null ? kind : `${kind}:${String(refId)}`,
        name: row.stageName ?? row.phaseName ?? null,
        status: row.status,
        attempt: row.attempt,
        rank: stageRank(binding.object, row.stageOrder ?? row.phaseOrder ?? null),
        open: OPEN_STATUSES[binding.object].includes(row.status),
      });
    }
  }
  return rows;
};

/**
 * Where the candidate stands: the furthest OPEN record, and the newest attempt of it.
 *
 * This is what "what happens next?" wants, and it has to pick one row to say it. Where two
 * evaluation phases are open at the same position the choice between them is arbitrary — which is
 * exactly why the READ-ONLY rule compares ranks instead of asking this question.
 */
export const currentOf = (rows: readonly LiveStageRow[]): LiveStageRow | null =>
  rows
    .filter((r) => r.open)
    .reduce<LiveStageRow | null>(
      (acc, row) =>
        acc === null || row.rank > acc.rank || (row.rank === acc.rank && row.attempt > acc.attempt)
          ? row
          : acc,
      null,
    );

/**
 * WHICH round or phase a stage record belongs to, read off the record itself.
 *
 * Every published event travels with this, because without it the candidate's history cannot say
 * «المقابلة الأولى» rather than «المقابلة», and two real events — the security check opening and
 * the medical check opening, moments apart — arrive on the timeline as two identical lines that
 * read like a duplicate. The name is denormalized on the row, so this costs nothing.
 */
export interface StageIdentity {
  stageKind: RecruitmentStageKind;
  stageRefId: string | null;
  stageName: LocalizedString | null;
  stageOrder: number | null;
}

export const stageIdentityOf = (object: StageObject, row: unknown): StageIdentity => {
  const r = (row ?? {}) as Partial<RawRow>;
  const refId = r.stageId ?? r.phaseId ?? null;
  const order = r.stageOrder ?? r.phaseOrder ?? null;
  return {
    stageKind: STAGE_KIND[object],
    stageRefId: refId === null ? null : String(refId),
    stageName: r.stageName ?? r.phaseName ?? null,
    stageOrder: typeof order === 'number' ? order : null,
  };
};

/**
 * THE OFFER DOES NOT SET THE FRONTIER, and this is the second place that rule has to be written.
 *
 * Screening, the interview rounds and the checks gate each other: each opens because the one before
 * it was passed, so holding a record at one of them really does put the earlier ones behind the
 * candidate. The offer does not work that way — HR starts it when they decide to, and the checks go
 * on being decided afterwards («اي حد يخلص كشف الطبي»). Letting an offer row set the frontier made
 * the security check read-only the moment somebody started the offer, which is the original bug
 * wearing a different hat.
 */
const SETS_FRONTIER = (row: LiveStageRow): boolean => row.object !== 'offer';

/** The furthest GATING position the candidate holds a live record at; null when they hold none. */
export const frontierRank = (rows: readonly LiveStageRow[]): number | null => {
  const gating = rows.filter(SETS_FRONTIER);
  return gating.length === 0 ? null : Math.max(...gating.map((r) => r.rank));
};

/**
 * Has the candidate moved past this record? True when some live record sits at a LATER position.
 *
 * Equal ranks are not past each other, which is what keeps two evaluation phases — or two attempts
 * at one round — both actionable.
 */
export const isPassed = (rows: readonly LiveStageRow[], rank: number): boolean => {
  const furthest = frontierRank(rows);
  return furthest !== null && furthest > rank;
};

/** The records the candidate has moved past, for the client to render read-only. */
export const passedRecordIds = (rows: readonly LiveStageRow[]): string[] =>
  rows.filter((r) => isPassed(rows, r.rank)).map((r) => r.recordId);

/**
 * A later record NOBODY HAS ACTED ON YET.
 *
 * `waiting` is the obvious one: the row exists because this decision opened it, and nothing has
 * been done to it. `cancelled` counts too, and it has to: when a decision is flipped to a
 * rejection the lifecycle closes every open row (I14), so the row this decision opened is sitting
 * there cancelled — and flipping BACK must not then be refused on the strength of the closure the
 * flip itself caused. Nothing was decided on a cancelled row; it is terminal for its attempt, and
 * reactivation re-opens the stage on a fresh one (I11/I12).
 *
 * Everything else — scheduled, inProgress, completed, accepted, approved, rejected, draft, sent —
 * means somebody acted, and a correction upstream would contradict them.
 */
const UNTOUCHED = new Set(['waiting', 'cancelled']);

/**
 * May this decision still be CORRECTED? (D7 — «a decision is not final», but not for ever.)
 *
 * A decision stays correctable while everything it set in motion is still untouched: the queue row
 * it opened, and nothing beyond. The moment anybody schedules the round, starts it, decides it,
 * drafts the offer or sends it, the correction would be rewriting the ground they stood on — and
 * that is what a return to an earlier stage is for, with its own break-glass key and its own
 * superseding of everything downstream.
 *
 * This is deliberately WEAKER than `isPassed`: a stage with a waiting row after it is "passed" for
 * the purpose of hiding its forward actions, and still correctable. The two questions are not the
 * same, and collapsing them is what would make «تعديل القرار» either always available or never.
 */
export const isCorrectable = (rows: readonly LiveStageRow[], rank: number): boolean =>
  rows.filter((r) => r.rank > rank).every((r) => UNTOUCHED.has(r.status));

/** The records whose decision may still be corrected, for the client to offer «تعديل القرار». */
export const correctableRecordIds = (rows: readonly LiveStageRow[]): string[] =>
  rows.filter((r) => isCorrectable(rows, r.rank)).map((r) => r.recordId);

/**
 * Refuse a correction once anybody has acted on what the decision set in motion.
 *
 * Separate from `assertStageNotPassed` because it answers a different question and gives a
 * different instruction: that one says the stage is behind the candidate, this one says the
 * decision has been built upon.
 */
export const assertStageCorrectable = async (
  applicantId: string,
  object: StageObject,
  order: number | null | undefined,
  entity: string,
  session?: ClientSession,
): Promise<void> => {
  const rows = await liveStageRows(applicantId, session);
  const rank = stageRank(object, order);
  if (isCorrectable(rows, rank)) return;
  const acted = rows.find((r) => r.rank > rank && !UNTOUCHED.has(r.status));
  throw new BusinessRuleError(
    `${entity}: ${acted === null || acted === undefined ? 'a later stage' : acted.key} is already ` +
      `${acted?.status ?? 'under way'}, so this decision can no longer be corrected — send the ` +
      'candidate back to this stage if it really has to change',
  );
};

/**
 * Refuse a pipeline action on a stage the candidate has moved past.
 *
 * A user CAN arrive here honestly — a tab left open while a colleague advanced the candidate, a
 * deep link out of the timeline — so this is a business-rule refusal (422) that NAMES where the
 * candidate actually stands, the same shape and the same register as `assertNotSuperseded` beside
 * it. Enforced on the server because hiding a button is a courtesy and not a control: a stale page
 * or a direct request must meet the same rule the page does.
 */
export const assertStageNotPassed = async (
  applicantId: string,
  object: StageObject,
  order: number | null | undefined,
  entity: string,
  session?: ClientSession,
): Promise<void> => {
  const rows = await liveStageRows(applicantId, session);
  const rank = stageRank(object, order);
  if (!isPassed(rows, rank)) return;
  const furthest = rows.reduce<LiveStageRow | null>(
    (acc, row) => (acc === null || row.rank > acc.rank ? row : acc),
    null,
  );
  throw new BusinessRuleError(
    `${entity}: the candidate has moved on to ${furthest === null ? 'a later stage' : furthest.key}, ` +
      'so this stage is read-only — send them back to it with a return to an earlier stage if it ' +
      'really has to be re-decided',
  );
};

