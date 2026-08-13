// Employee loans and advances (P-HR-05, phase A) — the obligation and its schedule.
//
// THE STATE MACHINE (D2): draft → pendingApproval → approved → active → settled, with `reject`
// returning to draft and `cancel` reachable only BEFORE disbursement. It is the P-HR-04 shape
// deliberately — one decision by a second person — with one difference that is the whole feature:
// `approved` is the MIDDLE of this machine rather than its end. An approved bonus is a figure; an
// approved loan is a permission to hand money over, and the obligation begins when somebody does.
//
// WHY CANCELLATION STOPS AT DISBURSEMENT. Before it, cancelling withdraws a proposal and costs
// nothing. After it, "cancel" would mean forgiving a debt — a financial decision nobody has
// granted this system (D10's reasoning, applied to the balance instead of to a rate). An active
// loan leaves by being repaid: in this phase through an external settlement (D7-1), and in phase B
// through payroll.
//
// WHAT IS NOT HERE. No payroll. No port into the compensation engine, no line, no `origin`, no
// repayment ledger, no deduction — and therefore no vocabulary for one. No interest, no fee, no
// penalty, no ceiling (D4/D10). ECMS has no treasury: `disburse` RECORDS that money changed hands
// elsewhere; it moves none.
import { Types } from 'mongoose';
import {
  fromMinorUnits,
  toMinorUnits,
  type CancelEmployeeLoan,
  type CreateEmployeeLoan,
  type DecideEmployeeLoan,
  type DisburseEmployeeLoan,
  type ListEmployeeLoansQuery,
  type Paginated,
  type RescheduleEmployeeLoan,
  type SettleEmployeeLoanExternally,
  type SubmitEmployeeLoan,
  type UpdateEmployeeLoan,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { toDateOnly } from '../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../employee-management/employees';
import { employmentSpansOf, spanContaining } from '../payroll/compensation/employment-spans';
import { payrollPeriodPort } from './payroll-period.port';
import {
  assertScheduleTotals,
  generateSchedule,
  periodsFrom,
  totalMinor,
  type ScheduledInstallment,
} from './loan-schedule';
import {
  LOAN_ATTACHMENT_ENTITY_TYPE,
  resolveLoanAttachmentsCategoryId,
} from './employee-loan.files';
import { employeeLoanRepository, loanInstallmentRepository } from './employee-loan.repository';
import { EmployeeLoanModel, type EmployeeLoanDoc } from './employee-loan.model';
import { LoanInstallmentModel, type LoanInstallmentDoc } from './loan-installment.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employeeLoan', entityId: id });

/**
 * What is still owed, in minor units — DERIVED, never stored.
 *
 * `principal − everything repaid`. In phase A the only repayment is an external settlement; phase
 * B adds the payroll side to the same subtraction. A stored copy would be a second chance for the
 * number to be wrong on a document nobody may edit.
 */
export const remainingMinorOf = (loan: EmployeeLoanDoc): number =>
  toMinorUnits(loan.principal) - (loan.externalSettlement?.amountMinor ?? 0);

class EmployeeLoanService {
  // ── Writes ────────────────────────────────────────────────────────────────

  async create(
    ctx: AuthContext,
    employeeId: string,
    input: CreateEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);

    // D3 — refused at the earliest point at which two loans could both reach `active`. Checking
    // only at `active` would let two requests be approved in parallel and disbursed a minute apart,
    // which is the situation the decision exists to prevent.
    const live = await employeeLoanRepository.findLive(employeeId);
    if (live !== null) {
      throw new ConflictError(
        `this employee already has a ${live.status} ${live.type} — one loan at a time; settle or cancel it first`,
      );
    }

    await this.assertSchedulable(employee, input.principal, input.currency, input.installmentCount, input.firstPeriod);

    const doc = await EmployeeLoanModel.create({
      employeeId: new Types.ObjectId(employeeId),
      type: input.type,
      principal: input.principal,
      currency: input.currency,
      installmentCount: input.installmentCount,
      firstPeriod: input.firstPeriod,
      reason: input.reason,
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
        { field: 'type', old: null, new: input.type },
        { field: 'principal', old: null, new: String(input.principal) },
        { field: 'installmentCount', old: null, new: String(input.installmentCount) },
        { field: 'firstPeriod', old: null, new: input.firstPeriod },
      ],
    });
    return doc;
  }

  /** Editing is a DRAFT-only act — once submitted, the request is somebody else's to judge. */
  async update(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: UpdateEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'draft') {
      throw new BusinessRuleError(`a ${doc.status} loan cannot be edited`);
    }
    if (input.version !== doc.__v) {
      throw new ConflictError('this loan was modified — reload and retry');
    }

    const principal = input.principal ?? doc.principal;
    const currency = input.currency ?? doc.currency;
    const installmentCount = input.installmentCount ?? doc.installmentCount;
    const firstPeriod = input.firstPeriod ?? doc.firstPeriod;
    await this.assertSchedulable(employee, principal, currency, installmentCount, firstPeriod);

    const after = await employeeLoanRepository.updateById(
      id,
      {
        type: input.type ?? doc.type,
        principal,
        currency,
        installmentCount,
        firstPeriod,
        reason: input.reason ?? doc.reason,
        note: input.note === undefined ? doc.note : input.note,
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
        { field: 'principal', old: String(doc.principal), new: String(after.principal) },
        {
          field: 'installmentCount',
          old: String(doc.installmentCount),
          new: String(after.installmentCount),
        },
        { field: 'firstPeriod', old: doc.firstPeriod, new: after.firstPeriod },
      ],
    });
    return after;
  }

  async submit(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: SubmitEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'draft') throw new BusinessRuleError('only a draft loan can be submitted');
    // D3 again: a draft does not reserve the employee, so another loan may have gone live while
    // this one sat. Re-checked here rather than only at creation, for the same reason a frozen
    // period is re-checked — the world moves between the two writes.
    const live = await employeeLoanRepository.findLive(employeeId, id);
    if (live !== null) {
      throw new ConflictError(
        `this employee already has a ${live.status} ${live.type} — one loan at a time`,
      );
    }
    await this.assertSchedulable(
      employee,
      doc.principal,
      doc.currency,
      doc.installmentCount,
      doc.firstPeriod,
    );

    const after = await employeeLoanRepository.updateById(
      id,
      {
        status: 'pendingApproval',
        submittedBy: new Types.ObjectId(ctx.userId),
        submittedAt: new Date(),
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await this.recordStatus(id, doc.status, 'pendingApproval', null);
    return after;
  }

  /**
   * The second person's decision (D2).
   *
   * `rejected` returns the request to `draft` — the Contracts precedent P-HR-04 also took — so the
   * mistake can be corrected and resubmitted rather than retyped from nothing.
   */
  async decide(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: DecideEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'pendingApproval') {
      throw new BusinessRuleError('this loan is not awaiting approval');
    }
    // A SECOND person. The permission alone does not make it a two-person rule.
    if (doc.submittedBy !== null && String(doc.submittedBy) === ctx.userId) {
      throw new ForbiddenError('a loan cannot be approved by the person who submitted it');
    }
    if (input.decision === 'approved') {
      await this.assertSchedulable(
        employee,
        doc.principal,
        doc.currency,
        doc.installmentCount,
        doc.firstPeriod,
      );
    }

    const status = input.decision === 'approved' ? 'approved' : 'draft';
    const after = await employeeLoanRepository.updateById(
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
   * Record that the money was handed over — and, with it, bring the schedule into existence (D5).
   *
   * ECMS pays nobody: this is the note that a payment happened elsewhere. It is also the only
   * moment at which the obligation becomes real, which is why the schedule is generated HERE
   * rather than derived on every payroll run — a schedule recomputed each month would be a
   * different schedule every time somebody touched the loan.
   *
   * The rows are written with `$setOnInsert` under the unique `(loanId, seq)` key before the status
   * flips, so an interrupted disbursement finishes cheaply on a retry and cannot double a row. The
   * status change is the commit point, exactly as it is in a payroll run's freeze.
   */
  async disburse(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: DisburseEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'approved') {
      throw new BusinessRuleError(`a ${doc.status} loan cannot be disbursed — approve it first`);
    }
    // Re-checked at the last possible moment: a month can freeze between the approval and the
    // payment, and a schedule written into a priced month is the failure the freeze exists to stop.
    await this.assertSchedulable(
      employee,
      doc.principal,
      doc.currency,
      doc.installmentCount,
      doc.firstPeriod,
    );

    const schedule = generateSchedule(
      toMinorUnits(doc.principal),
      doc.installmentCount,
      doc.firstPeriod,
    );
    await this.writeSchedule(doc, schedule, ctx.userId);

    const after = await employeeLoanRepository.updateById(
      id,
      {
        status: 'active',
        disbursedAt: toDateOnly(new Date(input.disbursedAt)),
        disbursedBy: new Types.ObjectId(ctx.userId),
        disbursementNote: input.note ?? null,
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: 'approved', new: 'active' },
        { field: 'disbursedAt', old: null, new: input.disbursedAt },
        { field: 'installments', old: null, new: String(schedule.length) },
      ],
    });
    return after;
  }

  /** Withdrawing a proposal. Only before the money moved — see the header. */
  async cancel(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: CancelEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status === 'cancelled') throw new BusinessRuleError('already cancelled');
    if (doc.status !== 'draft' && doc.status !== 'pendingApproval' && doc.status !== 'approved') {
      throw new BusinessRuleError(
        `a ${doc.status} loan cannot be cancelled — money already changed hands; record its repayment instead`,
      );
    }

    const after = await employeeLoanRepository.updateById(
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

  /**
   * Spread what is left over a different set of months (D6).
   *
   * What may be replaced: rows that are still `planned` AND whose month nobody has closed. A row in
   * a frozen period stays exactly where it is — the past is not rewritten.
   *
   * The amount is not an input. The sum of the replaced rows is re-split through the SAME generator
   * a disbursement uses, so "the debt did not move" holds by construction rather than by a caller
   * getting the rounding right. Replaced rows are CANCELLED and new ones appended with fresh
   * sequence numbers rather than edited in place, so the schedule keeps a readable history of what
   * it used to be.
   */
  async reschedule(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: RescheduleEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'active') {
      throw new BusinessRuleError(`a ${doc.status} loan has no schedule to reschedule`);
    }

    const frozen = new Set(await payrollPeriodPort.frozen());
    const planned = await loanInstallmentRepository.plannedForLoan(id);
    const locked = planned.filter((row) => frozen.has(row.period));
    const replaceable = planned.filter((row) => !frozen.has(row.period));
    if (replaceable.length === 0) {
      throw new BusinessRuleError(
        'every remaining installment sits in a closed month — there is nothing left to reschedule',
      );
    }

    const movingMinor = totalMinor(replaceable);
    const proposed = generateSchedule(movingMinor, input.installmentCount, input.firstPeriod);
    assertScheduleTotals(movingMinor, proposed);

    const periods = proposed.map((row) => row.period);
    const lockedPeriods = new Set(locked.map((row) => row.period));
    for (const period of periods) {
      if (frozen.has(period)) {
        throw new BusinessRuleError(
          `${period} has a frozen payroll run — an installment cannot be scheduled into it`,
        );
      }
      if (lockedPeriods.has(period)) {
        throw new BusinessRuleError(
          `${period} already carries an installment that a frozen run has closed`,
        );
      }
    }
    this.assertWithinEmployment(employee, periods);

    const nextSeq = Math.max(0, ...planned.map((row) => row.seq)) + 1;
    await LoanInstallmentModel.updateMany(
      { _id: { $in: replaceable.map((row) => row._id) } },
      { $set: { status: 'cancelled', updatedBy: new Types.ObjectId(ctx.userId) }, $inc: { __v: 1 } },
    ).exec();
    await this.writeSchedule(
      doc,
      proposed.map((row, index) => ({ ...row, seq: nextSeq + index })),
      ctx.userId,
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'schedule.installments',
          old: String(replaceable.length),
          new: String(proposed.length),
        },
        // The same number twice, deliberately: it is the assertion a reviewer is here to make.
        {
          field: 'schedule.amount',
          old: String(fromMinorUnits(movingMinor)),
          new: String(fromMinorUnits(totalMinor(proposed))),
        },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    // The loan document itself is untouched by a reschedule apart from its optimistic version,
    // which is bumped so a stale tab cannot then act on a schedule it never saw.
    return employeeLoanRepository.updateById(id, {} as never, {
      by: ctx.userId,
      version: input.version,
    });
  }

  /**
   * D7-1 — money collected OUTSIDE ECMS.
   *
   * The amount must equal what is still owed, because this decision closes the loan. Its effects
   * are exactly three: the remaining intentions are cancelled, the loan becomes `settled`, and
   * nothing at all happens in payroll — a settlement that emitted a deduction would be claiming
   * one that never occurred.
   */
  async settleExternally(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: SettleEmployeeLoanExternally,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'active') {
      throw new BusinessRuleError(`a ${doc.status} loan has no balance to settle`);
    }
    const remaining = remainingMinorOf(doc);
    const paid = toMinorUnits(input.amount);
    if (paid !== remaining) {
      throw new BusinessRuleError(
        `an external settlement closes the loan, so it must equal the ${String(fromMinorUnits(remaining))} still owed`,
      );
    }
    if (input.attachmentFileId !== undefined) {
      await this.resolveAttachment(ctx, employeeId, input.attachmentFileId);
    }

    await LoanInstallmentModel.updateMany(
      { loanId: new Types.ObjectId(id), status: 'planned', isDeleted: false },
      { $set: { status: 'cancelled', updatedBy: new Types.ObjectId(ctx.userId) }, $inc: { __v: 1 } },
    ).exec();

    const after = await employeeLoanRepository.updateById(
      id,
      {
        status: 'settled',
        externalSettlement: {
          amountMinor: paid,
          reason: input.reason,
          at: new Date(),
          by: new Types.ObjectId(ctx.userId),
        },
        ...(input.attachmentFileId === undefined
          ? {}
          : { attachmentFileId: new Types.ObjectId(input.attachmentFileId) }),
      } as never,
      { by: ctx.userId, version: input.version },
    );
    await this.recordStatus(id, 'active', 'settled', input.reason);
    return after;
  }

  /** The supporting document, uploaded before the request that names it (the HR3-C pattern). */
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
        entityType: LOAN_ATTACHMENT_ENTITY_TYPE,
        entityId: String(employee._id),
        categoryId: await resolveLoanAttachmentsCategoryId(),
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
    query: ListEmployeeLoansQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<EmployeeLoanDoc>> {
    await employeeRepository.getById(employeeId, scope);
    return employeeLoanRepository.listForEmployee(employeeId, query);
  }

  async list(
    query: ListEmployeeLoansQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<EmployeeLoanDoc>> {
    return employeeLoanRepository.listScoped(query, scope);
  }

  /** One loan with its schedule — what the employee's Loans tab reads. */
  async detail(
    employeeId: string,
    id: string,
    scope: ScopeSelector,
  ): Promise<{ loan: EmployeeLoanDoc; installments: LoanInstallmentDoc[] }> {
    await employeeRepository.getById(employeeId, scope);
    const loan = await employeeLoanRepository.getForEmployee(employeeId, id);
    return { loan, installments: await loanInstallmentRepository.forLoan(id) };
  }

  async installmentsFor(
    docs: readonly EmployeeLoanDoc[],
  ): Promise<Map<string, LoanInstallmentDoc[]>> {
    return loanInstallmentRepository.forLoans(docs.map((doc) => String(doc._id)));
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  /**
   * Everything that has to be true for a schedule to be writable at all.
   *
   * Each is a rule that already exists somewhere in payroll, applied here rather than reinvented:
   * the single currency is the one `computeCompensation` refuses to break, the employment span is
   * PY-3's, and the frozen period is PY-9's. What is NOT here is a ceiling of any kind — D4.
   */
  private async assertSchedulable(
    employee: EmployeeDoc,
    principal: number,
    currency: string,
    installmentCount: number,
    firstPeriod: string,
  ): Promise<void> {
    if (principal <= 0) throw new BusinessRuleError('a principal must be positive');
    const basic = employee.employment.salary;
    if (basic !== null && currency !== basic.currency) {
      throw new BusinessRuleError(
        `this employee is paid in ${basic.currency} — a ${currency} loan could not be deducted from it`,
      );
    }
    // Refused here as well as in the generator, so a request that could never produce a schedule
    // fails when it is made rather than months later at the payment desk.
    if (toMinorUnits(principal) < installmentCount) {
      throw new BusinessRuleError(
        `${String(principal)} cannot be split into ${String(installmentCount)} installments — each one would be worth nothing`,
      );
    }

    const periods = periodsFrom(firstPeriod, installmentCount);
    this.assertWithinEmployment(employee, periods);
    await this.assertPeriodsOpen(periods);
  }

  /**
   * The whole schedule must lie inside ONE employment span.
   *
   * Not each month separately: an interval whose ends land in different spans covers the gap
   * between an exit and a rehire, and scheduling a deduction across it is scheduling one for a
   * month nobody worked here. The same reading `spanContaining` gives pay-item assignments.
   */
  private assertWithinEmployment(employee: EmployeeDoc, periods: readonly string[]): void {
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (first === undefined || last === undefined) return;
    const from = payrollPeriodPort.bounds(first).from;
    const to = payrollPeriodPort.bounds(last).to;
    if (spanContaining(employmentSpansOf(employee), from, to) === null) {
      throw new BusinessRuleError(
        `${first}…${last} does not fall inside a single employment period of this employee`,
      );
    }
  }

  private async assertPeriodsOpen(periods: readonly string[]): Promise<void> {
    const frozen = new Set(await payrollPeriodPort.frozen());
    const closed = periods.filter((period) => frozen.has(period));
    if (closed.length > 0) {
      throw new BusinessRuleError(
        `${closed.join(', ')} ${closed.length === 1 ? 'has' : 'have'} a frozen payroll run — an installment cannot be scheduled into a month that has already been priced`,
      );
    }
  }

  /** Idempotent by the same move PY-6 and PY-7 use: `$setOnInsert` under a unique key. */
  private async writeSchedule(
    loan: EmployeeLoanDoc,
    schedule: readonly ScheduledInstallment[],
    by: string,
  ): Promise<void> {
    for (const row of schedule) {
      await LoanInstallmentModel.updateOne(
        { loanId: loan._id, seq: row.seq },
        {
          $setOnInsert: {
            employeeId: loan.employeeId,
            period: row.period,
            amountMinor: row.amountMinor,
            status: 'planned',
            branchId: loan.branchId,
            isDeleted: false,
            createdBy: new Types.ObjectId(by),
            updatedBy: null,
          },
        },
        { upsert: true },
      ).exec();
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
      ref.entityType !== LOAN_ATTACHMENT_ENTITY_TYPE ||
      ref.entityId !== employeeId
    ) {
      throw new BusinessRuleError(
        'the attachment must be uploaded for this employee through the loan attachment endpoint',
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

export const employeeLoanService = new EmployeeLoanService();
