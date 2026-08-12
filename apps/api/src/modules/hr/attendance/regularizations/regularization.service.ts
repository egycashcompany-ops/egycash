// Regularization service (v1.1 §7, D7 as ruled). Routes authenticate; THIS is what authorizes —
// the Leave R9 shape: the manager step by relationship, the HR step by permission, the subject
// barred from deciding their own request whatever they hold (C7).
//
// Applying an approval is the ADR-027 move, never a row edit: the proposal becomes two manual
// punches, every previously-active punch attributed to the day is superseded by the new in-punch,
// and the day is recomputed. On a FROZEN day the evidence is still recorded and the request is
// stamped `postFreeze` — but the row is not recomputed and not touched: the correction reaches
// pay as a forward adjustment (P-HR-08), never as a restatement.
import { Types } from 'mongoose';
import {
  HrAttendanceEvents,
  HrAttendanceTemplates,
  type AttendanceRegularizationDto,
  type CreateAttendanceRegularization,
  type DecideAttendanceRegularization,
} from '@ecms/contracts';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { AttendancePunchModel } from '../punches';
import { AttendanceDayModel, dayRecordService } from '../day-records';
import {
  AttendanceRegularizationModel,
  type AttendanceRegularizationDoc,
} from './regularization.model';
import { decisionProblem, nextStatus, stepOf } from './regularization-rules';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'attendanceRegularization',
  entityId: id,
});

/** Caller capabilities, computed by the controller from effective permissions (the Leave idiom). */
export interface RegularizationCallerFlags {
  canRequest: boolean;
  canDecide: boolean;
}

export const toRegularizationDto = (
  doc: AttendanceRegularizationDoc,
): AttendanceRegularizationDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  workDate: dateOnlyIso(doc.workDate),
  proposedInAt: doc.proposedInAt.toISOString(),
  proposedOutAt: doc.proposedOutAt.toISOString(),
  reason: doc.reason,
  status: doc.status,
  postFreeze: doc.postFreeze,
  direct: doc.direct,
  managerDecidedBy: doc.managerDecidedBy === null ? null : String(doc.managerDecidedBy),
  managerDecidedAt: doc.managerDecidedAt === null ? null : doc.managerDecidedAt.toISOString(),
  managerComment: doc.managerComment,
  hrDecidedBy: doc.hrDecidedBy === null ? null : String(doc.hrDecidedBy),
  hrDecidedAt: doc.hrDecidedAt === null ? null : doc.hrDecidedAt.toISOString(),
  hrComment: doc.hrComment,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class RegularizationService {
  /**
   * File a request. Self-service: the subject is the caller's own linked employee, gated on
   * `attendance.requestRegularization`. HR direct (D7): `employeeId` names someone else, gated
   * on `attendance.decideRegularization`, and the request applies IMMEDIATELY — one act, with
   * the mandatory reason carried into the audit trail.
   */
  async create(
    ctx: AuthContext,
    flags: RegularizationCallerFlags,
    input: CreateAttendanceRegularization,
  ): Promise<AttendanceRegularizationDoc> {
    const own = await employeeRepository.findByUserIdSystem(ctx.userId);
    const isDirect =
      input.employeeId !== undefined && (own === null || input.employeeId !== String(own._id));

    let subject: EmployeeDoc;
    if (isDirect) {
      if (!flags.canDecide) {
        throw new ForbiddenError('filing for another employee requires attendance.decideRegularization');
      }
      const found = await employeeRepository.findById(input.employeeId as string);
      if (found === null) throw new NotFoundError('employee not found');
      subject = found;
    } else {
      if (!flags.canRequest) {
        throw new ForbiddenError('filing a regularization requires attendance.requestRegularization');
      }
      if (own === null) {
        throw new BusinessRuleError('your account is not linked to an employee record');
      }
      subject = own;
    }

    const workDate = toDateOnly(input.workDate);
    const open = await AttendanceRegularizationModel.findOne({
      employeeId: subject._id,
      workDate,
      status: { $in: ['pendingManager', 'pendingHr'] },
      isDeleted: false,
    }).exec();
    if (open !== null) {
      throw new BusinessRuleError('a regularization for this day is already pending');
    }

    // The Leave precedent for the missing-manager deadlock: no manager ⇒ straight to the HR step.
    const initialStatus =
      subject.employment.managerId !== null ? 'pendingManager' : 'pendingHr';

    const doc = await AttendanceRegularizationModel.create({
      employeeId: subject._id,
      workDate,
      proposedInAt: input.proposedInAt,
      proposedOutAt: input.proposedOutAt,
      reason: input.reason,
      status: isDirect ? 'pendingHr' : initialStatus,
      direct: isDirect,
      branchId: subject.employment.branchId,
      createdBy: new Types.ObjectId(ctx.userId),
      updatedBy: new Types.ObjectId(ctx.userId),
    });

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'attendanceRegularization',
      changes: [
        { field: 'employeeId', old: null, new: String(subject._id) },
        { field: 'workDate', old: null, new: dateOnlyIso(workDate) },
        { field: 'reason', old: null, new: doc.reason },
        { field: 'direct', old: null, new: String(isDirect) },
      ],
    });
    await emit(HrAttendanceEvents.RegularizationRequested, {
      regularizationId: String(doc._id),
      employeeId: String(subject._id),
      workDate: dateOnlyIso(workDate),
      status: doc.status,
    });
    await this.notifySubmitted(subject, doc);

    // D7 direct edit: HR's own filing decides the HR step in the same act — the two-step chain
    // is for requests, and the direct edit is its sanctioned, audited bypass.
    if (isDirect) {
      return this.decide(ctx, { canRequest: flags.canRequest, canDecide: true }, String(doc._id), {
        verdict: 'approve',
        comment: `HR direct edit: ${input.reason}`,
        version: doc.__v,
      });
    }
    return doc.toObject() as AttendanceRegularizationDoc;
  }

  async decide(
    ctx: AuthContext,
    flags: RegularizationCallerFlags,
    id: string,
    input: DecideAttendanceRegularization,
  ): Promise<AttendanceRegularizationDoc> {
    const doc = await AttendanceRegularizationModel.findOne({ _id: id, isDeleted: false }).exec();
    if (doc === null) throw new NotFoundError('regularization not found');
    const subject = await employeeRepository.findById(String(doc.employeeId));
    if (subject === null) throw new NotFoundError('employee not found');

    const problem = decisionProblem({
      status: doc.status,
      isSubject: subject.userId !== null && String(subject.userId) === ctx.userId,
      isManager:
        subject.employment.managerId !== null &&
        String(subject.employment.managerId) === ctx.userId,
      canDecide: flags.canDecide,
    });
    if (problem !== null) throw new ForbiddenError(problem);

    const step = stepOf(doc.status) as 'manager' | 'hr';
    const target = nextStatus(doc.status, input.verdict);

    // Status-conditional + version-conditional: a concurrent decision loses cleanly.
    const decidedFields =
      step === 'manager'
        ? {
            managerDecidedBy: new Types.ObjectId(ctx.userId),
            managerDecidedAt: new Date(),
            managerComment: input.comment ?? null,
          }
        : {
            hrDecidedBy: new Types.ObjectId(ctx.userId),
            hrDecidedAt: new Date(),
            hrComment: input.comment ?? null,
          };
    const updated = await AttendanceRegularizationModel.findOneAndUpdate(
      { _id: doc._id, status: doc.status, __v: input.version, isDeleted: false },
      { $set: { status: target, ...decidedFields }, $inc: { __v: 1 } },
      { new: true },
    ).exec();
    if (updated === null) {
      throw new BusinessRuleError('the request changed under you — reload and retry');
    }

    let postFreeze = false;
    if (target === 'approved') {
      postFreeze = await this.apply(ctx, updated);
      if (postFreeze) {
        await AttendanceRegularizationModel.updateOne(
          { _id: updated._id },
          { $set: { postFreeze: true } },
        ).exec();
        updated.postFreeze = true;
      }
    }

    await auditService.record({
      entityRef: entityRef(String(updated._id)),
      action: 'attendanceRegularizationDecision',
      changes: [
        { field: 'step', old: null, new: step },
        { field: 'verdict', old: null, new: input.verdict },
        { field: 'status', old: doc.status, new: updated.status },
        ...(postFreeze ? [{ field: 'postFreeze', old: 'false', new: 'true' }] : []),
      ],
    });
    await emit(HrAttendanceEvents.RegularizationDecided, {
      regularizationId: String(updated._id),
      employeeId: String(updated.employeeId),
      workDate: dateOnlyIso(updated.workDate),
      step,
      verdict: input.verdict,
      status: updated.status,
      postFreeze,
    });
    await this.notifyDecided(subject, updated);
    return updated.toObject() as AttendanceRegularizationDoc;
  }

  /** The requester withdraws while pending. */
  async cancel(
    ctx: AuthContext,
    id: string,
    version: number,
  ): Promise<AttendanceRegularizationDoc> {
    const doc = await AttendanceRegularizationModel.findOne({ _id: id, isDeleted: false }).exec();
    if (doc === null) throw new NotFoundError('regularization not found');
    if (String(doc.createdBy) !== ctx.userId) {
      throw new ForbiddenError('only the requester may cancel');
    }
    if (stepOf(doc.status) === null) {
      throw new BusinessRuleError('only a pending request can be cancelled');
    }
    const updated = await AttendanceRegularizationModel.findOneAndUpdate(
      { _id: doc._id, status: doc.status, __v: version, isDeleted: false },
      { $set: { status: 'cancelled', cancelledAt: new Date() }, $inc: { __v: 1 } },
      { new: true },
    ).exec();
    if (updated === null) {
      throw new BusinessRuleError('the request changed under you — reload and retry');
    }
    await auditService.record({
      entityRef: entityRef(String(updated._id)),
      action: 'attendanceRegularizationDecision',
      changes: [{ field: 'status', old: doc.status, new: 'cancelled' }],
    });
    return updated.toObject() as AttendanceRegularizationDoc;
  }

  /**
   * Apply an approved proposal, the ADR-027 way. Returns true when the day was frozen — evidence
   * recorded, row untouched, correction flows forward.
   */
  private async apply(ctx: AuthContext, doc: AttendanceRegularizationDoc): Promise<boolean> {
    const by = new Types.ObjectId(ctx.userId);
    // The proposal declares the day's punch truth: everything previously active in a generous
    // window around the proposed span is superseded by the new in-punch.
    const windowFrom = new Date(doc.proposedInAt.getTime() - 12 * 60 * 60 * 1000);
    const windowTo = new Date(doc.proposedOutAt.getTime() + 12 * 60 * 60 * 1000);
    const previous = await AttendancePunchModel.find({
      employeeId: doc.employeeId,
      at: { $gte: windowFrom, $lte: windowTo },
      supersededBy: null,
    })
      .select({ _id: 1 })
      .exec();

    const note = `regularization ${String(doc._id)}`;
    const [inPunch] = await AttendancePunchModel.create([
      {
        employeeId: doc.employeeId,
        at: doc.proposedInAt,
        direction: 'in',
        source: 'manual',
        deviceId: null,
        branchIdAtPunch: doc.branchId,
        importBatchId: null,
        note,
        recordedBy: by,
        createdBy: by,
        updatedBy: by,
      },
    ]);
    await AttendancePunchModel.create([
      {
        employeeId: doc.employeeId,
        at: doc.proposedOutAt,
        direction: 'out',
        source: 'manual',
        deviceId: null,
        branchIdAtPunch: doc.branchId,
        importBatchId: null,
        note,
        recordedBy: by,
        createdBy: by,
        updatedBy: by,
      },
    ]);
    if (previous.length > 0 && inPunch !== undefined) {
      await AttendancePunchModel.updateMany(
        { _id: { $in: previous.map((p) => p._id) }, supersededBy: null },
        { $set: { supersededBy: inPunch._id } },
      ).exec();
    }

    const day = await AttendanceDayModel.findOne({
      employeeId: doc.employeeId,
      workDate: doc.workDate,
      isDeleted: false,
    })
      .select({ frozenAt: 1 })
      .lean<{ frozenAt: Date | null }>()
      .exec();
    if (day !== null && day.frozenAt !== null) return true;

    await dayRecordService.computeDay(String(doc.employeeId), doc.workDate);
    return false;
  }

  private async notifySubmitted(
    subject: EmployeeDoc,
    doc: AttendanceRegularizationDoc,
  ): Promise<void> {
    const to =
      subject.employment.managerId !== null
        ? { userIds: [String(subject.employment.managerId)] }
        : ({ permission: 'attendance.decideRegularization', scope: 'organization' } as const);
    await notificationsService
      .notify({
        template: HrAttendanceTemplates.RegularizationSubmitted,
        to,
        data: { code: subject.code, workDate: dateOnlyIso(doc.workDate) },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  private async notifyDecided(
    subject: EmployeeDoc,
    doc: AttendanceRegularizationDoc,
  ): Promise<void> {
    if (subject.userId === null) return;
    if (doc.status !== 'approved' && doc.status !== 'rejected') return;
    await notificationsService
      .notify({
        template: HrAttendanceTemplates.RegularizationDecided,
        to: { userIds: [String(subject.userId)] },
        data: { workDate: dateOnlyIso(doc.workDate), status: doc.status },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }
}

export const regularizationService = new RegularizationService();
