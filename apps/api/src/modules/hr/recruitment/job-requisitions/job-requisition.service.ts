// Job requisition service (P-HR-REQ). The rules it enforces live next door in
// `job-requisition-rules.ts` — pure and testable without a database — and this file does the three
// things a service does: read what the rule needs, ask it, and write the answer down atomically.
//
// TWO PROPERTIES WORTH STATING, because both are easy to lose in a later edit:
//
// ① Every state-changing write is conditional on BOTH the status it read and the version it read.
//    A concurrent second approval loses cleanly instead of approving twice.
// ② `filledCount` is never stored. It is counted from the link records, so replaying
//    `hr.applicant.hired` cannot inflate it (D-REQ-13).
import { Types } from 'mongoose';
import {
  HrJobRequisitionEvents,
  type CloseJobRequisition,
  type CreateJobRequisition,
  type DecideJobRequisition,
  type JobRequisitionStatus,
  type ListJobRequisitionsQuery,
  type Paginated,
  type UpdateJobRequisition,
} from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { emit } from '../../../../platform/kernel/event-bus';
import {
  branchService,
  departmentService,
  effectiveManagerId,
  jobTitleService,
  sectionService,
} from '../../../../platform/organization';
import { BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { JobRequisitionModel, type JobRequisitionDoc } from './job-requisition.model';
import { JobRequisitionFillModel, type JobRequisitionFillDoc } from './job-requisition-fill.model';
import { jobRequisitionRepository } from './job-requisition.repository';
import { nextRequisitionCode } from './job-requisition-sequence';
import {
  cancelProblem,
  closeProblem,
  decisionProblem,
  deleteProblem,
  editProblem,
  fulfilmentStatus,
  nextStatusAfterDecision,
  requiresReapproval,
  statusAfterEdit,
  stepOf,
  submitProblem,
  type RequisitionShape,
} from './job-requisition-rules';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'jobRequisition',
  entityId: id,
});

const shapeOf = (doc: JobRequisitionDoc): RequisitionShape => ({
  jobTitleId: String(doc.jobTitleId),
  departmentId: String(doc.departmentId),
  branchId: String(doc.branchId),
  sectionId: doc.sectionId === null ? null : String(doc.sectionId),
  quantity: doc.quantity,
});

class JobRequisitionService {
  /**
   * Every id is checked to exist, and the section is checked to belong to the named department —
   * the rule a Zod schema cannot express, and the same one Job Positions used to enforce for its
   * seat. It outlived the entity because it was never about the entity.
   */
  private async assertPlacement(input: {
    jobTitleId: string;
    departmentId: string;
    branchId: string;
    sectionId: string | null;
  }): Promise<void> {
    const title = await jobTitleService.getById(input.jobTitleId).catch(() => null);
    if (title === null) throw new ValidationError([{ field: 'jobTitleId', code: 'INVALID', message: 'unknown job title' }]);
    const department = await departmentService.getById(input.departmentId).catch(() => null);
    if (department === null) {
      throw new ValidationError([{ field: 'departmentId', code: 'INVALID', message: 'unknown department' }]);
    }
    const branch = await branchService.getById(input.branchId).catch(() => null);
    if (branch === null) throw new ValidationError([{ field: 'branchId', code: 'INVALID', message: 'unknown branch' }]);
    if (input.sectionId !== null) {
      const section = await sectionService.getById(input.sectionId).catch(() => null);
      if (section === null) {
        throw new ValidationError([{ field: 'sectionId', code: 'INVALID', message: 'unknown section' }]);
      }
      if (String(section.departmentId) !== input.departmentId) {
        throw new BusinessRuleError('the section does not belong to the requisition department');
      }
    }
  }

  async create(ctx: AuthContext, input: CreateJobRequisition): Promise<JobRequisitionDoc> {
    const sectionId = input.sectionId === undefined || input.sectionId === null ? null : input.sectionId;
    await this.assertPlacement({
      jobTitleId: input.jobTitleId,
      departmentId: input.departmentId,
      branchId: input.branchId,
      sectionId,
    });
    const code = await nextRequisitionCode();
    const doc = await jobRequisitionRepository.create(
      {
        code,
        jobTitleId: new Types.ObjectId(input.jobTitleId),
        departmentId: new Types.ObjectId(input.departmentId),
        branchId: new Types.ObjectId(input.branchId),
        sectionId: sectionId === null ? null : new Types.ObjectId(sectionId),
        quantity: input.quantity,
        reason: input.reason,
        priority: input.priority,
        neededBy: input.neededBy === undefined || input.neededBy === null ? null : input.neededBy,
        status: 'draft',
        requestedBy: new Types.ObjectId(ctx.userId),
      } as never,
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, { code, quantity: input.quantity, status: 'draft' }),
    });
    return doc;
  }

  async getById(id: string, scope?: ScopeSelector): Promise<JobRequisitionDoc> {
    return jobRequisitionRepository.getById(id, scope);
  }

  async list(
    query: ListJobRequisitionsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<JobRequisitionDoc>> {
    return jobRequisitionRepository.listScoped(query, scope);
  }

  async filledCount(id: string): Promise<number> {
    return jobRequisitionRepository.countFills(id);
  }

  async filledCountsFor(ids: readonly string[]): Promise<Map<string, number>> {
    return jobRequisitionRepository.countFillsFor(ids);
  }

  async fills(id: string, scope?: ScopeSelector): Promise<JobRequisitionFillDoc[]> {
    await jobRequisitionRepository.getById(id, scope);
    return jobRequisitionRepository.listFills(id);
  }

  /**
   * Edit (D-REQ-15).
   *
   * Raising the quantity or moving the placement sends the requisition back to `pendingManager` and
   * CLEARS both decision stamps: leaving a manager's name on a requisition they no longer approved
   * would be the record lying about who agreed to what.
   */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateJobRequisition,
    scope?: ScopeSelector,
  ): Promise<JobRequisitionDoc> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const before = shapeOf(doc);
    const after: RequisitionShape = {
      jobTitleId: input.jobTitleId ?? before.jobTitleId,
      departmentId: input.departmentId ?? before.departmentId,
      branchId: input.branchId ?? before.branchId,
      sectionId: input.sectionId === undefined ? before.sectionId : input.sectionId ?? null,
      quantity: input.quantity ?? before.quantity,
    };
    const filled = await jobRequisitionRepository.countFills(id);
    const problem = editProblem({ status: doc.status, filledCount: filled, after });
    if (problem !== null) throw new BusinessRuleError(problem);
    await this.assertPlacement(after);

    const needsReapproval = requiresReapproval(before, after);
    const status = statusAfterEdit(doc.status, needsReapproval);
    const cleared = needsReapproval
      ? {
          managerDecidedBy: null,
          managerDecidedAt: null,
          managerComment: null,
          hrDecidedBy: null,
          hrDecidedAt: null,
          hrComment: null,
        }
      : {};

    const updated = await jobRequisitionRepository.updateById(
      id,
      {
        jobTitleId: new Types.ObjectId(after.jobTitleId),
        departmentId: new Types.ObjectId(after.departmentId),
        branchId: new Types.ObjectId(after.branchId),
        sectionId: after.sectionId === null ? null : new Types.ObjectId(after.sectionId),
        quantity: after.quantity,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.neededBy === undefined ? {} : { neededBy: input.neededBy ?? null }),
        status,
        ...cleared,
      } as never,
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(
        { ...before, status: doc.status },
        { ...after, status },
      ),
    });
    return updated;
  }

  async submit(ctx: AuthContext, id: string, version: number, scope?: ScopeSelector): Promise<JobRequisitionDoc> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const problem = submitProblem(doc.status);
    if (problem !== null) throw new BusinessRuleError(problem);
    const updated = await this.transition(id, doc.status, 'pendingManager', version, {}, ctx);
    await emit(HrJobRequisitionEvents.Submitted, {
      requisitionId: id,
      code: doc.code,
      departmentId: String(doc.departmentId),
      quantity: doc.quantity,
    });
    return updated;
  }

  /**
   * Decide one step (D-REQ-6, D-REQ-11).
   *
   * The manager step authorizes by relationship — `effectiveManagerId` of the requisition's
   * department, which honours the acting-manager window — and the HR step by permission. The
   * requester is refused at either step, whatever they hold.
   */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideJobRequisition,
    canApprove: boolean,
    scope?: ScopeSelector,
  ): Promise<JobRequisitionDoc> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const department = await departmentService.getById(String(doc.departmentId)).catch(() => null);
    if (department === null) throw new NotFoundError('department not found');
    const managerId = effectiveManagerId(department);

    const problem = decisionProblem({
      status: doc.status,
      isRequester: String(doc.requestedBy) === ctx.userId,
      isDepartmentManager: managerId !== null && managerId === ctx.userId,
      canApprove,
    });
    if (problem !== null) throw new ForbiddenError(problem);

    const step = stepOf(doc.status);
    const decided = new Date();
    const stamps =
      step === 'manager'
        ? {
            managerDecidedBy: new Types.ObjectId(ctx.userId),
            managerDecidedAt: decided,
            managerComment: input.comment ?? null,
          }
        : {
            hrDecidedBy: new Types.ObjectId(ctx.userId),
            hrDecidedAt: decided,
            hrComment: input.comment ?? null,
          };

    let target = nextStatusAfterDecision(doc.status, input.verdict);
    if (target === 'open') {
      // A requisition can arrive here with hires already against it — the re-approval case — so it
      // must not sit in `open` claiming to be empty.
      const filled = await jobRequisitionRepository.countFills(id);
      target = fulfilmentStatus('open', filled, doc.quantity);
    }

    const updated = await this.transition(id, doc.status, target, input.version, stamps, ctx);
    await emit(
      input.verdict === 'approve' ? HrJobRequisitionEvents.Approved : HrJobRequisitionEvents.Rejected,
      {
        requisitionId: id,
        code: doc.code,
        departmentId: String(doc.departmentId),
        step: step ?? 'hr',
        status: target,
      },
    );
    if (target === 'filled') {
      await emit(HrJobRequisitionEvents.Filled, { requisitionId: id, code: doc.code, quantity: doc.quantity });
    }
    return updated;
  }

  /** End a live requisition early (D-REQ-4). The reason is required by the schema; this is final. */
  async close(ctx: AuthContext, id: string, input: CloseJobRequisition, scope?: ScopeSelector): Promise<JobRequisitionDoc> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const problem = closeProblem(doc.status);
    if (problem !== null) throw new BusinessRuleError(problem);
    const updated = await this.transition(id, doc.status, 'closed', input.version, {
      closedBy: new Types.ObjectId(ctx.userId),
      closedAt: new Date(),
      closeReason: input.reason,
    }, ctx);
    await emit(HrJobRequisitionEvents.Closed, { requisitionId: id, code: doc.code, reason: input.reason });
    return updated;
  }

  /** Withdraw a requisition that never opened, or one being approved. Also final. */
  async cancel(ctx: AuthContext, id: string, input: CloseJobRequisition, scope?: ScopeSelector): Promise<JobRequisitionDoc> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const problem = cancelProblem(doc.status);
    if (problem !== null) throw new BusinessRuleError(problem);
    const updated = await this.transition(id, doc.status, 'cancelled', input.version, {
      closedBy: new Types.ObjectId(ctx.userId),
      closedAt: new Date(),
      closeReason: input.reason,
    }, ctx);
    await emit(HrJobRequisitionEvents.Cancelled, { requisitionId: id, code: doc.code, reason: input.reason });
    return updated;
  }

  /** Delete a draft. Anything further along is cancelled, not erased — see `deleteProblem`. */
  async remove(ctx: AuthContext, id: string, scope?: ScopeSelector): Promise<void> {
    const doc = await jobRequisitionRepository.getById(id, scope);
    const problem = deleteProblem(doc.status);
    if (problem !== null) throw new BusinessRuleError(problem);
    await jobRequisitionRepository.softDeleteById(id, { by: ctx.userId, scope });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'delete',
      changes: diffChanges({ status: doc.status }, {}),
    });
  }

  /**
   * Record one hire against one requisition (D-REQ-13) — the only writer the event consumer uses.
   *
   * Returns false when the pair is already recorded: the unique index refuses the second insert,
   * and a duplicate delivery is a no-op rather than an error, because the fact it carries is one
   * this collection already holds.
   */
  async recordFill(input: {
    requisitionId: string;
    applicantId: string;
    employeeId: string | null;
    at: Date;
  }): Promise<boolean> {
    const doc = await JobRequisitionModel.findOne({
      _id: new Types.ObjectId(input.requisitionId),
      isDeleted: false,
    })
      .lean<JobRequisitionDoc>()
      .exec();
    if (doc === null) return false;

    try {
      await JobRequisitionFillModel.create({
        requisitionId: new Types.ObjectId(input.requisitionId),
        applicantId: new Types.ObjectId(input.applicantId),
        employeeId: input.employeeId === null ? null : new Types.ObjectId(input.employeeId),
        filledAt: input.at,
        createdBy: null,
        updatedBy: null,
        isDeleted: false,
      } as never);
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }

    const filled = await jobRequisitionRepository.countFills(input.requisitionId);
    const target = fulfilmentStatus(doc.status, filled, doc.quantity);
    if (target !== doc.status) {
      // Status-conditional only: this write is driven by an event, not by a caller holding a
      // version, and it may only move a requisition that is still where it was read.
      await JobRequisitionModel.updateOne(
        { _id: doc._id, status: doc.status, isDeleted: false },
        { $set: { status: target }, $inc: { __v: 1 } },
      ).exec();
      if (target === 'filled') {
        await emit(HrJobRequisitionEvents.Filled, {
          requisitionId: input.requisitionId,
          code: doc.code,
          quantity: doc.quantity,
        });
      }
    }
    return true;
  }

  /** One status move: conditional on the status read AND the version read. */
  private async transition(
    id: string,
    from: JobRequisitionStatus,
    to: JobRequisitionStatus,
    version: number,
    extra: Record<string, unknown>,
    ctx: AuthContext,
  ): Promise<JobRequisitionDoc> {
    const updated = await JobRequisitionModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), status: from, __v: version, isDeleted: false },
      { $set: { status: to, updatedBy: new Types.ObjectId(ctx.userId), ...extra }, $inc: { __v: 1 } },
      { new: true },
    )
      .lean<JobRequisitionDoc>()
      .exec();
    if (updated === null) {
      throw new BusinessRuleError('the requisition changed under you — reload and retry');
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges({ status: from }, { status: to }),
    });
    return updated;
  }
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

export const jobRequisitionService = new JobRequisitionService();
