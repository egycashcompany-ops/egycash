// The Personnel Actions engine (frozen design §3) — the ONLY writer of employment facts.
// Each action: allocate the per-employee seq (atomic $inc), persist the action, then either
// apply it now (effective date now/past) or leave it `scheduled` for the scheduler task, which
// applies due actions strictly in effective-date order. Application captures the authoritative
// `from` values (C1), mutates the employee snapshot, and PROPAGATES to every dependent record
// (F1): branch transfers recompute the employee code and update the linked user's placement and
// the Employee File's code/branch; exits auto-suspend the login (D3), settle direct reports and
// close the employment period; rehires reopen a period on the SAME employee number.
// Self-actions are rejected outright (I1). Cancels are append-only status flips.
import { Types } from 'mongoose';
import {
  HrEmployeeEvents,
  HrEmployeeTemplates,
  canTransitionEmployeeStatus,
  employeeBaseStatus,
  EMPLOYEE_EXIT_TYPES,
  type CancelEmployeeAction,
  type ChangeEmployeeStatus,
  type CompensationAction,
  type EmployeeExitType,
  type EmploymentAction,
  type ExitAction,
  type ListEmployeeActionsQuery,
  type Paginated,
  type RehireAction,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import {
  branchService,
  departmentService,
  jobTitleService,
  sectionService,
} from '../../../../platform/organization';
import { userService } from '../../../../platform/users';
import { jobOfferService } from '../../recruitment/job-offers';
import { employeeFileService } from '../employee-file';
import {
  buildEmployeeCode,
  employeeRepository,
  type EmployeeDoc,
  type EmploymentDetails,
} from '../employees';
import { employeeActionRepository } from './employee-action.repository';
import {
  EmployeeActionModel,
  type EmployeeActionChange,
  type EmployeeActionDoc,
  type EmployeeActionEntity,
} from './employee-action.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });

type AnyAction = EmploymentAction | CompensationAction | ExitAction | RehireAction;

const isExitType = (t: string): t is EmployeeExitType =>
  (EMPLOYEE_EXIT_TYPES as readonly string[]).includes(t);

class EmployeeActionService {
  // ── Entry points (one per permission-grouped route) ───────────────────────

  async createEmploymentAction(
    ctx: AuthContext,
    employeeId: string,
    input: EmploymentAction,
    scope: ScopeSelector,
    opts: { canManageCompensation: boolean },
  ): Promise<EmployeeActionDoc> {
    if (input.type === 'promotion' && input.salary !== undefined && !opts.canManageCompensation) {
      throw new ForbiddenError('changing the salary requires the compensation permission');
    }
    if (
      input.type === 'transfer' &&
      input.branchId === undefined &&
      input.departmentId === undefined &&
      input.sectionId === undefined &&
      input.managerId === undefined
    ) {
      throw new BusinessRuleError('a transfer must change at least one placement field');
    }
    return this.createAction(ctx, employeeId, input, scope);
  }

  async createCompensationAction(
    ctx: AuthContext,
    employeeId: string,
    input: CompensationAction,
    scope: ScopeSelector,
  ): Promise<EmployeeActionDoc> {
    return this.createAction(ctx, employeeId, input, scope);
  }

  async createExitAction(
    ctx: AuthContext,
    employeeId: string,
    input: ExitAction,
    scope: ScopeSelector,
  ): Promise<EmployeeActionDoc> {
    return this.createAction(ctx, employeeId, input, scope);
  }

  async createRehireAction(
    ctx: AuthContext,
    employeeId: string,
    input: RehireAction,
    scope: ScopeSelector,
    opts: { canOverrideRehire: boolean },
  ): Promise<EmployeeActionDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    if (employee.status !== 'exited' || employee.exit == null) {
      throw new BusinessRuleError('only an exited employee can be rehired');
    }
    // D2 — an exit recorded as not-rehirable needs the dedicated override permission.
    if (!employee.exit.eligibleForRehire && !opts.canOverrideRehire) {
      throw new ForbiddenError('this employee was marked not eligible for rehire');
    }
    return this.createAction(ctx, employeeId, input, scope);
  }

  // ── Shared create path ─────────────────────────────────────────────────────

  private async createAction(
    ctx: AuthContext,
    employeeId: string,
    input: AnyAction,
    scope: ScopeSelector,
  ): Promise<EmployeeActionDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);

    // Self-action rejection (I1) — no HR user ever applies a personnel action to themselves.
    if (employee.userId !== null && String(employee.userId) === ctx.userId) {
      throw new BusinessRuleError('you cannot apply a personnel action to your own employee record');
    }
    if (input.version !== employee.__v) {
      throw new ConflictError('the employee was modified — reload and retry');
    }
    // A closed record accepts nothing but a rehire.
    if (employee.status === 'exited' && input.type !== 'rehire') {
      throw new BusinessRuleError('this employee has exited — only a rehire is possible');
    }
    if (employee.status !== 'exited' && input.type === 'rehire') {
      throw new BusinessRuleError('only an exited employee can be rehired');
    }

    const now = new Date();
    const effectiveDate = input.effectiveDate ?? now;
    const scheduled = effectiveDate.getTime() > now.getTime();

    // Pending-exit rule: while an exit is scheduled, refuse actions effective on/after it.
    const pendingExit = await employeeActionRepository.findScheduledExit(employeeId);
    if (pendingExit !== null && input.type !== 'rehire') {
      if (effectiveDate.getTime() >= pendingExit.effectiveDate.getTime()) {
        throw new BusinessRuleError(
          'an exit is already scheduled on or before this date — cancel it first',
        );
      }
    }

    // Fail fast on state that can never become valid (still re-validated at application time).
    this.assertCreatable(employee, input);

    // Allocate the per-employee sequence atomically — the total order of the history.
    const seq = await employeeRepository.allocateActionSeq(String(employee._id));
    if (seq === null) throw new ConflictError('employee vanished during action allocation');

    const raw = { ...(input as Record<string, unknown>) };
    delete raw['version'];
    delete raw['effectiveDate'];
    const note = typeof raw['note'] === 'string' ? raw['note'] : undefined;
    delete raw['note'];
    const payload = raw;
    const reason = typeof (input as { reason?: unknown }).reason === 'string' ? (input as { reason: string }).reason : null;

    const action = await EmployeeActionModel.create({
      employeeId: employee._id,
      employeeCode: employee.code,
      seq,
      type: input.type,
      status: 'scheduled',
      effectiveDate,
      appliedAt: null,
      changes: [],
      payload,
      reason,
      note: note ?? null,
      attachmentFileId: null,
      failureReason: null,
      cancelledAt: null,
      cancelledBy: null,
      by: new Types.ObjectId(ctx.userId),
      createdBy: new Types.ObjectId(ctx.userId),
      updatedBy: null,
      isDeleted: false,
    });

    await auditService.record({
      entityRef: entityRef(employeeId),
      action: 'personnelAction',
      changes: [
        { field: 'type', old: null, new: input.type },
        { field: 'effectiveDate', old: null, new: effectiveDate.toISOString() },
        { field: 'scheduled', old: null, new: String(scheduled) },
      ],
    });

    if (!scheduled) {
      await this.apply(action, { rethrow: true });
    }
    return (await EmployeeActionModel.findById(action._id)) ?? action;
  }

  /** Pre-flight checks at CREATE time (cheap, obvious rejections; apply re-validates). */
  private assertCreatable(employee: EmployeeDoc, input: AnyAction): void {
    switch (input.type) {
      case 'probationConfirm':
      case 'probationExtend':
      case 'probationFail': {
        if (employee.status !== 'probation' || employee.probation == null) {
          throw new BusinessRuleError('the employee is not in probation');
        }
        if (employee.probation.confirmedAt !== null) {
          throw new BusinessRuleError('probation was already confirmed');
        }
        return;
      }
      case 'suspend': {
        if (!canTransitionEmployeeStatus(employee.status, 'suspended')) {
          throw new BusinessRuleError(`cannot suspend an employee who is ${employee.status}`);
        }
        return;
      }
      case 'reinstate': {
        if (employee.status !== 'suspended') {
          throw new BusinessRuleError('only a suspended employee can be reinstated');
        }
        return;
      }
      case 'leaveStart': {
        if (!canTransitionEmployeeStatus(employee.status, 'onLeave')) {
          throw new BusinessRuleError(`cannot start leave for an employee who is ${employee.status}`);
        }
        return;
      }
      case 'leaveEnd': {
        if (employee.status !== 'onLeave') {
          throw new BusinessRuleError('the employee is not on leave');
        }
        return;
      }
      default:
        return;
    }
  }

  // ── Application (immediate or by the scheduler) ───────────────────────────

  /**
   * Apply one action: capture `from` values, mutate the snapshot, propagate, audit, emit.
   * With `rethrow` (immediate path) validation errors surface to the caller; the scheduler
   * path records them as `failed` + notifies instead (F3 — never silently applied).
   */
  private async apply(action: EmployeeActionEntity, opts: { rethrow: boolean }): Promise<void> {
    const employee = await employeeRepository.findRawById(String(action.employeeId));
    if (employee === null) {
      await this.markFailed(action, 'employee no longer exists');
      if (opts.rethrow) throw new BusinessRuleError('employee no longer exists');
      return;
    }
    try {
      const changes = await this.applyToEmployee(action, employee);
      action.status = 'applied';
      action.appliedAt = new Date();
      action.changes = changes;
      await action.save();

      await auditService.record({
        entityRef: entityRef(String(employee._id)),
        action: 'personnelAction',
        changes: [
          { field: 'actionType', old: null, new: action.type },
          ...changes.map((c) => ({
            field: c.field,
            old: c.from === null ? null : JSON.stringify(c.from),
            new: c.to === null ? null : JSON.stringify(c.to),
          })),
        ],
      });
      await emit(HrEmployeeEvents.EmployeeActionApplied, {
        employeeId: String(employee._id),
        actionId: String(action._id),
        code: employee.code,
        type: action.type,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'action application failed';
      await this.markFailed(action, message);
      if (opts.rethrow) throw err;
      await this.notifyScheduledOutcome(action, HrEmployeeTemplates.ScheduledActionFailed, message);
    }
  }

  private async markFailed(action: EmployeeActionEntity, reason: string): Promise<void> {
    action.status = 'failed';
    action.failureReason = reason;
    await action.save();
  }

  /** The per-type mutation. Returns the change set with application-time `from` values (C1). */
  private async applyToEmployee(
    action: EmployeeActionDoc,
    employee: EmployeeDoc & { save: () => Promise<unknown> },
  ): Promise<EmployeeActionChange[]> {
    const p = action.payload as Record<string, unknown>;
    const changes: EmployeeActionChange[] = [];
    // The acting user drives downstream writes (user updates are ObjectId-attributed). `by` is
    // null only on migration-synthesized (already-applied) actions, which never reach here.
    const actorId = action.by === null ? String(employee._id) : String(action.by);
    const statusChange = async (to: 'probation' | 'active' | 'onLeave' | 'suspended' | 'exited'): Promise<void> => {
      const from = employee.status;
      if (from !== to && !canTransitionEmployeeStatus(from, to)) {
        throw new BusinessRuleError(`cannot change employee status from ${from} to ${to}`);
      }
      changes.push({ field: 'status', from, to });
      employee.status = to;
      await emit(HrEmployeeEvents.EmployeeStatusChanged, {
        employeeId: String(employee._id),
        code: employee.code,
        from,
        to,
      });
    };

    switch (action.type) {
      case 'promotion': {
        const jobTitleId = String(p['jobTitleId']);
        const title = await jobTitleService.getById(jobTitleId);
        if (title.status !== 'active') {
          throw new BusinessRuleError('the target job title is not active');
        }
        changes.push({ field: 'employment.jobTitleId', from: String(employee.employment.jobTitleId), to: jobTitleId });
        employee.employment.jobTitleId = new Types.ObjectId(jobTitleId);
        const salary = p['salary'] as { amount: number; currency: string } | null | undefined;
        if (salary !== undefined) {
          changes.push({ field: 'employment.salary', from: employee.employment.salary, to: salary ?? null });
          employee.employment.salary = salary ?? null;
        }
        break;
      }
      case 'transfer': {
        await this.applyTransfer(employee, p, changes, actorId);
        break;
      }
      case 'managerChange': {
        const managerId = p['managerId'] as string | null;
        changes.push({
          field: 'employment.managerId',
          from: employee.employment.managerId === null ? null : String(employee.employment.managerId),
          to: managerId,
        });
        employee.employment.managerId = managerId === null ? null : new Types.ObjectId(managerId);
        break;
      }
      case 'salaryChange': {
        const salary = p['salary'] as { amount: number; currency: string } | null | undefined;
        const allowances = p['allowances'] as { name: string; amount: number; currency: string }[] | undefined;
        const benefits = p['benefits'] as string[] | undefined;
        if (salary !== undefined) {
          changes.push({ field: 'employment.salary', from: employee.employment.salary, to: salary ?? null });
          employee.employment.salary = salary ?? null;
        }
        if (allowances !== undefined) {
          changes.push({ field: 'employment.allowances', from: employee.employment.allowances, to: allowances });
          employee.employment.allowances = allowances;
        }
        if (benefits !== undefined) {
          changes.push({ field: 'employment.benefits', from: [...employee.employment.benefits], to: benefits });
          employee.employment.benefits = benefits;
        }
        break;
      }
      case 'probationConfirm': {
        if (employee.status !== 'probation' || employee.probation == null || employee.probation.confirmedAt !== null) {
          throw new BusinessRuleError('the employee is not in an unconfirmed probation');
        }
        employee.probation.confirmedAt = new Date();
        employee.probation.confirmedBy = action.by;
        changes.push({ field: 'probation.confirmed', from: false, to: true });
        await statusChange('active');
        break;
      }
      case 'probationExtend': {
        if (employee.status !== 'probation' || employee.probation == null || employee.probation.confirmedAt !== null) {
          throw new BusinessRuleError('the employee is not in an unconfirmed probation');
        }
        const newEnd = new Date(String(p['newEndDate']));
        changes.push({
          field: 'probation.extendedTo',
          from: employee.probation.extendedTo?.toISOString() ?? null,
          to: newEnd.toISOString(),
        });
        employee.probation.extendedTo = newEnd;
        break;
      }
      case 'probationFail': {
        if (employee.status !== 'probation' || employee.probation == null || employee.probation.confirmedAt !== null) {
          throw new BusinessRuleError('the employee is not in an unconfirmed probation');
        }
        // A probationary manager's reports must be settled by a full exit action instead.
        await this.assertNoDirectReports(employee);
        employee.probation.failed = true;
        changes.push({ field: 'probation.failed', from: false, to: true });
        await this.applyExit(employee, {
          type: 'termination',
          reason: typeof p['reason'] === 'string' ? p['reason'] : 'probation failed',
          eligibleForRehire: p['eligibleForRehire'] === true,
          effectiveDate: action.effectiveDate,
          by: action.by,
          directReports: undefined,
          changes,
          statusChange,
        }, actorId);
        break;
      }
      case 'suspend': {
        await statusChange('suspended');
        if (p['disableLogin'] !== false && employee.userId !== null) {
          await this.suspendLogin(String(employee.userId), changes, actorId);
        }
        break;
      }
      case 'reinstate': {
        await statusChange(employeeBaseStatus(employee.probation));
        if (p['enableLogin'] !== false && employee.userId !== null) {
          await this.reactivateLogin(String(employee.userId), changes, actorId);
        }
        break;
      }
      case 'leaveStart': {
        await statusChange('onLeave');
        break;
      }
      case 'leaveEnd': {
        await statusChange(employeeBaseStatus(employee.probation));
        break;
      }
      case 'resignation':
      case 'termination':
      case 'endOfContract':
      case 'retirement':
      case 'death': {
        if (!isExitType(action.type)) throw new BusinessRuleError('unknown exit type');
        await this.applyExit(employee, {
          type: action.type,
          reason: typeof p['reason'] === 'string' ? p['reason'] : null,
          eligibleForRehire: p['eligibleForRehire'] === true,
          effectiveDate: action.effectiveDate,
          by: action.by,
          directReports: p['directReports'] as
            | { reassignToEmployeeId: string }
            | { leaveUnassigned: true }
            | undefined,
          changes,
          statusChange,
        }, actorId);
        break;
      }
      case 'rehire': {
        await this.applyRehire(employee, p, action, changes, statusChange, actorId);
        break;
      }
      case 'dataCorrection': {
        const newHiredAt = new Date(String(p['hiringDate']));
        changes.push({ field: 'hiredAt', from: employee.hiredAt.toISOString(), to: newHiredAt.toISOString() });
        employee.hiredAt = newHiredAt;
        const first = employee.employmentPeriods[0];
        if (first !== undefined) first.hiredAt = newHiredAt;
        break;
      }
      default:
        throw new BusinessRuleError(`unsupported action type: ${action.type as string}`);
    }

    await employee.save();
    return changes;
  }

  // ── Transfer (F1 propagation: code prefix, user placement, employee file) ──

  private async applyTransfer(
    employee: EmployeeDoc & { save: () => Promise<unknown> },
    p: Record<string, unknown>,
    changes: EmployeeActionChange[],
    actorId: string,
  ): Promise<void> {
    const newBranchId = p['branchId'] === undefined ? String(employee.branchId) : String(p['branchId']);
    const newDepartmentId =
      p['departmentId'] === undefined ? String(employee.departmentId) : String(p['departmentId']);
    let newSectionId: string | null;
    if (p['sectionId'] === undefined) {
      // Section must stay coherent: keep it only when the department is unchanged.
      newSectionId =
        newDepartmentId === String(employee.departmentId) && employee.sectionId !== null
          ? String(employee.sectionId)
          : null;
    } else {
      newSectionId = p['sectionId'] === null ? null : String(p['sectionId']);
    }

    // Application-time org validation (F3): referents must exist, be active, and cohere.
    const department = await departmentService.getById(newDepartmentId);
    if (String(department.branchId) !== newBranchId) {
      throw new BusinessRuleError('the department does not belong to the target branch');
    }
    if (newSectionId !== null) {
      const section = await sectionService.getById(newSectionId);
      if (String(section.departmentId) !== newDepartmentId) {
        throw new BusinessRuleError('the section does not belong to the target department');
      }
    }

    const branchChanged = newBranchId !== String(employee.branchId);
    const oldCode = employee.code;

    if (branchChanged) {
      const branch = await branchService.getById(newBranchId);
      const newCode = buildEmployeeCode(branch.code, employee.employeeNumber);
      changes.push({ field: 'code', from: oldCode, to: newCode });
      employee.code = newCode;
    }
    if (newBranchId !== String(employee.branchId)) {
      changes.push({ field: 'branchId', from: String(employee.branchId), to: newBranchId });
    }
    if (newDepartmentId !== String(employee.departmentId)) {
      changes.push({ field: 'departmentId', from: String(employee.departmentId), to: newDepartmentId });
    }
    const oldSection = employee.sectionId === null ? null : String(employee.sectionId);
    if (newSectionId !== oldSection) {
      changes.push({ field: 'sectionId', from: oldSection, to: newSectionId });
    }

    employee.branchId = new Types.ObjectId(newBranchId);
    employee.departmentId = new Types.ObjectId(newDepartmentId);
    employee.sectionId = newSectionId === null ? null : new Types.ObjectId(newSectionId);
    employee.employment.branchId = employee.branchId;
    employee.employment.departmentId = employee.departmentId;
    employee.employment.sectionId = employee.sectionId;

    if (p['managerId'] !== undefined) {
      const managerId = p['managerId'] as string | null;
      changes.push({
        field: 'employment.managerId',
        from: employee.employment.managerId === null ? null : String(employee.employment.managerId),
        to: managerId,
      });
      employee.employment.managerId = managerId === null ? null : new Types.ObjectId(managerId);
    }

    // F1 propagation — the linked user's placement drives data-scope authorization (ADR-017).
    if (employee.userId !== null) {
      const user = await userService.getById(String(employee.userId));
      await userService.update(
        String(employee.userId),
        {
          organization: {
            branchId: newBranchId,
            departmentId: newDepartmentId,
            sectionId: newSectionId,
          },
          version: user.__v,
        },
        actorId,
      );
      changes.push({ field: 'user.placement', from: 'previous', to: 'synced' });
    }
    // F1 propagation — the Employee File denormalizes code + branch for scoping.
    await employeeFileService.syncEmployeeIdentity(String(employee._id), employee.code, newBranchId);

    if (branchChanged) {
      await emit(HrEmployeeEvents.EmployeeTransferred, {
        employeeId: String(employee._id),
        oldCode,
        newCode: employee.code,
        branchId: newBranchId,
      });
    }
  }

  // ── Exit (D3 auto-suspend, direct reports, period close) ──────────────────

  private async directReportsOf(employee: EmployeeDoc): Promise<EmployeeDoc[]> {
    if (employee.userId === null) return [];
    return employeeRepository.findDirectReports(String(employee.userId));
  }

  private async assertNoDirectReports(employee: EmployeeDoc): Promise<void> {
    const reports = await this.directReportsOf(employee);
    if (reports.length > 0) {
      throw new BusinessRuleError(
        'this employee manages others — record the exit through the exit action so their reports can be reassigned',
      );
    }
  }

  private async applyExit(
    employee: EmployeeDoc & { save: () => Promise<unknown> },
    exit: {
      type: EmployeeExitType;
      reason: string | null;
      eligibleForRehire: boolean;
      effectiveDate: Date;
      by: Types.ObjectId | null;
      directReports: { reassignToEmployeeId: string } | { leaveUnassigned: true } | undefined;
      changes: EmployeeActionChange[];
      statusChange: (to: 'exited') => Promise<void>;
    },
    actorId: string,
  ): Promise<void> {
    // Direct reports must be explicitly settled (F1) — reassigned or knowingly left unassigned.
    const reports = await this.directReportsOf(employee);
    if (reports.length > 0) {
      if (exit.directReports === undefined) {
        throw new BusinessRuleError(
          `this employee has ${String(reports.length)} direct report(s) — decide their reassignment`,
        );
      }
      if ('reassignToEmployeeId' in exit.directReports) {
        const target = await employeeRepository.findRawById(exit.directReports.reassignToEmployeeId);
        if (target === null || target.userId === null) {
          throw new BusinessRuleError('the reassignment target must be an employee with a login account');
        }
        if (String(target._id) === String(employee._id)) {
          throw new BusinessRuleError('cannot reassign reports to the exiting employee');
        }
        await employeeRepository.reassignDirectReports(String(employee.userId), String(target.userId));
        exit.changes.push({
          field: 'directReports',
          from: `managerId:${String(employee.userId)}`,
          to: `reassigned:${String(target.userId)} (${String(reports.length)})`,
        });
      } else {
        await employeeRepository.reassignDirectReports(String(employee.userId), null);
        exit.changes.push({
          field: 'directReports',
          from: `managerId:${String(employee.userId)}`,
          to: `unassigned (${String(reports.length)})`,
        });
      }
    }

    await exit.statusChange('exited');
    employee.exit = {
      type: exit.type,
      reason: exit.reason,
      effectiveDate: exit.effectiveDate,
      eligibleForRehire: exit.eligibleForRehire,
      by: exit.by,
    };
    exit.changes.push({ field: 'exit.type', from: null, to: exit.type });
    exit.changes.push({ field: 'exit.eligibleForRehire', from: null, to: exit.eligibleForRehire });

    // Close the open employment period (derived index — frozen design §5).
    const open = employee.employmentPeriods.find((per) => per.exitedAt === null);
    if (open !== undefined) {
      open.exitedAt = exit.effectiveDate;
      open.exitType = exit.type;
    }

    // D3 — the linked login is AUTOMATICALLY suspended on exit.
    if (employee.userId !== null) {
      await this.suspendLogin(String(employee.userId), exit.changes, actorId);
    }

    await emit(HrEmployeeEvents.EmployeeExited, {
      employeeId: String(employee._id),
      code: employee.code,
      exitType: exit.type,
    });
    await notificationsService
      .notify({
        template: HrEmployeeTemplates.Exited,
        to: { permission: 'employee.view', scope: 'organization' },
        data: { employeeCode: employee.code, exitType: exit.type },
        entityRef: entityRef(String(employee._id)),
      })
      .catch(() => undefined);
  }

  // ── Rehire (same number, same file — a NEW employment period) ─────────────

  private async applyRehire(
    employee: EmployeeDoc & { save: () => Promise<unknown> },
    p: Record<string, unknown>,
    action: EmployeeActionDoc,
    changes: EmployeeActionChange[],
    statusChange: (to: 'probation' | 'active') => Promise<void>,
    actorId: string,
  ): Promise<void> {
    if (employee.status !== 'exited') {
      throw new BusinessRuleError('only an exited employee can be rehired');
    }

    let employment: EmploymentDetails;
    if (typeof p['jobOfferId'] === 'string') {
      const offer = await jobOfferService.acceptedOfferById(p['jobOfferId']);
      if (offer === null || offer.acceptedSnapshot === null) {
        throw new BusinessRuleError('rehire requires an accepted job offer');
      }
      const t = offer.acceptedSnapshot.terms;
      employment = {
        jobTitleId: t.jobTitleId,
        departmentId: t.departmentId,
        sectionId: null,
        branchId: t.branchId,
        jobPositionId: null,
        managerId: t.managerId,
        employmentType: t.employmentType,
        salary: t.salary === null ? null : { amount: t.salary.amount, currency: t.salary.currency },
        allowances: t.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
        benefits: [...t.benefits],
        probationMonths: t.probationMonths,
        startDate: t.startDate,
      };
      // Link the new recruitment cycle on the SAME employee record.
      changes.push({ field: 'jobOfferId', from: employee.jobOfferId === null ? null : String(employee.jobOfferId), to: String(offer._id) });
      employee.jobOfferId = offer._id;
      employee.offerCode = offer.code;
      employee.applicantId = offer.applicantId;
      employee.applicantCode = offer.applicantCode;
      employee.acceptedOfferRevision = offer.acceptedSnapshot.revisionNumber;
    } else {
      const terms = p['terms'] as {
        jobTitleId: string;
        departmentId: string;
        sectionId?: string | null;
        branchId: string;
        managerId?: string | null;
        employmentType: EmploymentDetails['employmentType'];
        salary?: { amount: number; currency: string } | null;
        allowances?: { name: string; amount: number; currency: string }[];
        benefits?: string[];
        probationMonths: number;
        startDate: string | Date;
      };
      employment = {
        jobTitleId: new Types.ObjectId(terms.jobTitleId),
        departmentId: new Types.ObjectId(terms.departmentId),
        sectionId: terms.sectionId == null ? null : new Types.ObjectId(terms.sectionId),
        branchId: new Types.ObjectId(terms.branchId),
        jobPositionId: null,
        managerId: terms.managerId == null ? null : new Types.ObjectId(terms.managerId),
        employmentType: terms.employmentType,
        salary: terms.salary == null ? null : { amount: terms.salary.amount, currency: terms.salary.currency },
        allowances: (terms.allowances ?? []).map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
        benefits: [...(terms.benefits ?? [])],
        probationMonths: terms.probationMonths,
        startDate: new Date(terms.startDate),
      };
    }

    // Application-time org validation (F3) + branch coherence.
    const department = await departmentService.getById(String(employment.departmentId));
    if (String(department.branchId) !== String(employment.branchId)) {
      throw new BusinessRuleError('the department does not belong to the target branch');
    }
    const title = await jobTitleService.getById(String(employment.jobTitleId));
    if (title.status !== 'active') {
      throw new BusinessRuleError('the target job title is not active');
    }

    const hiredAt = p['hiringDate'] == null ? new Date() : new Date(String(p['hiringDate']));
    const branch = await branchService.getById(String(employment.branchId));
    const newCode = buildEmployeeCode(branch.code, employee.employeeNumber);
    if (newCode !== employee.code) {
      changes.push({ field: 'code', from: employee.code, to: newCode });
      employee.code = newCode;
    }

    changes.push({ field: 'employment.jobTitleId', from: null, to: String(employment.jobTitleId) });
    employee.employment = employment;
    employee.branchId = employment.branchId;
    employee.departmentId = employment.departmentId;
    employee.sectionId = employment.sectionId;
    employee.hiredAt = hiredAt;
    changes.push({ field: 'hiredAt', from: null, to: hiredAt.toISOString() });

    // Reset the lifecycle: probation-first (D1; 0 months ⇒ straight to active).
    employee.exit = null;
    if (employment.probationMonths > 0) {
      const endDate = new Date(hiredAt);
      endDate.setMonth(endDate.getMonth() + employment.probationMonths);
      employee.probation = { endDate, confirmedAt: null, confirmedBy: null, extendedTo: null, failed: false };
      await statusChange('probation');
    } else {
      employee.probation = { endDate: null, confirmedAt: new Date(), confirmedBy: action.by, extendedTo: null, failed: false };
      await statusChange('active');
    }

    // A NEW employment period on the SAME employee number (frozen design §2).
    employee.employmentPeriods.push({ hiredAt, exitedAt: null, exitType: null });

    // Optionally bring the previous login back to life.
    if (p['reactivateLogin'] === true && employee.userId !== null) {
      await this.reactivateLogin(String(employee.userId), changes, actorId);
    }
    // F1 propagation — file + user placement follow the new placement.
    await employeeFileService.syncEmployeeIdentity(String(employee._id), employee.code, String(employee.branchId));
    if (employee.userId !== null) {
      const user = await userService.getById(String(employee.userId));
      await userService.update(
        String(employee.userId),
        {
          organization: {
            branchId: String(employee.branchId),
            departmentId: String(employee.departmentId),
            sectionId: employee.sectionId === null ? null : String(employee.sectionId),
          },
          version: user.__v,
        },
        actorId,
      );
    }

    await emit(HrEmployeeEvents.EmployeeRehired, {
      employeeId: String(employee._id),
      code: employee.code,
    });
    await notificationsService
      .notify({
        template: HrEmployeeTemplates.Rehired,
        to: { permission: 'employee.view', scope: 'organization' },
        data: { employeeCode: employee.code },
        entityRef: entityRef(String(employee._id)),
      })
      .catch(() => undefined);
  }

  // ── Login helpers (D3/D6) ─────────────────────────────────────────────────

  private async suspendLogin(userId: string, changes: EmployeeActionChange[], actorId: string): Promise<void> {
    const user = await userService.getById(userId);
    if (user.status === 'suspended' || user.status === 'archived') return;
    await userService.changeStatus(userId, { status: 'suspended', version: user.__v }, actorId);
    changes.push({ field: 'user.status', from: user.status, to: 'suspended' });
  }

  private async reactivateLogin(userId: string, changes: EmployeeActionChange[], actorId: string): Promise<void> {
    const user = await userService.getById(userId);
    if (user.status !== 'suspended') return;
    await userService.changeStatus(userId, { status: 'active', version: user.__v }, actorId);
    changes.push({ field: 'user.status', from: 'suspended', to: 'active' });
  }

  /**
   * DEPRECATED status-change alias (kept one release): translates the old PATCH /:id/status
   * shape onto the engine. Exits are refused — they need a typed exit + an explicit
   * rehire-eligibility decision (the exit actions endpoint).
   */
  async statusAlias(
    ctx: AuthContext,
    employeeId: string,
    input: ChangeEmployeeStatus,
    scope: ScopeSelector,
  ): Promise<EmployeeActionDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const base = {
      version: input.version,
      ...(input.effectiveDate === undefined ? {} : { effectiveDate: input.effectiveDate }),
    };
    switch (input.status) {
      case 'suspended':
        return this.createAction(ctx, employeeId, {
          type: 'suspend',
          reason: input.reason ?? '',
          disableLogin: true,
          ...base,
        }, scope);
      case 'onLeave':
        return this.createAction(ctx, employeeId, {
          type: 'leaveStart',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...base,
        }, scope);
      case 'active':
      case 'probation': {
        if (employee.status === 'suspended') {
          return this.createAction(ctx, employeeId, { type: 'reinstate', enableLogin: true, ...base }, scope);
        }
        if (employee.status === 'onLeave') {
          return this.createAction(ctx, employeeId, { type: 'leaveEnd', ...base }, scope);
        }
        throw new BusinessRuleError(`cannot return an employee who is ${employee.status}`);
      }
      case 'exited':
        throw new BusinessRuleError(
          'exits need a typed exit and a rehire-eligibility decision — use POST /:id/actions/exit',
        );
      default:
        throw new BusinessRuleError(`unsupported status: ${input.status}`);
    }
  }

  // ── Cancel / list / scheduler ─────────────────────────────────────────────

  /** Cancel a SCHEDULED action before it applies — append-only (status flip), audited. */
  async cancel(
    ctx: AuthContext,
    employeeId: string,
    actionId: string,
    input: CancelEmployeeAction,
    scope: ScopeSelector,
  ): Promise<EmployeeActionDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    if (input.version !== employee.__v) {
      throw new ConflictError('the employee was modified — reload and retry');
    }
    const action = await employeeActionRepository.getForEmployee(employeeId, actionId);
    if (action.status !== 'scheduled') {
      throw new BusinessRuleError('only a scheduled action can be cancelled');
    }
    action.status = 'cancelled';
    action.cancelledAt = new Date();
    action.cancelledBy = new Types.ObjectId(ctx.userId);
    if (input.reason !== undefined) action.failureReason = null;
    await action.save();
    await auditService.record({
      entityRef: entityRef(employeeId),
      action: 'personnelActionCancelled',
      changes: [
        { field: 'type', old: action.type, new: 'cancelled' },
        { field: 'reason', old: null, new: input.reason ?? null },
      ],
    });
    return action;
  }

  async list(
    employeeId: string,
    query: ListEmployeeActionsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<EmployeeActionDoc>> {
    // Visibility follows the employee itself (branch/department scoping).
    await employeeRepository.getById(employeeId, scope);
    return employeeActionRepository.listForEmployee(employeeId, query);
  }

  /**
   * Scheduler entry: apply due scheduled actions strictly in (effectiveDate, seq) order per
   * employee. Failures are recorded (`failed` + notification), never retried silently.
   */
  async applyDueScheduled(asOf: Date = new Date()): Promise<number> {
    const due = await employeeActionRepository.findDueScheduled(asOf);
    let applied = 0;
    for (const action of due) {
      await this.apply(action, { rethrow: false });
      const fresh = await EmployeeActionModel.findById(action._id);
      if (fresh?.status === 'applied') {
        applied += 1;
        await this.notifyScheduledOutcome(fresh, HrEmployeeTemplates.ScheduledActionApplied, null);
      }
    }
    return applied;
  }

  private async notifyScheduledOutcome(
    action: EmployeeActionDoc,
    template: string,
    failure: string | null,
  ): Promise<void> {
    const recipients = new Set<string>();
    if (action.by !== null) recipients.add(String(action.by));
    if (recipients.size === 0) return;
    await notificationsService
      .notify({
        template,
        to: { userIds: [...recipients] },
        data: {
          employeeCode: action.employeeCode,
          type: action.type,
          ...(failure === null ? {} : { failure }),
        },
        entityRef: entityRef(String(action.employeeId)),
      })
      .catch(() => undefined);
  }
}

export const employeeActionService = new EmployeeActionService();
