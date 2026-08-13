// Payroll adjustments — bonuses and penalties (P-HR-04).
//
// THE STATE MACHINE (D1): draft → pendingApproval → approved, with `reject` returning to draft and
// `cancel` reachable from any live state. It is the Contracts shape deliberately — one decision by
// a second person — rather than Leave's manager→HR chain, which models a relationship this does
// not have: a bonus is granted BY HR, so a manager step would be a signature on somebody else's
// decision.
//
// WHAT EACH STATE MEANS FOR THE MONEY. Only `approved` reaches payroll. A draft is a proposal, and
// a rejected entry went back to draft — neither is a figure anybody agreed to pay. Once approved,
// the entry is IMMUTABLE: no edit, no delete, only cancel, and only while the month is still open.
// That is the same append-only stance Personnel Actions take, for the same reason — an approved
// figure is the record of a decision, not a working note.
import { Types } from 'mongoose';
import {
  type CancelPayrollAdjustment,
  type CreatePayrollAdjustment,
  type DecidePayrollAdjustment,
  type ListPayrollAdjustmentsQuery,
  type Paginated,
  type UpdatePayrollAdjustment,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../../platform/files';
import { employeeRepository } from '../../employee-management/employees';
import { employmentSpansOf, spanContaining } from '../compensation/employment-spans';
import { periodRange } from '../compensation/compensation-rules';
// The file, not the barrel — the same acyclic-import care the pay-item service takes.
import { payrollRunService } from '../runs/payroll-run.service';
import { payItemRepository } from '../pay-items/pay-item.repository';
import {
  resolveAdjustmentAttachmentsCategoryId,
  ADJUSTMENT_ATTACHMENT_ENTITY_TYPE,
} from './payroll-adjustment.files';
import { payrollAdjustmentRepository } from './payroll-adjustment.repository';
import { PayrollAdjustmentModel, type PayrollAdjustmentDoc } from './payroll-adjustment.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'payrollAdjustment',
  entityId: id,
});

class PayrollAdjustmentService {
  // ── Writes ────────────────────────────────────────────────────────────────

  async create(
    ctx: AuthContext,
    employeeId: string,
    input: CreatePayrollAdjustment,
    scope: ScopeSelector,
  ): Promise<PayrollAdjustmentDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    await this.assertRecordable(employeeId, input.period, input, employee);

    const duplicate = await payrollAdjustmentRepository.findDuplicate(
      employeeId,
      input.period,
      input.kind,
      input.reason,
    );
    if (duplicate !== null) {
      throw new ConflictError(
        `a ${input.kind} for ${input.period} with this reason is already recorded — cancel it first, or state a different reason`,
      );
    }

    const doc = await PayrollAdjustmentModel.create({
      employeeId: new Types.ObjectId(employeeId),
      period: input.period,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      payItemId: input.payItemId === undefined ? null : new Types.ObjectId(input.payItemId),
      note: input.note ?? null,
      attachmentFileId:
        input.attachmentFileId === undefined
          ? null
          : await this.resolveAttachment(ctx, employeeId, input.attachmentFileId),
      status: 'draft',
      branchId: employee.branchId,
      createdBy: new Types.ObjectId(ctx.userId),
      updatedBy: null,
      isDeleted: false,
    });

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'period', old: null, new: input.period },
        { field: 'kind', old: null, new: input.kind },
        { field: 'amount', old: null, new: String(input.amount) },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    return doc;
  }

  /** Editing is a DRAFT-only act — an approved figure is a record, not a working note. */
  async update(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: UpdatePayrollAdjustment,
    scope: ScopeSelector,
  ): Promise<PayrollAdjustmentDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await payrollAdjustmentRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'draft') {
      throw new BusinessRuleError(`a ${doc.status} adjustment cannot be edited`);
    }
    if (input.version !== doc.__v) {
      throw new ConflictError('this adjustment was modified — reload and retry');
    }

    const period = input.period ?? doc.period;
    const kind = input.kind ?? doc.kind;
    const reason = input.reason ?? doc.reason;
    await this.assertRecordable(
      employeeId,
      period,
      { amount: input.amount ?? doc.amount, currency: input.currency ?? doc.currency },
      employee,
    );
    const duplicate = await payrollAdjustmentRepository.findDuplicate(
      employeeId,
      period,
      kind,
      reason,
      id,
    );
    if (duplicate !== null) {
      throw new ConflictError(
        `a ${kind} for ${period} with this reason is already recorded — cancel it first, or state a different reason`,
      );
    }

    const after = await payrollAdjustmentRepository.updateById(
      id,
      {
        period,
        kind,
        amount: input.amount ?? doc.amount,
        currency: input.currency ?? doc.currency,
        reason,
        note: input.note === undefined ? doc.note : input.note,
        payItemId:
          input.payItemId === undefined ? doc.payItemId : new Types.ObjectId(input.payItemId),
        attachmentFileId:
          input.attachmentFileId === undefined
            ? doc.attachmentFileId
            : await this.resolveAttachment(ctx, employeeId, input.attachmentFileId),
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'amount', old: String(doc.amount), new: String(after.amount) },
        { field: 'period', old: doc.period, new: after.period },
      ],
    });
    return after;
  }

  async submit(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    version: number,
    scope: ScopeSelector,
  ): Promise<PayrollAdjustmentDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await payrollAdjustmentRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'draft') throw new BusinessRuleError('only a draft can be submitted');
    // Re-checked here, not only at creation: a month can be frozen between the two, and a run
    // that has already priced the period must not gain a figure afterwards.
    await this.assertRecordable(employeeId, doc.period, doc, employee);

    const after = await payrollAdjustmentRepository.updateById(
      id,
      {
        status: 'pendingApproval',
        submittedBy: new Types.ObjectId(ctx.userId),
        submittedAt: new Date(),
      } as never,
      { by: ctx.userId, version },
    );
    await this.recordStatus(id, doc.status, 'pendingApproval', null);
    return after;
  }

  /**
   * The second person's decision (D1).
   *
   * `rejected` returns the entry to `draft` — the Contracts precedent — so the mistake can be
   * corrected and resubmitted rather than re-typed from nothing. The decision itself is kept
   * either way: who decided, when, and their note.
   */
  async decide(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: DecidePayrollAdjustment,
    scope: ScopeSelector,
  ): Promise<PayrollAdjustmentDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await payrollAdjustmentRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'pendingApproval') {
      throw new BusinessRuleError('this adjustment is not awaiting approval');
    }
    // A SECOND person. The permission alone does not make it a two-person rule.
    if (doc.submittedBy !== null && String(doc.submittedBy) === ctx.userId) {
      throw new ForbiddenError('an adjustment cannot be approved by the person who submitted it');
    }
    if (input.decision === 'approved') {
      await this.assertRecordable(employeeId, doc.period, doc, employee);
    }

    const status = input.decision === 'approved' ? 'approved' : 'draft';
    const after = await payrollAdjustmentRepository.updateById(
      id,
      {
        status,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await this.recordStatus(id, 'pendingApproval', status, input.note ?? null);
    return after;
  }

  /**
   * Cancel — the only thing that can happen to an approved entry, and only while the month is open.
   *
   * After the freeze there is nothing to cancel INTO: the period has been priced and the payslip
   * issued. A mistake found then is corrected by a new adjustment of the opposite kind in a later
   * period, which is the same forward-adjustment stance the rest of payroll takes.
   */
  async cancel(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: CancelPayrollAdjustment,
    scope: ScopeSelector,
  ): Promise<PayrollAdjustmentDoc> {
    await employeeRepository.getById(employeeId, scope);
    const doc = await payrollAdjustmentRepository.getForEmployee(employeeId, id);
    if (doc.status === 'cancelled') throw new BusinessRuleError('already cancelled');
    await this.assertPeriodOpen(doc.period, 'cancelled in');

    const after = await payrollAdjustmentRepository.updateById(
      id,
      {
        status: 'cancelled',
        cancelledBy: new Types.ObjectId(ctx.userId),
        cancelledAt: new Date(),
        cancelReason: input.reason,
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await this.recordStatus(id, doc.status, 'cancelled', input.reason);
    return after;
  }

  /** The supporting document, uploaded before the entry names it (the HR3-C pattern). */
  async attach(
    ctx: AuthContext,
    employeeId: string,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<FileDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    return fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: ADJUSTMENT_ATTACHMENT_ENTITY_TYPE,
        entityId: String(employee._id),
        categoryId: await resolveAdjustmentAttachmentsCategoryId(),
        displayName: binary.originalName,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listForEmployee(
    employeeId: string,
    query: ListPayrollAdjustmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PayrollAdjustmentDoc>> {
    await employeeRepository.getById(employeeId, scope);
    return payrollAdjustmentRepository.listForEmployee(employeeId, query);
  }

  async list(
    query: ListPayrollAdjustmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PayrollAdjustmentDoc>> {
    return payrollAdjustmentRepository.listScoped(query, scope);
  }

  /** Catalog rows the listed entries cite, by id — one query, not one per row (D4). */
  async payItemsFor(
    docs: readonly PayrollAdjustmentDoc[],
  ): Promise<Map<string, { code: string; name: { ar: string; en: string } }>> {
    const ids = [...new Set(docs.map((d) => d.payItemId).filter((id) => id !== null))].map(String);
    const out = new Map<string, { code: string; name: { ar: string; en: string } }>();
    for (const id of ids) {
      const item = await payItemRepository.findById(id);
      if (item !== null) out.set(id, { code: item.code, name: item.name });
    }
    return out;
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  /**
   * Everything that has to be true for a figure to be recordable against a month.
   *
   * Each is a rule that already exists somewhere in payroll, applied here rather than reinvented:
   * the employment span is PY-3's, the frozen period is PY-9's, and the single currency is the one
   * `computeCompensation` refuses to break.
   */
  private async assertRecordable(
    employeeId: string,
    period: string,
    input: { amount: number; currency: string },
    employee: Awaited<ReturnType<typeof employeeRepository.getById>>,
  ): Promise<void> {
    if (input.amount <= 0) {
      throw new BusinessRuleError('an adjustment amount must be positive — the kind sets the sign');
    }
    const basic = employee.employment.salary;
    if (basic !== null && input.currency !== basic.currency) {
      throw new BusinessRuleError(
        `this employee is paid in ${basic.currency} — a ${input.currency} adjustment could not be totalled with it`,
      );
    }

    // The month must fall inside ONE employment span: paying somebody for a month they were not
    // employed in, or across the gap between an exit and a rehire, is not a rounding question.
    const { from, to } = periodRange(period);
    if (spanContaining(employmentSpansOf(employee), from, to) === null) {
      throw new BusinessRuleError(
        `${period} does not fall inside a single employment period of this employee`,
      );
    }
    await this.assertPeriodOpen(period, 'recorded against');
    void employeeId;
  }

  private async assertPeriodOpen(period: string, verb: string): Promise<void> {
    const frozen = await payrollRunService.frozenPeriods();
    if (frozen.includes(period)) {
      throw new BusinessRuleError(
        `${period} has a frozen payroll run — it cannot be ${verb} now; record the correction in a later period instead`,
      );
    }
  }

  /** The file must be one uploaded for THIS employee, for this purpose. */
  private async resolveAttachment(
    ctx: AuthContext,
    employeeId: string,
    fileId: string,
  ): Promise<Types.ObjectId> {
    const file = await fileService.getById(fileId, undefined, ctx);
    const ref = file.entityRef;
    if (
      ref.moduleId !== 'hr' ||
      ref.entityType !== ADJUSTMENT_ATTACHMENT_ENTITY_TYPE ||
      ref.entityId !== employeeId
    ) {
      throw new BusinessRuleError(
        'the attachment must be uploaded for this employee through the adjustment attachment endpoint',
      );
    }
    return file._id as Types.ObjectId;
  }

  private async recordStatus(
    id: string,
    from: string,
    to: string,
    note: string | null,
  ): Promise<void> {
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: from, new: to },
        ...(note === null ? [] : [{ field: 'note', old: null, new: note }]),
      ],
    });
  }
}

export const payrollAdjustmentService = new PayrollAdjustmentService();
