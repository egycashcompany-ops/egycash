// The Leave Request engine (frozen design §3). Submission freezes the day count (R7) and
// reserves atomically through the balance gate (R1) with an insert-then-recheck for overlap
// and per-year caps (R2/C6). Approval is a relationship-or-permission decision on the CURRENT
// manager (R9/R9b), applied as a status-conditional update (R3), with synchronous catch-up
// transitions for late approvals and backdated leave (R4). Status drives NEVER roll the leave
// back (R5) — the absence is a fact, the employee status a projection.
import { Types } from 'mongoose';
import {
  HrLeaveEvents,
  HrLeaveSettingKeys,
  HrLeaveTemplates,
  LEAVE_PENDING_STATUSES,
  type CancelLeaveRequest,
  type CreateLeaveRequest,
  type DecideLeaveRequest,
  type LeaveEligibilityDto,
  type LeaveRuleViolationDto,
  type ListLeaveRequestsQuery,
  type Paginated,
  type ReturnLeaveRequest,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { logger } from '../../../../infrastructure/logging/logger';
import { notificationsService } from '../../../../platform/notifications';
import { settingsService } from '../../../../platform/settings';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { employeeActionRepository, employeeActionService } from '../../employee-management/employee-actions';
import { addDays, cairoToday, dateOnlyIso, leaveYearOf, toDateOnly } from '../../shared/business-date';
import { workCalendarService } from '../../work-calendar';
import { leaveTypeService, type LeaveTypeDoc } from '../leave-types';
import { leaveBalanceService, serviceMonthsOf, type YearPortion } from '../leave-balances';
import { resolveLeaveAttachmentsCategoryId } from './leave-request.files';
import { LeaveRequestModel, type LeaveRequestDoc, type LeaveRequestEntity } from './leave-request.model';
import { leaveRequestRepository } from './leave-request.repository';

const ORG_SUBJECT = { userId: null, branchId: null };
const requestRef = (id: string) => ({ moduleId: 'hr', entityType: 'leaveRequest', entityId: id });

/** Caller capabilities computed by the controller from effective permissions (R9). */
export interface LeaveCallerFlags {
  hasApprove: boolean;
  approveScope: ScopeSelector | null;
  canCancelApproved: boolean;
}

class LeaveRequestService {
  // ── Resolution helpers ────────────────────────────────────────────────────

  /** The caller's own employee record (self-service; C1-R single-target shape). */
  async ownEmployee(ctx: AuthContext): Promise<EmployeeDoc> {
    const employee = await employeeRepository.findByUserIdSystem(ctx.userId);
    if (employee === null) {
      throw new BusinessRuleError('your account is not linked to an employee record');
    }
    return employee;
  }

  private async isSubjectManager(employee: EmployeeDoc, userId: string): Promise<boolean> {
    const managerId = employee.employment.managerId;
    return Promise.resolve(managerId !== null && String(managerId) === userId);
  }

  /** Year slices of a span with their frozen day counts (§4 — Dec-31 splits). */
  private async yearPortions(
    type: LeaveTypeDoc,
    start: Date,
    end: Date,
    halfDayStart: boolean,
    halfDayEnd: boolean,
  ): Promise<YearPortion[]> {
    const portions: YearPortion[] = [];
    for (let year = leaveYearOf(start); year <= leaveYearOf(end); year += 1) {
      const from = year === leaveYearOf(start) ? start : new Date(Date.UTC(year, 0, 1));
      const to = year === leaveYearOf(end) ? end : new Date(Date.UTC(year, 11, 31));
      const days = await workCalendarService.countLeaveDays({
        from,
        to,
        countingMode: type.countingMode,
        halfDayStart: halfDayStart && from.getTime() === start.getTime(),
        halfDayEnd: halfDayEnd && to.getTime() === end.getTime(),
      });
      portions.push({ year, days, from, to });
    }
    return portions;
  }

  // ── Validation (shared by submit + the eligibility preflight) ─────────────

  private async validate(
    employee: EmployeeDoc,
    type: LeaveTypeDoc,
    span: { start: Date; end: Date; halfDayStart: boolean; halfDayEnd: boolean },
    days: number,
    excludeRequestId?: string,
  ): Promise<LeaveRuleViolationDto[]> {
    const v: LeaveRuleViolationDto[] = [];
    const today = cairoToday();
    const push = (rule: string, severity: 'hard' | 'soft', detail: string | null = null): void => {
      v.push({ rule, severity, detail });
    };

    if (employee.status === 'exited') push('employed', 'hard', 'employee has exited');
    if (employee.status === 'suspended') push('notSuspended', 'hard', 'employee is suspended');
    if (employee.status === 'probation' && !type.allowedDuringProbation) {
      push('probation', 'hard', 'not allowed during probation');
    }
    if (
      type.gender !== null &&
      employee.personal.gender !== null &&
      employee.personal.gender !== type.gender
    ) {
      push('gender', 'hard', `restricted to ${type.gender}`);
    }
    const acrossPeriods = await settingsService.resolve<boolean>(
      HrLeaveSettingKeys.ServiceAcrossPeriods,
      ORG_SUBJECT,
    );
    if (type.minServiceMonths > 0) {
      const months = serviceMonthsOf(employee, span.start, acrossPeriods);
      if (months < type.minServiceMonths) {
        push('minService', 'hard', `${String(type.minServiceMonths)} service months required`);
      }
    }
    if (type.maxPerService !== null) {
      const occasions = await leaveRequestRepository.countOccasions(
        String(employee._id),
        String(type._id),
      );
      if (occasions >= type.maxPerService) {
        push('maxPerService', 'hard', `allowed ${String(type.maxPerService)} time(s) per service`);
      }
    }
    if ((span.halfDayStart || span.halfDayEnd) && !type.allowHalfDay) {
      push('halfDay', 'hard', 'this type does not allow half-days');
    }
    if (span.start.getTime() < addDays(today, -type.backdateDays).getTime()) {
      push('backdate', 'hard', `may start at most ${String(type.backdateDays)} day(s) in the past`);
    }
    if (
      type.minNoticeDays > 0 &&
      span.start.getTime() < addDays(today, type.minNoticeDays).getTime() &&
      span.start.getTime() >= today.getTime()
    ) {
      push('notice', 'soft', `${String(type.minNoticeDays)} day(s) notice required`);
    }
    if (type.maxConsecutiveDays !== null && days > type.maxConsecutiveDays) {
      push('maxConsecutive', 'hard', `at most ${String(type.maxConsecutiveDays)} consecutive day(s)`);
    }
    if (type.maxPerOccasionDays !== null && days > type.maxPerOccasionDays) {
      push('maxPerOccasion', 'soft', `at most ${String(type.maxPerOccasionDays)} day(s) per occasion`);
    }
    if (type.maxPerYearDays !== null) {
      const used = await leaveBalanceService.usedOfTypeInYear(
        String(employee._id),
        String(type._id),
        leaveYearOf(span.start),
      );
      if (used + days > type.maxPerYearDays) {
        push('maxPerYear', 'hard', `at most ${String(type.maxPerYearDays)} day(s) per year`);
      }
    }
    // Pending-exit rule mirrored from the actions engine: no leave crossing a scheduled exit.
    const scheduledExit = await employeeActionRepository.findScheduledExit(String(employee._id));
    if (scheduledExit !== null && span.end.getTime() >= toDateOnly(scheduledExit.effectiveDate).getTime()) {
      push('pendingExit', 'hard', 'the span crosses a scheduled exit');
    }
    const overlapping = await leaveRequestRepository.findOverlapping(
      String(employee._id),
      span.start,
      span.end,
      excludeRequestId,
    );
    if (overlapping.length > 0) push('overlap', 'hard', 'overlaps an existing request');
    if (days <= 0) push('countableDays', 'hard', 'the span contains no countable days');

    // Balance visibility (the atomic gate decides authoritatively at reservation).
    const balanceTypeId = leaveTypeService.resolveBalanceTypeId(type);
    if (balanceTypeId !== null && days > 0) {
      const portions = await this.yearPortions(type, span.start, span.end, span.halfDayStart, span.halfDayEnd);
      for (const portion of portions) {
        const available = await leaveBalanceService.availableFor(
          String(employee._id),
          balanceTypeId,
          portion.year,
        );
        if (available - portion.days < -type.negativeCapDays) {
          push('balance', 'hard', `insufficient balance in ${String(portion.year)}`);
        }
      }
    }
    return v;
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async submit(
    ctx: AuthContext,
    input: CreateLeaveRequest,
    opts: { onBehalf: boolean },
  ): Promise<LeaveRequestDoc> {
    const employee =
      input.employeeId === undefined
        ? await this.ownEmployee(ctx)
        : await employeeRepository.findById(input.employeeId);
    if (employee === null) throw new NotFoundError('employee not found');
    if (input.employeeId !== undefined && !opts.onBehalf) {
      throw new ForbiddenError('filing for another employee requires leave.requestForOthers');
    }
    const type = await leaveTypeService.getActiveById(input.typeId);
    const start = toDateOnly(input.startDate);
    const end = toDateOnly(input.endDate);
    const portions = await this.yearPortions(type, start, end, input.halfDayStart, input.halfDayEnd);
    const days = portions.reduce((sum, p) => sum + p.days, 0);

    const violations = await this.validate(
      employee,
      type,
      { start, end, halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd },
      days,
    );
    const hard = violations.filter((x) => x.severity === 'hard');
    // L8: soft rules block self-service; HR on-behalf overrides them (never hard rules).
    const blocking = opts.onBehalf ? hard : violations;
    if (blocking.length > 0) {
      throw new BusinessRuleError(
        `leave request violates: ${blocking.map((x) => x.rule).join(', ')}`,
      );
    }

    const initialStatus = employee.employment.managerId !== null ? 'pendingManager' : 'pendingHr';
    const doc = await leaveRequestRepository.create(
      {
        employeeId: employee._id,
        employeeUserId: employee.userId,
        employeeCode: employee.code,
        employeeName: employee.personal.fullNameAr,
        branchId: employee.branchId ?? null,
        departmentId: employee.departmentId ?? null,
        sectionId: employee.sectionId ?? null,
        typeId: type._id,
        typeCode: type.code,
        status: initialStatus,
        startDate: start,
        endDate: end,
        halfDayStart: input.halfDayStart,
        halfDayEnd: input.halfDayEnd,
        days,
        reason: input.reason ?? null,
      },
      { by: ctx.userId },
    );

    // Atomic reservation (R1) — a stillborn request is hard-deleted, it never existed publicly.
    const balanceTypeId = leaveTypeService.resolveBalanceTypeId(type);
    try {
      await leaveBalanceService.reserveForRequest({
        employeeId: String(employee._id),
        typeId: String(type._id),
        balanceTypeId,
        negativeCapDays: type.negativeCapDays,
        portions,
        requestId: String(doc._id),
        by: ctx.userId,
      });
    } catch (error) {
      await LeaveRequestModel.deleteOne({ _id: doc._id }).exec();
      throw error;
    }

    // Post-insert recheck (R2/C6): deterministic loser self-rejects and releases.
    const conflicts = await leaveRequestRepository.findOverlapping(
      String(employee._id),
      start,
      end,
      String(doc._id),
    );
    const loser = conflicts.some((c) => String(c._id) < String(doc._id));
    if (loser) {
      await leaveBalanceService.releaseForRequest({
        employeeId: String(employee._id),
        typeId: String(type._id),
        balanceTypeId,
        portions,
        requestId: String(doc._id),
        by: ctx.userId,
        note: 'conflicting concurrent request',
      });
      await LeaveRequestModel.updateOne(
        { _id: doc._id },
        { $set: { status: 'rejected', cancelReason: 'conflicting concurrent request' } },
      ).exec();
      throw new ConflictError('a conflicting request was filed concurrently');
    }

    await auditService.record({
      entityRef: requestRef(String(doc._id)),
      action: 'leaveRequest',
      changes: [
        { field: 'type', old: null, new: type.code },
        { field: 'span', old: null, new: `${dateOnlyIso(start)}..${dateOnlyIso(end)} (${String(days)}d)` },
        { field: 'employee', old: null, new: employee.code },
      ],
    });
    await emit(HrLeaveEvents.Requested, {
      requestId: String(doc._id),
      employeeId: String(employee._id),
      code: employee.code,
      typeId: String(type._id),
      startDate: start,
      endDate: end,
    });
    await this.notifyPendingApprover(doc, employee);
    return doc;
  }

  private async notifyPendingApprover(doc: LeaveRequestDoc, employee: EmployeeDoc): Promise<void> {
    const data = {
      employeeCode: doc.employeeCode,
      typeCode: doc.typeCode,
      startDate: dateOnlyIso(doc.startDate),
      days: String(doc.days),
    };
    const to =
      doc.status === 'pendingManager' && employee.employment.managerId !== null
        ? { userIds: [String(employee.employment.managerId)] }
        : ({ permission: 'leave.approve', scope: 'organization' } as const);
    await notificationsService
      .notify({
        template: HrLeaveTemplates.RequestSubmitted,
        to,
        data,
        entityRef: requestRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  // ── Decide (R3/R4/R9) ─────────────────────────────────────────────────────

  async decide(
    ctx: AuthContext,
    id: string,
    verdict: 'approved' | 'rejected',
    input: DecideLeaveRequest,
    flags: LeaveCallerFlags,
  ): Promise<LeaveRequestDoc> {
    const request = await leaveRequestRepository.findRawById(id);
    if (request === null) throw new NotFoundError('leave request not found');
    if (!(LEAVE_PENDING_STATUSES as readonly string[]).includes(request.status)) {
      throw new BusinessRuleError('only a pending request can be decided');
    }
    if (input.version !== request.__v) {
      throw new ConflictError('the request was modified — reload and retry');
    }
    const employee = await employeeRepository.findById(String(request.employeeId));
    if (employee === null) throw new NotFoundError('employee not found');

    // C7 — the prohibition binds the SUBJECT: no one decides their own leave.
    if (employee.userId !== null && String(employee.userId) === ctx.userId) {
      throw new ForbiddenError('you cannot decide your own leave request');
    }
    const isManager = await this.isSubjectManager(employee, ctx.userId);
    const hasScopedApprove = await this.approveCoversEmployee(employee, flags);
    if (request.status === 'pendingManager' && !isManager && !hasScopedApprove) {
      throw new ForbiddenError('only the current manager or HR may decide this step');
    }
    if (request.status === 'pendingHr' && !hasScopedApprove) {
      throw new ForbiddenError('this step requires leave.approve');
    }

    const type = await leaveTypeService.getById(String(request.typeId));
    const nextStatus =
      verdict === 'rejected'
        ? 'rejected'
        : request.status === 'pendingManager' && type.approvalShape === 'managerThenHr'
          ? 'pendingHr'
          : 'approved';
    // The certificate gate: a requiresAttachment type never reaches APPROVED without one.
    if (nextStatus === 'approved' && type.requiresAttachment && request.attachments.length === 0) {
      throw new BusinessRuleError('an attachment is required before approval');
    }

    const step = request.status === 'pendingManager' ? 'manager' : 'hr';
    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: request._id, status: request.status, isDeleted: false },
      {
        $set: { status: nextStatus },
        $push: {
          approvals: {
            step,
            deciderUserId: new Types.ObjectId(ctx.userId),
            decision: verdict,
            comment: input.comment ?? null,
            at: new Date(),
          },
        },
        $inc: { __v: 1 },
      },
      { new: true },
    ).exec();
    if (updated === null) throw new ConflictError('the request was already decided');

    await auditService.record({
      entityRef: requestRef(id),
      action: 'leaveDecision',
      changes: [
        { field: 'step', old: null, new: step },
        { field: 'decision', old: null, new: verdict },
        { field: 'status', old: request.status, new: nextStatus },
      ],
    });
    await emit(HrLeaveEvents.Decided, {
      requestId: id,
      employeeId: String(request.employeeId),
      step,
      decision: verdict,
    });

    if (nextStatus === 'rejected') {
      await this.releaseAll(updated, type, ctx.userId, 'request rejected');
      await this.notifyEmployee(updated, employee, HrLeaveTemplates.RequestRejected);
      return updated;
    }
    if (nextStatus === 'pendingHr') {
      await this.notifyPendingApprover(updated, employee);
      return updated;
    }
    await this.notifyEmployee(updated, employee, HrLeaveTemplates.RequestApproved);
    // R4 — synchronous catch-up: late approvals and backdated spans transition immediately.
    const today = cairoToday();
    if (toDateOnly(updated.startDate).getTime() <= today.getTime()) {
      const activated = await this.activate(updated, ctx.userId);
      if (activated !== null && toDateOnly(updated.endDate).getTime() < today.getTime()) {
        await this.complete(activated, null);
      }
    }
    return (await leaveRequestRepository.findRawById(id)) ?? updated;
  }

  private async approveCoversEmployee(employee: EmployeeDoc, flags: LeaveCallerFlags): Promise<boolean> {
    if (!flags.hasApprove || flags.approveScope === null) return false;
    const covered = await employeeRepository.findById(String(employee._id), flags.approveScope);
    return covered !== null;
  }

  private async notifyEmployee(
    doc: LeaveRequestDoc,
    employee: EmployeeDoc,
    template: string,
  ): Promise<void> {
    if (employee.userId === null) return;
    await notificationsService
      .notify({
        template,
        to: { userIds: [String(employee.userId)] },
        data: {
          typeCode: doc.typeCode,
          startDate: dateOnlyIso(doc.startDate),
          days: String(doc.days),
        },
        entityRef: requestRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  // ── Lifecycle: activate / complete / early return (R4/R5) ─────────────────

  /** approved → active at the start date; drives `leaveStart` for status-affecting types. */
  private async activate(doc: LeaveRequestDoc, byUserId: string | null): Promise<LeaveRequestEntity | null> {
    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: doc._id, status: 'approved', isDeleted: false },
      { $set: { status: 'active' }, $inc: { __v: 1 } },
      { new: true },
    ).exec();
    if (updated === null) return null;

    const type = await leaveTypeService.getById(String(doc.typeId));
    const affects =
      type.affectsEmployeeStatus &&
      (type.statusThresholdDays === null || doc.days > type.statusThresholdDays);
    const today = cairoToday();
    const fullyPast = toDateOnly(doc.endDate).getTime() < today.getTime();
    let outcome: 'applied' | 'failed' | 'skipped' = 'skipped';
    if (affects && !fullyPast) {
      const actor = byUserId ?? this.lastApprover(updated) ?? String(updated.createdBy ?? doc.employeeId);
      try {
        await employeeActionService.driveLeaveAction(
          actor,
          String(doc.employeeId),
          'leaveStart',
          toDateOnly(doc.startDate),
          `leave ${doc.typeCode} (${String(doc._id)})`,
        );
        outcome = 'applied';
      } catch (error) {
        outcome = 'failed';
        logger.warn({ err: error, requestId: String(doc._id) }, 'leaveStart drive failed (R5)');
        await notificationsService
          .notify({
            template: HrLeaveTemplates.LongLeaveStarted,
            to: { permission: 'leave.approve', scope: 'organization' },
            data: {
              employeeCode: doc.employeeCode,
              typeCode: doc.typeCode,
              detail: 'status drive FAILED — employee status unchanged',
            },
            entityRef: requestRef(String(doc._id)),
          })
          .catch(() => undefined);
      }
    }
    updated.statusDriveOutcome = outcome;
    await updated.save();

    await emit(HrLeaveEvents.Started, this.spanPayload(updated));
    if (affects && outcome === 'applied') {
      await notificationsService
        .notify({
          template: HrLeaveTemplates.LongLeaveStarted,
          to: { permission: 'leave.approve', scope: 'organization' },
          data: { employeeCode: doc.employeeCode, typeCode: doc.typeCode, detail: 'started' },
          entityRef: requestRef(String(doc._id)),
        })
        .catch(() => undefined);
    }
    return updated;
  }

  private lastApprover(doc: LeaveRequestDoc): string | null {
    const last = doc.approvals[doc.approvals.length - 1];
    return last === undefined ? null : String(last.deciderUserId);
  }

  private spanPayload(doc: LeaveRequestDoc): Record<string, unknown> {
    return {
      requestId: String(doc._id),
      employeeId: String(doc.employeeId),
      code: doc.employeeCode,
      typeId: String(doc.typeId),
      startDate: doc.startDate,
      endDate: doc.endDate,
      halfDayStart: doc.halfDayStart,
      halfDayEnd: doc.halfDayEnd,
    };
  }

  /**
   * active → completed: reservation becomes dated consumption (+`paidBreakdown`, R7); an early
   * return consumes the truncated span and releases the remainder; `leaveEnd` drives the
   * status back when `leaveStart` had applied.
   */
  private async complete(doc: LeaveRequestEntity, actualReturnDate: Date | null): Promise<void> {
    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: doc._id, status: 'active', isDeleted: false },
      {
        $set: { status: 'completed', actualReturnDate },
        $inc: { __v: 1 },
      },
      { new: true },
    ).exec();
    if (updated === null) return;

    const type = await leaveTypeService.getById(String(doc.typeId));
    const balanceTypeId = leaveTypeService.resolveBalanceTypeId(type);
    const start = toDateOnly(doc.startDate);
    const end = toDateOnly(doc.endDate);
    const fullPortions = await this.yearPortions(type, start, end, doc.halfDayStart, doc.halfDayEnd);

    let consumedPortions = fullPortions;
    if (actualReturnDate !== null) {
      const lastLeaveDay = addDays(toDateOnly(actualReturnDate), -1);
      consumedPortions =
        lastLeaveDay.getTime() < start.getTime()
          ? []
          : await this.yearPortions(type, start, lastLeaveDay, doc.halfDayStart, false);
    }
    await leaveBalanceService.consumeForRequest({
      employeeId: String(doc.employeeId),
      type,
      balanceTypeId,
      portions: consumedPortions,
      requestId: String(doc._id),
      by: this.lastApprover(updated),
    });
    if (actualReturnDate !== null) {
      const releasePortions: YearPortion[] = fullPortions
        .map((full) => {
          const consumed = consumedPortions.find((c) => c.year === full.year);
          return { ...full, days: full.days - (consumed?.days ?? 0) };
        })
        .filter((p) => p.days > 0);
      await leaveBalanceService.releaseForRequest({
        employeeId: String(doc.employeeId),
        typeId: String(doc.typeId),
        balanceTypeId,
        portions: releasePortions,
        requestId: String(doc._id),
        by: this.lastApprover(updated),
        note: 'early return',
      });
    }

    if (updated.statusDriveOutcome === 'applied') {
      const returnDate = actualReturnDate ?? addDays(end, 1);
      const actor = this.lastApprover(updated) ?? String(updated.createdBy ?? doc.employeeId);
      try {
        await employeeActionService.driveLeaveAction(
          actor,
          String(doc.employeeId),
          'leaveEnd',
          toDateOnly(returnDate),
          `return from ${doc.typeCode} (${String(doc._id)})`,
        );
      } catch (error) {
        logger.warn({ err: error, requestId: String(doc._id) }, 'leaveEnd drive failed (R5)');
      }
    }
    await emit(HrLeaveEvents.Ended, this.spanPayload(updated));
  }

  async earlyReturn(
    ctx: AuthContext,
    id: string,
    input: ReturnLeaveRequest,
    flags: LeaveCallerFlags,
  ): Promise<LeaveRequestDoc> {
    const request = await leaveRequestRepository.findRawById(id);
    if (request === null) throw new NotFoundError('leave request not found');
    if (request.status !== 'active') {
      throw new BusinessRuleError('only an active leave can be returned from');
    }
    if (input.version !== request.__v) {
      throw new ConflictError('the request was modified — reload and retry');
    }
    const employee = await employeeRepository.findById(String(request.employeeId));
    if (employee === null) throw new NotFoundError('employee not found');
    const isManager = await this.isSubjectManager(employee, ctx.userId);
    if (!isManager && !(await this.approveCoversEmployee(employee, flags))) {
      throw new ForbiddenError('only the manager or HR records an early return');
    }
    const returnDate = toDateOnly(input.actualReturnDate);
    if (
      returnDate.getTime() <= toDateOnly(request.startDate).getTime() - 1 ||
      returnDate.getTime() > addDays(toDateOnly(request.endDate), 1).getTime()
    ) {
      throw new BusinessRuleError('the return date must fall within the leave span');
    }
    await this.complete(request, returnDate);
    await auditService.record({
      entityRef: requestRef(id),
      action: 'update',
      changes: [{ field: 'actualReturnDate', old: null, new: dateOnlyIso(returnDate) }],
    });
    const result = await leaveRequestRepository.findRawById(id);
    return result ?? request;
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancel(
    ctx: AuthContext,
    id: string,
    input: CancelLeaveRequest,
    flags: LeaveCallerFlags,
  ): Promise<LeaveRequestDoc> {
    const request = await leaveRequestRepository.findRawById(id);
    if (request === null) throw new NotFoundError('leave request not found');
    if (input.version !== request.__v) {
      throw new ConflictError('the request was modified — reload and retry');
    }
    const employee = await employeeRepository.findById(String(request.employeeId));
    if (employee === null) throw new NotFoundError('employee not found');

    const isRequester =
      (request.employeeUserId !== null && String(request.employeeUserId) === ctx.userId) ||
      (request.createdBy !== null && String(request.createdBy) === ctx.userId);
    const pending = (LEAVE_PENDING_STATUSES as readonly string[]).includes(request.status);
    if (pending) {
      if (!isRequester && !(await this.approveCoversEmployee(employee, flags))) {
        throw new ForbiddenError('only the requester or HR cancels a pending request');
      }
    } else if (request.status === 'approved') {
      const notStarted = toDateOnly(request.startDate).getTime() > cairoToday().getTime();
      if (!notStarted) {
        throw new BusinessRuleError('a started leave closes via early return, not cancellation');
      }
      const isManager = await this.isSubjectManager(employee, ctx.userId);
      if (!isManager && !flags.canCancelApproved) {
        throw new ForbiddenError('cancelling an approved request requires leave.cancelApproved');
      }
    } else {
      throw new BusinessRuleError('only pending or approved-not-started requests can be cancelled');
    }

    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: request._id, status: request.status, isDeleted: false },
      { $set: { status: 'cancelled', cancelReason: input.reason ?? null }, $inc: { __v: 1 } },
      { new: true },
    ).exec();
    if (updated === null) throw new ConflictError('the request changed — reload and retry');

    const type = await leaveTypeService.getById(String(request.typeId));
    await this.releaseAll(updated, type, ctx.userId, 'request cancelled');
    await auditService.record({
      entityRef: requestRef(id),
      action: 'leaveCancellation',
      changes: [
        { field: 'status', old: request.status, new: 'cancelled' },
        { field: 'reason', old: null, new: input.reason ?? null },
      ],
    });
    await emit(HrLeaveEvents.Cancelled, {
      requestId: id,
      employeeId: String(request.employeeId),
    });
    const managerId = employee.employment.managerId;
    await notificationsService
      .notify({
        template: HrLeaveTemplates.RequestCancelled,
        to:
          managerId !== null
            ? { userIds: [String(managerId)] }
            : ({ permission: 'leave.approve', scope: 'organization' } as const),
        data: { employeeCode: request.employeeCode, typeCode: request.typeCode },
        entityRef: requestRef(id),
      })
      .catch(() => undefined);
    return updated;
  }

  private async releaseAll(
    doc: LeaveRequestDoc,
    type: LeaveTypeDoc,
    byUserId: string | null,
    note: string,
  ): Promise<void> {
    const balanceTypeId = leaveTypeService.resolveBalanceTypeId(type);
    if (balanceTypeId === null) return;
    const portions = await this.yearPortions(
      type,
      toDateOnly(doc.startDate),
      toDateOnly(doc.endDate),
      doc.halfDayStart,
      doc.halfDayEnd,
    );
    await leaveBalanceService.releaseForRequest({
      employeeId: String(doc.employeeId),
      typeId: String(doc.typeId),
      balanceTypeId,
      portions,
      requestId: String(doc._id),
      by: byUserId,
      note,
    });
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async attach(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    flags: LeaveCallerFlags,
  ): Promise<LeaveRequestDoc> {
    const request = await leaveRequestRepository.findRawById(id);
    if (request === null) throw new NotFoundError('leave request not found');
    if (!(LEAVE_PENDING_STATUSES as readonly string[]).includes(request.status)) {
      throw new BusinessRuleError('attachments are added while the request is pending');
    }
    const employee = await employeeRepository.findById(String(request.employeeId));
    if (employee === null) throw new NotFoundError('employee not found');
    const isRequester =
      (request.employeeUserId !== null && String(request.employeeUserId) === ctx.userId) ||
      (request.createdBy !== null && String(request.createdBy) === ctx.userId);
    const isManager = await this.isSubjectManager(employee, ctx.userId);
    if (!isRequester && !isManager && !(await this.approveCoversEmployee(employee, flags))) {
      throw new ForbiddenError('only the requester, manager or HR attaches documents');
    }
    const categoryId = await resolveLeaveAttachmentsCategoryId();
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'leaveRequest',
        entityId: id,
        categoryId,
        displayName: binary.originalName,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
    request.attachments.push(file._id as Types.ObjectId);
    request.increment();
    await request.save();
    await auditService.record({
      entityRef: requestRef(id),
      action: 'update',
      changes: [{ field: 'attachments', old: null, new: String(file._id) }],
    });
    return request;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    query: ListLeaveRequestsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<LeaveRequestDoc>> {
    return leaveRequestRepository.listRequests(query, scope);
  }

  async getById(id: string, ctx: AuthContext, flags: LeaveCallerFlags, viewScope: ScopeSelector | null): Promise<LeaveRequestDoc> {
    const request = await leaveRequestRepository.findRawById(id);
    if (request === null) throw new NotFoundError('leave request not found');
    // Visibility matrix (R9): requester · current manager · leave.view within scope.
    const isRequester =
      (request.employeeUserId !== null && String(request.employeeUserId) === ctx.userId) ||
      (request.createdBy !== null && String(request.createdBy) === ctx.userId);
    if (isRequester) return request;
    const employee = await employeeRepository.findById(String(request.employeeId));
    if (employee !== null && (await this.isSubjectManager(employee, ctx.userId))) return request;
    if (viewScope !== null) {
      const visible = await leaveRequestRepository.findById(id, viewScope);
      if (visible !== null) return request;
    }
    if (await this.approveCoversEmployee(employee ?? ({ _id: request.employeeId } as EmployeeDoc), flags)) {
      return request;
    }
    throw new NotFoundError('leave request not found');
  }

  async pendingApprovals(ctx: AuthContext, flags: LeaveCallerFlags): Promise<LeaveRequestDoc[]> {
    const reports = await employeeRepository.findDirectReports(ctx.userId);
    const managerQueue = await leaveRequestRepository.findPendingManagerFor(
      reports.map((e) => String(e._id)),
    );
    const hrQueue =
      flags.hasApprove && flags.approveScope !== null
        ? await leaveRequestRepository.findPendingScoped(flags.approveScope)
        : [];
    const seen = new Set<string>();
    const merged: LeaveRequestDoc[] = [];
    for (const doc of [...managerQueue, ...hrQueue]) {
      const key = String(doc._id);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(doc);
      }
    }
    return merged.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async calendar(from: Date, to: Date, scope: ScopeSelector): Promise<LeaveRequestDoc[]> {
    return leaveRequestRepository.findSpansInRange(toDateOnly(from), toDateOnly(to), scope);
  }

  async eligibility(
    employee: EmployeeDoc,
    query: { typeId: string; start: Date; end: Date; halfDayStart: boolean; halfDayEnd: boolean },
  ): Promise<LeaveEligibilityDto> {
    const type = await leaveTypeService.getActiveById(query.typeId);
    const start = toDateOnly(query.start);
    const end = toDateOnly(query.end);
    const portions = await this.yearPortions(type, start, end, query.halfDayStart, query.halfDayEnd);
    const days = portions.reduce((sum, p) => sum + p.days, 0);
    const violations = await this.validate(
      employee,
      type,
      { start, end, halfDayStart: query.halfDayStart, halfDayEnd: query.halfDayEnd },
      days,
    );
    const balanceTypeId = leaveTypeService.resolveBalanceTypeId(type);
    let available: number | null = null;
    if (balanceTypeId !== null) {
      available = await leaveBalanceService.availableFor(
        String(employee._id),
        balanceTypeId,
        leaveYearOf(start),
      );
    }
    return {
      days,
      available,
      balanceAfter: available === null ? null : available - days,
      violations,
    };
  }

  // ── Event subscribers (§1.4, C1-R) ────────────────────────────────────────

  /** Exit settlement (R12): terminate open leave, release, expire balances. */
  async onEmployeeExited(employeeId: string): Promise<void> {
    const employee = await employeeRepository.findById(employeeId);
    const exitDate = employee?.exit?.effectiveDate ?? new Date();
    const open = await leaveRequestRepository.findOpenForEmployee(employeeId);
    for (const request of open) {
      const type = await leaveTypeService.getById(String(request.typeId));
      if (request.status === 'active') {
        const cutoff = toDateOnly(exitDate);
        await this.complete(
          request,
          cutoff.getTime() <= toDateOnly(request.endDate).getTime() ? cutoff : null,
        );
      } else {
        const updated = await LeaveRequestModel.findOneAndUpdate(
          { _id: request._id, status: request.status },
          { $set: { status: 'cancelled', cancelReason: 'employee exited' }, $inc: { __v: 1 } },
          { new: true },
        ).exec();
        if (updated !== null) await this.releaseAll(updated, type, null, 'employee exited');
      }
    }
    await leaveBalanceService.expireAllFor(employeeId, 'employee exited');
  }

  /** C1-R backfill: requests filed before the employee's login existed gain their owner. */
  async onLoginLinked(employeeId: string, userId: string): Promise<void> {
    await LeaveRequestModel.updateMany(
      { employeeId: new Types.ObjectId(employeeId), employeeUserId: null },
      { $set: { employeeUserId: new Types.ObjectId(userId) } },
    ).exec();
  }

  // ── Scheduler entries (§10) ───────────────────────────────────────────────

  async activateDueStarted(): Promise<number> {
    const due = await leaveRequestRepository.findDueToActivate(cairoToday());
    let count = 0;
    for (const request of due) {
      try {
        if ((await this.activate(request, null)) !== null) count += 1;
      } catch (error) {
        logger.warn({ err: error, requestId: String(request._id) }, 'leave activation failed');
      }
    }
    return count;
  }

  async completeDueEnded(): Promise<number> {
    const today = cairoToday();
    const due = await leaveRequestRepository.findDueToComplete(today);
    let count = 0;
    for (const request of due) {
      try {
        await this.complete(request, null);
        count += 1;
      } catch (error) {
        logger.warn({ err: error, requestId: String(request._id) }, 'leave completion failed');
      }
    }
    // Day-before return reminders: active leave ending today → the return is tomorrow.
    const endingToday = await LeaveRequestModel.find({
      status: 'active',
      endDate: today,
      isDeleted: false,
    })
      .lean<LeaveRequestDoc[]>()
      .exec();
    for (const request of endingToday) {
      const employee = await employeeRepository.findById(String(request.employeeId));
      const managerId = employee?.employment.managerId ?? null;
      await notificationsService
        .notify({
          template: HrLeaveTemplates.ReturnDue,
          to:
            managerId !== null
              ? { userIds: [String(managerId)] }
              : ({ permission: 'leave.approve', scope: 'organization' } as const),
          data: { employeeCode: request.employeeCode, typeCode: request.typeCode },
          entityRef: requestRef(String(request._id)),
        })
        .catch(() => undefined);
    }
    return count;
  }

  async remindPendingApprovals(): Promise<number> {
    const days = await settingsService.resolve<number>(
      HrLeaveSettingKeys.ApprovalReminderDays,
      ORG_SUBJECT,
    );
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const stale = await leaveRequestRepository.findPendingSince(cutoff);
    for (const request of stale) {
      const employee = await employeeRepository.findById(String(request.employeeId));
      const managerId = employee?.employment.managerId ?? null;
      const to =
        request.status === 'pendingManager' && managerId !== null
          ? { userIds: [String(managerId)] }
          : ({ permission: 'leave.approve', scope: 'organization' } as const);
      await notificationsService
        .notify({
          template: HrLeaveTemplates.ApprovalReminder,
          to,
          data: {
            employeeCode: request.employeeCode,
            typeCode: request.typeCode,
            days: String(request.days),
          },
          entityRef: requestRef(String(request._id)),
        })
        .catch(() => undefined);
    }
    return stale.length;
  }
}

export const leaveRequestService = new LeaveRequestService();
