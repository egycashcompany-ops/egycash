// Employee Creation (Stage 5). Turns an applicant whose Job Offer was Accepted into an
// Employee. The employment terms are read EXCLUSIVELY from the offer's immutable Accepted
// Snapshot (never the live offer). The record preserves references to the Applicant, the Job
// Requisition, and the Accepted Job Offer, gets a unique employee number, and is created
// atomically (number allocation + insert in one transaction); a unique index on the offer id
// prevents a second employee from the same offer. Creation publishes `hr.employee.created`,
// notifies, and is audited.
//
// Cross-feature access to the Applicant and Job Offer aggregates goes through their barrels
// only (ADR-003). This stage never touches Hiring Documents / Electronic File.
import { Types } from 'mongoose';
import {
  HrEmployeeEvents,
  HrEmployeeTemplates,
  canTransitionEmployeeStatus,
  type ChangeEmployeeStatus,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type CreateUser,
  type ListEmployeesQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { notificationsService } from '../../../../platform/notifications';
import { branchService } from '../../../../platform/organization';
import { userService, type UserDoc } from '../../../../platform/users';
import { applicantService } from '../../recruitment/applicants';
import { jobOfferService } from '../../recruitment/job-offers';
import { employeeRepository, type EmployeeListFilter } from './employee.repository';
import { nextEmployeeNumber } from './employee-sequence';
import { buildEmployeeCode } from './employee-number';
import { type EmployeeDoc, type EmployeeStatusEvent, type EmploymentDetails } from './employee.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });

class EmployeeService {
  /** Fire-and-forget hiring notification to the reporting manager + the creator. */
  private async notifyHire(doc: EmployeeDoc): Promise<void> {
    const recipients = new Set<string>();
    if (doc.employment.managerId !== null) recipients.add(String(doc.employment.managerId));
    if (doc.createdBy !== null) recipients.add(String(doc.createdBy));
    await notificationsService
      .notify({
        template: HrEmployeeTemplates.Created,
        to: { userIds: [...recipients] },
        data: { employeeCode: doc.code, applicantCode: doc.applicantCode },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /**
   * Create an Employee from an Accepted Job Offer. Reads employment data only from the offer's
   * Accepted Snapshot; refuses if the offer is not accepted or an employee already exists for it.
   */
  async create(ctx: AuthContext, input: CreateEmployee, scope: ScopeSelector): Promise<EmployeeDoc> {
    const offer = await jobOfferService.acceptedOfferById(input.jobOfferId);
    if (offer === null) {
      throw new BusinessRuleError('employee creation requires an accepted job offer');
    }
    const snapshot = offer.acceptedSnapshot;
    if (snapshot === null) {
      throw new BusinessRuleError('the accepted offer has no accepted-terms snapshot');
    }
    // Duplicate-hire guard (fast path; the unique offer index is the race-safe backstop).
    const existing = await employeeRepository.findByOfferId(input.jobOfferId);
    if (existing !== null) {
      throw new ConflictError('an employee has already been created from this offer');
    }

    // Preserve the Job Requisition reference (carried by the applicant), and confirm the
    // applicant is still in the active pipeline.
    const applicant = await applicantService.getById(String(offer.applicantId), scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('applicant is no longer in the active pipeline');
    }

    const t = snapshot.terms;
    const employment: EmploymentDetails = {
      jobTitleId: t.jobTitleId,
      departmentId: t.departmentId,
      // The offer snapshot does not carry a section/position; kept null (future-proof, ADR-016/017).
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
    const hiredAt = input.hiringDate ?? new Date();

    // The current branch code prefixes the (derived) employee code (ADR-017); reading it before the
    // transaction is safe. On a future transfer, `code` is recomputed from the new branch code +
    // the unchanged Global Employee Number via `buildEmployeeCode`.
    const branch = await branchService.getById(String(employment.branchId));

    // Atomic: allocate the permanent Global Employee Number and insert the record in one transaction.
    // The unique index on `jobOfferId` guarantees no duplicate employee even under concurrent
    // creation; the global counter guarantees the number is company-wide unique and never reused.
    const doc = await unitOfWork(async (session) => {
      const employeeNumber = await nextEmployeeNumber(session);
      const code = buildEmployeeCode(branch.code, employeeNumber);
      const hireEvent: EmployeeStatusEvent = {
        from: null,
        to: 'active',
        reason: null,
        effectiveDate: hiredAt,
        at: new Date(),
        by: new Types.ObjectId(ctx.userId),
      };
      return employeeRepository.create(
        {
          employeeNumber,
          code,
          status: 'active',
          statusHistory: [hireEvent],
          userId: null,
          applicantId: offer.applicantId,
          applicantCode: offer.applicantCode,
          jobRequisitionId: applicant.jobRequisitionId,
          jobOfferId: offer._id,
          offerCode: offer.code,
          acceptedOfferRevision: snapshot.revisionNumber,
          employment,
          branchId: employment.branchId,
          departmentId: employment.departmentId,
          sectionId: employment.sectionId,
          hiredAt,
        },
        { by: ctx.userId, session },
      );
    });

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'code', old: null, new: doc.code },
        { field: 'jobOfferId', old: null, new: String(doc.jobOfferId) },
      ],
    });
    await emit(HrEmployeeEvents.EmployeeCreated, {
      employeeId: String(doc._id),
      code: doc.code,
      applicantId: String(doc.applicantId),
      jobOfferId: String(doc.jobOfferId),
    });
    await this.notifyHire(doc);
    return doc;
  }

  async list(query: ListEmployeesQuery, scope: ScopeSelector): Promise<Paginated<EmployeeDoc>> {
    return employeeRepository.listEmployees({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListEmployeesQuery): EmployeeListFilter {
    return {
      status: query.status,
      applicantId: query.applicantId,
      jobOfferId: query.jobOfferId,
      branchId: query.branchId,
      search: query.search,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<EmployeeDoc> {
    return employeeRepository.getById(id, scope);
  }

  /**
   * Create the login account for an Employee (Employee ← one User, ADR-017). The organizational
   * placement is copied from the Employee (never supplied by the caller); the username defaults to
   * the Employee Code. The platform User is the authority for the link (`user.employeeId`, unique);
   * the employee's `userId` is a denormalized back-reference set here.
   */
  async createLogin(
    ctx: AuthContext,
    employeeId: string,
    input: CreateEmployeeLogin,
    scope: ScopeSelector,
  ): Promise<{ user: UserDoc; activationToken: string; employeeCode: string }> {
    const employee = await employeeRepository.getById(employeeId, scope);
    if (employee.userId !== null) {
      throw new ConflictError('this employee already has a login account');
    }
    const createUser: CreateUser = {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      locale: input.locale,
      organization: {
        branchId: String(employee.branchId),
        departmentId: employee.departmentId === null ? null : String(employee.departmentId),
        sectionId: employee.sectionId === null ? null : String(employee.sectionId),
        jobTitleId: String(employee.employment.jobTitleId),
      },
    };
    const { user, activationToken } = await userService.create(createUser, ctx.userId, {
      username: input.username ?? employee.code,
      employeeId,
    });
    await employeeRepository.updateById(
      employeeId,
      { userId: user._id },
      { by: ctx.userId, version: employee.__v, scope },
    );
    await auditService.record({
      entityRef: entityRef(employeeId),
      action: 'loginCreated',
      changes: [{ field: 'userId', old: null, new: String(user._id) }],
    });
    return { user, activationToken, employeeCode: employee.code };
  }

  /**
   * Move an employee to a new lifecycle status (leave / return / suspend / reinstate / terminate).
   * The transition is validated against the shared matrix; the change is appended to the status
   * trail with its reason + effective date, audited, and published as `hr.employee.statusChanged`.
   * Optimistic-concurrency guarded via the caller-supplied `version`.
   */
  async changeStatus(
    ctx: AuthContext,
    id: string,
    input: ChangeEmployeeStatus,
    scope: ScopeSelector,
  ): Promise<EmployeeDoc> {
    const employee = await employeeRepository.getById(id, scope);
    const from = employee.status;
    const to = input.status;
    if (from === to) {
      throw new BusinessRuleError('the employee already has this status');
    }
    if (!canTransitionEmployeeStatus(from, to)) {
      throw new BusinessRuleError(`cannot change employee status from ${from} to ${to}`);
    }

    const now = new Date();
    const event: EmployeeStatusEvent = {
      from,
      to,
      reason: input.reason ?? null,
      effectiveDate: input.effectiveDate ?? now,
      at: now,
      by: new Types.ObjectId(ctx.userId),
    };
    const statusHistory = [...(employee.statusHistory ?? []), event];

    const updated = await employeeRepository.updateById(
      id,
      { status: to, statusHistory },
      { by: ctx.userId, version: input.version, scope },
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: from, new: to }],
    });
    await emit(HrEmployeeEvents.EmployeeStatusChanged, {
      employeeId: id,
      code: updated.code,
      from,
      to,
    });
    return updated;
  }
}

export const employeeService = new EmployeeService();
