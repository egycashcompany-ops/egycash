// Manager day decisions (stage 3). Routes authenticate; THIS authorizes — the same split the
// regularization service uses, because the interesting conditions are about relationships and
// about the day, neither of which a route middleware can see.
//
// THE GUARANTEE THIS FEATURE EXISTS TO MAKE: a branch re-send or a `days/recompute` never undoes a
// decision. It holds by construction rather than by care — the decision is an INPUT to the
// derivation (`liveDecisionFor`), so every recompute re-applies it. Nothing here writes a status
// onto a day row, and nothing here edits or supersedes a punch.
import { Types } from 'mongoose';
import {
  type AttendanceDecisionDto,
  type CreateAttendanceDecision,
  type DecideAttendanceDecision,
  type ListAttendanceDecisionsQuery,
  type Paginated,
  type RevokeAttendanceDecision,
  type AttendanceDecisionSignalsDto,
  type AttendanceDecisionSignalsQuery,
  HrAttendanceSettingKeys,
} from '@ecms/contracts';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { settingsService } from '../../../../platform/settings';
import { directoryProfileService } from '../../../../platform/directory/directory-profile.service';
import { cairoToday, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { AttendancePunchModel } from '../punches';
import { AttendanceDayModel, dayRecordService, punchWindowFor } from '../day-records';
import { AttendanceDecisionModel, type AttendanceDecisionDoc } from './decision.model';
import { decisionRepository } from './decision.repository';
import { approveProblem, dayProblem, decideProblem, landsPendingHr, revokeProblem } from './decision-rules';

/** The review threshold is a company-wide posture, read at the organization subject. */
const ORG_SUBJECT = { userId: null, branchId: null };

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'attendanceDayDecision',
  entityId: id,
});

/** Caller capabilities, computed by the controller from effective permissions (the Leave idiom). */
export interface DecisionCallerFlags {
  canDecide: boolean;
  canApprove: boolean;
}

export const toDecisionDto = (doc: AttendanceDecisionDoc): AttendanceDecisionDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  workDate: dateOnlyIso(doc.workDate),
  type: doc.type,
  inAt: doc.inAt === null ? null : doc.inAt.toISOString(),
  outAt: doc.outAt === null ? null : doc.outAt.toISOString(),
  reason: doc.reason,
  status: doc.status,
  overrodePunch: doc.overrodePunch,
  decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
  decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
  hrDecidedBy: doc.hrDecidedBy === null ? null : String(doc.hrDecidedBy),
  hrDecidedAt: doc.hrDecidedAt === null ? null : doc.hrDecidedAt.toISOString(),
  hrComment: doc.hrComment,
  revokesId: doc.revokesId === null ? null : String(doc.revokesId),
  branchId: doc.branchId === null ? null : String(doc.branchId),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class DecisionService {
  /**
   * Record a decision about one employee-day.
   *
   * Four gates, in the order a caller meets them: the grant and the self-prohibition, then the day
   * itself (not in the future, not frozen), then the subject's existence, then the age rule that
   * decides whether this takes effect now or waits for HR.
   */
  async create(
    ctx: AuthContext,
    flags: DecisionCallerFlags,
    input: CreateAttendanceDecision,
  ): Promise<AttendanceDecisionDoc> {
    const subject = await employeeRepository.findById(input.employeeId);
    if (subject === null) throw new NotFoundError('employee not found');

    const problem = decideProblem({
      canDecide: flags.canDecide,
      isSubject: subject.userId !== null && String(subject.userId) === ctx.userId,
    });
    if (problem !== null) throw new ForbiddenError(problem);

    const workDate = toDateOnly(input.workDate);
    const today = cairoToday();
    const existing = await AttendanceDayModel.findOne({
      employeeId: subject._id,
      workDate,
      isDeleted: false,
    })
      .select({ frozenAt: 1 })
      .lean<{ frozenAt: Date | null }>()
      .exec();
    const dayIssue = dayProblem({
      workDate,
      today,
      frozen: existing !== null && existing.frozenAt !== null,
    });
    if (dayIssue !== null) throw new BusinessRuleError(dayIssue);

    // Recorded now rather than derived later: the question a reviewer asks is what the manager was
    // looking at WHEN THEY DECIDED, and the punches can change afterwards.
    const overrodePunch = await this.hadEvidence(String(subject._id), workDate);

    const approvalAfterDays = await settingsService.resolve<number>(
      HrAttendanceSettingKeys.DecisionApprovalAfterDays,
      { userId: null, branchId: String(subject.employment.branchId) },
    );
    const pending = landsPendingHr({ workDate, today, approvalAfterDays });

    const now = new Date();
    const doc = await AttendanceDecisionModel.create({
      employeeId: subject._id,
      workDate,
      type: input.type,
      inAt: input.inAt ?? null,
      outAt: input.outAt ?? null,
      reason: input.reason,
      status: pending ? 'pendingHr' : 'applied',
      overrodePunch,
      decidedBy: new Types.ObjectId(ctx.userId),
      decidedAt: now,
      hrDecidedBy: null,
      hrDecidedAt: null,
      hrComment: null,
      revokesId: null,
      branchId: subject.employment.branchId,
      createdBy: new Types.ObjectId(ctx.userId),
      updatedBy: new Types.ObjectId(ctx.userId),
    });

    await this.record(doc, 'attendanceDecision', [
      { field: 'type', old: null, new: doc.type },
      { field: 'workDate', old: null, new: dateOnlyIso(workDate) },
      { field: 'status', old: null, new: doc.status },
      { field: 'reason', old: null, new: doc.reason },
      { field: 'overrodePunch', old: null, new: String(overrodePunch) },
    ]);
    // Only an applied decision changes anything. A pending one is a record and no more, which is
    // what makes the queue worth clearing.
    if (!pending) await dayRecordService.computeDay(String(subject._id), workDate);
    return doc.toObject() as AttendanceDecisionDoc;
  }

  /** HR clears the old-day queue: approve puts the decision in force, reject retires it. */
  async decide(
    ctx: AuthContext,
    flags: DecisionCallerFlags,
    id: string,
    input: DecideAttendanceDecision,
  ): Promise<AttendanceDecisionDoc> {
    const doc = await AttendanceDecisionModel.findOne({ _id: id, isDeleted: false }).exec();
    if (doc === null) throw new NotFoundError('decision not found');
    const subject = await employeeRepository.findById(String(doc.employeeId));
    if (subject === null) throw new NotFoundError('employee not found');

    const problem = approveProblem({
      status: doc.status,
      canApprove: flags.canApprove,
      isSubject: subject.userId !== null && String(subject.userId) === ctx.userId,
      isAuthor: doc.decidedBy !== null && String(doc.decidedBy) === ctx.userId,
    });
    if (problem !== null) throw new ForbiddenError(problem);

    // An approval that would land on a month closed since the decision was filed is refused rather
    // than silently doing nothing — the same reasoning as filing against a frozen day.
    if (input.verdict === 'approve') {
      const day = await AttendanceDayModel.findOne({
        employeeId: doc.employeeId,
        workDate: doc.workDate,
        isDeleted: false,
      })
        .select({ frozenAt: 1 })
        .lean<{ frozenAt: Date | null }>()
        .exec();
      if (day !== null && day.frozenAt !== null) {
        throw new BusinessRuleError(
          'الشهر مغلق من المرتبات — لا يمكن تعديل هذا اليوم، والتسوية تمر كتعديل في شهر لاحق',
        );
      }
    }

    const target = input.verdict === 'approve' ? 'applied' : 'rejected';
    const updated = await AttendanceDecisionModel.findOneAndUpdate(
      { _id: doc._id, status: 'pendingHr', __v: input.version, isDeleted: false },
      {
        $set: {
          status: target,
          hrDecidedBy: new Types.ObjectId(ctx.userId),
          hrDecidedAt: new Date(),
          hrComment: input.comment ?? null,
        },
        $inc: { __v: 1 },
      },
      { new: true },
    ).exec();
    if (updated === null) {
      throw new BusinessRuleError('the decision changed under you — reload and retry');
    }

    await this.record(updated, 'attendanceDecisionApproval', [
      { field: 'verdict', old: null, new: input.verdict },
      { field: 'status', old: doc.status, new: target },
      ...(input.comment === undefined ? [] : [{ field: 'comment', old: null, new: input.comment }]),
    ]);
    if (target === 'applied') {
      await dayRecordService.computeDay(String(updated.employeeId), updated.workDate);
    }
    return updated.toObject() as AttendanceDecisionDoc;
  }

  /**
   * Undo a decision by RECORDING one. The original stays, marked `revoked`, and a new `revoke` row
   * points back at it with its own mandatory reason — so the trail reads "this was decided, then
   * undone, by these two people, for these two reasons" rather than simply going blank.
   */
  async revoke(
    ctx: AuthContext,
    flags: DecisionCallerFlags,
    id: string,
    input: RevokeAttendanceDecision,
  ): Promise<AttendanceDecisionDoc> {
    const doc = await AttendanceDecisionModel.findOne({ _id: id, isDeleted: false }).exec();
    if (doc === null) throw new NotFoundError('decision not found');
    const subject = await employeeRepository.findById(String(doc.employeeId));
    if (subject === null) throw new NotFoundError('employee not found');

    const problem = revokeProblem({
      status: doc.status,
      type: doc.type,
      canDecide: flags.canDecide,
      isSubject: subject.userId !== null && String(subject.userId) === ctx.userId,
    });
    if (problem !== null) throw new ForbiddenError(problem);

    const day = await AttendanceDayModel.findOne({
      employeeId: doc.employeeId,
      workDate: doc.workDate,
      isDeleted: false,
    })
      .select({ frozenAt: 1 })
      .lean<{ frozenAt: Date | null }>()
      .exec();
    if (day !== null && day.frozenAt !== null) {
      throw new BusinessRuleError(
        'الشهر مغلق من المرتبات — لا يمكن تعديل هذا اليوم، والتسوية تمر كتعديل في شهر لاحق',
      );
    }

    const retired = await AttendanceDecisionModel.findOneAndUpdate(
      { _id: doc._id, status: doc.status, __v: input.version, isDeleted: false },
      { $set: { status: 'revoked' }, $inc: { __v: 1 } },
      { new: true },
    ).exec();
    if (retired === null) {
      throw new BusinessRuleError('the decision changed under you — reload and retry');
    }

    const now = new Date();
    const record = await AttendanceDecisionModel.create({
      employeeId: doc.employeeId,
      workDate: doc.workDate,
      type: 'revoke',
      inAt: null,
      outAt: null,
      reason: input.reason,
      status: 'applied',
      overrodePunch: false,
      decidedBy: new Types.ObjectId(ctx.userId),
      decidedAt: now,
      hrDecidedBy: null,
      hrDecidedAt: null,
      hrComment: null,
      revokesId: doc._id,
      branchId: doc.branchId,
      createdBy: new Types.ObjectId(ctx.userId),
      updatedBy: new Types.ObjectId(ctx.userId),
    });

    await this.record(record, 'attendanceDecisionRevoke', [
      { field: 'revokes', old: null, new: String(doc._id) },
      { field: 'status', old: doc.status, new: 'revoked' },
      { field: 'reason', old: null, new: input.reason },
    ]);
    // The day goes back to what the devices saw, because nothing of theirs was ever changed.
    await dayRecordService.computeDay(String(doc.employeeId), doc.workDate);
    return record.toObject() as AttendanceDecisionDoc;
  }

  async list(
    query: ListAttendanceDecisionsQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<AttendanceDecisionDoc>> {
    return decisionRepository.listDecisions(query, scope);
  }

  /**
   * WHO HAS BEEN DECIDING DAYS, and how often against the devices (stage 4 §4).
   *
   * One grouped pass over the window rather than a page of rows counted in the client: the point
   * of the screen is the totals, and a reviewer narrowing to one branch should not have to page
   * through a quarter's decisions to find out that one supervisor made most of them.
   *
   * `revoke` rows are EXCLUDED from the counts. Undoing a decision is not a second decision about
   * the day, and counting it would make a manager who corrected their own mistake look twice as
   * busy as one who left it standing — exactly the wrong incentive for a screen like this.
   *
   * The threshold is stored per WEEK and scaled to the window asked about, so a reviewer looking
   * at a month is not flagged against a week's number. It is a prompt to look: nothing here
   * blocks, refuses or undoes anything.
   */
  async signals(
    query: AttendanceDecisionSignalsQuery,
    scope?: ScopeSelector,
  ): Promise<AttendanceDecisionSignalsDto> {
    const weekly = await settingsService.resolve<number>(
      HrAttendanceSettingKeys.DecisionWeeklyReviewThreshold,
      ORG_SUBJECT,
    );
    const days = Math.max(1, Math.round((query.to.getTime() - query.from.getTime()) / 86_400_000) + 1);
    const threshold = Math.max(1, Math.ceil((weekly * days) / 7));

    const rows = await decisionRepository.countByDecider(query, scope);
    const names = await directoryProfileService.resolve(rows.map((row) => row.decidedBy));

    return {
      from: dateOnlyIso(query.from),
      to: dateOnlyIso(query.to),
      threshold,
      managers: rows
        .map((row) => ({
          decidedBy: row.decidedBy,
          decidedByName: names.get(row.decidedBy)?.displayName ?? { ar: row.decidedBy, en: row.decidedBy },
          total: row.total,
          overrodePunch: row.overrodePunch,
          flagged: row.total > threshold,
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  /**
   * Did the devices have anything to say about this day when the decision was made?
   *
   * The window is the engine's own (`punchWindowFor` with no expectation — the Cairo calendar
   * day), so "there was evidence" means the same thing here as it does to the derivation. Asked
   * without a shift deliberately: the question is whether ANY punch exists for the day, not
   * whether one falls inside a particular expectation.
   */
  private async hadEvidence(employeeId: string, workDate: Date): Promise<boolean> {
    const window = punchWindowFor(workDate, null);
    const count = await AttendancePunchModel.countDocuments({
      employeeId: new Types.ObjectId(employeeId),
      at: { $gte: window.from, $lte: window.to },
      supersededBy: null,
    }).exec();
    return count > 0;
  }

  private async record(
    doc: AttendanceDecisionDoc,
    action: 'attendanceDecision' | 'attendanceDecisionApproval' | 'attendanceDecisionRevoke',
    changes: { field: string; old: string | null; new: string }[],
  ): Promise<void> {
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action,
      changes: [{ field: 'employeeId', old: null, new: String(doc.employeeId) }, ...changes],
    });
  }
}

export const decisionService = new DecisionService();
