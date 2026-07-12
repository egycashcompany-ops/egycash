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
import {
  HrEmployeeEvents,
  HrEmployeeTemplates,
  type CreateEmployee,
  type ListEmployeesQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { notificationsService } from '../../../../platform/notifications';
import { applicantService } from '../applicants';
import { jobOfferService } from '../job-offers';
import { employeeRepository, type EmployeeListFilter } from './employee.repository';
import { nextEmployeeNumber } from './employee-sequence';
import { type EmployeeDoc, type EmploymentDetails } from './employee.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employee', entityId: id });

class EmployeeService {
  /** Fire-and-forget hiring notification to the reporting manager + the creator. */
  private async notifyHire(doc: EmployeeDoc): Promise<void> {
    const recipients = new Set<string>([String(doc.employment.managerId), doc.createdBy === null ? '' : String(doc.createdBy)]);
    recipients.delete('');
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
      branchId: t.branchId,
      managerId: t.managerId,
      employmentType: t.employmentType,
      salary: { amount: t.salary.amount, currency: t.salary.currency },
      allowances: t.allowances.map((a) => ({ name: a.name, amount: a.amount, currency: a.currency })),
      benefits: [...t.benefits],
      probationMonths: t.probationMonths,
      startDate: t.startDate,
    };
    const hiredAt = input.hiringDate ?? new Date();

    // Atomic: allocate the number and insert the record in one transaction. The unique index
    // on `jobOfferId` guarantees no duplicate employee even under concurrent creation.
    const doc = await unitOfWork(async (session) => {
      const code = await nextEmployeeNumber(hiredAt.getUTCFullYear(), session);
      return employeeRepository.create(
        {
          code,
          status: 'active',
          applicantId: offer.applicantId,
          applicantCode: offer.applicantCode,
          jobRequisitionId: applicant.jobRequisitionId,
          jobOfferId: offer._id,
          offerCode: offer.code,
          acceptedOfferRevision: snapshot.revisionNumber,
          employment,
          branchId: employment.branchId,
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
}

export const employeeService = new EmployeeService();
