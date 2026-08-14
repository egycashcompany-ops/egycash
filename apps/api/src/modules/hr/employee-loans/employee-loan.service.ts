// Employee loans and advances (P-HR-05) — the obligation, its schedule, and what payroll took.
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
// loan leaves by being repaid: through an external settlement (D7-1) or through payroll.
//
// PHASE B ADDS THE PAYROLL SIDE, and it is deliberately small: two methods that payroll calls
// through ONE port (`dueFor` and `recordDeducted`), plus acceleration and the exit handler. What
// it does NOT add is any knowledge of payroll in this file — no run, no payslip, no compensation
// line. The port hands over an amount and hands back a receipt; the vocabulary on either side of
// it stays its own.
//
// WHAT IS STILL NOT HERE. No interest, no fee, no penalty, no ceiling (D4/D10). No treasury:
// `disburse` RECORDS that money changed hands elsewhere; it moves none.
import { Types } from 'mongoose';
import {
  fromMinorUnits,
  toMinorUnits,
  HrEmployeeLoanEvents,
  HrEmployeeLoanTemplates,
  type AccelerateEmployeeLoan,
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
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { notificationsService } from '../../../platform/notifications';
import { fileService, type FileDoc, type UploadedBinary } from '../../../platform/files';
import { toDateOnly } from '../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../employee-management/employees';
import { employmentSpansOf, spanContaining } from '../payroll/compensation/employment-spans';
import { payrollPeriodPort } from './payroll-period.port';
import {
  accelerateTail,
  assertScheduleTotals,
  generateSchedule,
  periodOfDate,
  periodsFrom,
  totalMinor,
  type ScheduledInstallment,
} from './loan-schedule';
import {
  LOAN_ATTACHMENT_ENTITY_TYPE,
  resolveLoanAttachmentsCategoryId,
} from './employee-loan.files';
import {
  employeeLoanRepository,
  loanInstallmentRepository,
  loanRepaymentRepository,
} from './employee-loan.repository';
import { EmployeeLoanModel, type EmployeeLoanDoc } from './employee-loan.model';
import { LoanInstallmentModel, type LoanInstallmentDoc } from './loan-installment.model';
import { LoanRepaymentModel, type LoanRepaymentDoc } from './loan-repayment.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'employeeLoan', entityId: id });

/**
 * What is still owed, in minor units — DERIVED, never stored.
 *
 * `principal − everything repaid`, and "everything repaid" has two sources: the payroll ledger
 * (P-HR-05-B) and an external settlement if one was recorded (D7-1). A stored copy would be a
 * second chance for the number to be wrong, on exactly the figure an employee will argue about.
 */
export const remainingMinorOf = (loan: EmployeeLoanDoc, repaidMinor: number): number =>
  toMinorUnits(loan.principal) - repaidMinor - (loan.externalSettlement?.amountMinor ?? 0);

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

    await this.assertSchedulable(
      employee,
      input.principal,
      input.currency,
      input.installmentCount,
      input.firstPeriod,
    );

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
    // AFTER the write, and the write is what makes this happen exactly once: `status !== 'draft'`
    // refuses a second submit, and `updateById` filters on `__v`, so a retry with a stale version
    // is a 409 before it reaches this line. There is no path that emits twice for one transition.
    await emit(HrEmployeeLoanEvents.Submitted, {
      loanId: id,
      employeeId,
      type: doc.type,
      principal: doc.principal,
      currency: doc.currency,
      installmentCount: doc.installmentCount,
      firstPeriod: doc.firstPeriod,
    });
    await this.notifySubmitted(employee, after);
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
    // The status guard above has already consumed `pendingApproval`, so a second decision on the
    // same request is refused before it gets here.
    await emit(HrEmployeeLoanEvents.Decided, {
      loanId: id,
      employeeId,
      type: doc.type,
      principal: doc.principal,
      currency: doc.currency,
      decision: input.decision,
    });
    await this.notifyDecided(employee, after, input.decision);
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
    // Checked BEFORE the schedule is written, not only by the update below: a stale caller must be
    // refused while nothing has happened yet, rather than after a set of instalments exists.
    this.assertFresh(doc, input.version);
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
    /**
     * The one of the three that changes what somebody is paid — and it is emitted from AFTER the
     * status flip, which the header above calls the commit point.
     *
     * That ordering is the whole of the idempotency here. `writeSchedule` is `$setOnInsert` under a
     * unique `(loanId, seq)` key and can safely run twice; the status flip cannot, because
     * `status !== 'approved'` refuses a second disbursement and `updateById` filters on `__v`. So a
     * retry that got as far as re-writing rows still reaches this line at most once.
     */
    await emit(HrEmployeeLoanEvents.Disbursed, {
      loanId: id,
      employeeId,
      type: doc.type,
      principal: doc.principal,
      currency: doc.currency,
      disbursedAt: input.disbursedAt,
      installmentCount: doc.installmentCount,
      firstPeriod: doc.firstPeriod,
    });
    await this.notifyDisbursed(employee, after, input.disbursedAt);
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
    // Before anything is cancelled or written: a stale caller is looking at a schedule that has
    // already moved, and refusing them afterwards would leave the tail rewritten anyway.
    this.assertFresh(doc, input.version);

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
    this.assertFresh(doc, input.version);
    const remaining = remainingMinorOf(doc, await loanRepaymentRepository.repaidMinor(id));
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

  /**
   * D7-2 — pay MORE through payroll in one named month, and finish earlier for it.
   *
   * Distinct from an external settlement in the one way that matters: this money will come out of
   * a salary, so it produces a bigger deduction rather than a receipt. The extra is taken out of
   * the LAST instalments — the debt does not change, the calendar does — and the arithmetic lives
   * in the pure `accelerateTail`, where it can be argued with without a database.
   */
  async accelerate(
    ctx: AuthContext,
    employeeId: string,
    id: string,
    input: AccelerateEmployeeLoan,
    scope: ScopeSelector,
  ): Promise<EmployeeLoanDoc> {
    const employee = await employeeRepository.getById(employeeId, scope);
    const doc = await employeeLoanRepository.getForEmployee(employeeId, id);
    if (doc.status !== 'active') {
      throw new BusinessRuleError(`a ${doc.status} loan has no instalments to bring forward`);
    }
    this.assertFresh(doc, input.version);

    const frozen = new Set(await payrollPeriodPort.frozen());
    if (frozen.has(input.period)) {
      throw new BusinessRuleError(
        `${input.period} has a frozen payroll run — its deduction has already been priced`,
      );
    }
    const planned = await loanInstallmentRepository.plannedForLoan(id);
    const target = planned.find((row) => row.period === input.period);
    if (target === undefined) {
      throw new BusinessRuleError(
        `${input.period} carries no planned instalment of this loan to add to`,
      );
    }
    // Only the months nobody has closed may give the extra up. A frozen month's instalment is
    // already somebody's payslip line.
    const later = planned.filter((row) => row.period > input.period && !frozen.has(row.period));

    const replacement = accelerateTail(
      { period: target.period, amountMinor: target.amountMinor },
      later.map((row) => ({ period: row.period, amountMinor: row.amountMinor })),
      toMinorUnits(input.extraAmount),
    );
    assertScheduleTotals(target.amountMinor + totalMinor(later), replacement);
    this.assertWithinEmployment(
      employee,
      replacement.map((row) => row.period),
    );

    const replaced = [target, ...later];
    const nextSeq = Math.max(0, ...planned.map((row) => row.seq)) + 1;
    await LoanInstallmentModel.updateMany(
      { _id: { $in: replaced.map((row) => row._id) } },
      { $set: { status: 'cancelled', updatedBy: new Types.ObjectId(ctx.userId) }, $inc: { __v: 1 } },
    ).exec();
    await this.writeSchedule(
      doc,
      replacement.map((row, index) => ({ ...row, seq: nextSeq + index })),
      ctx.userId,
    );

    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'schedule.acceleratedPeriod', old: null, new: input.period },
        {
          field: 'schedule.installment',
          old: String(fromMinorUnits(target.amountMinor)),
          new: String(fromMinorUnits(target.amountMinor + toMinorUnits(input.extraAmount))),
        },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    return employeeLoanRepository.updateById(id, {} as never, {
      by: ctx.userId,
      version: input.version,
    });
  }

  // ── The payroll seam (P-HR-05-B) ──────────────────────────────────────────
  //
  // Two methods, and payroll reaches both through ONE port file. Nothing about a run, a payslip or
  // a compensation line appears in this class: the port hands over an amount and hands back a
  // receipt, and the vocabulary on either side of it stays its own.

  /**
   * What this employee's month costs in instalments.
   *
   * Two conditions, and both live here rather than at the port — the same reason P-HR-04 put its
   * `approved` filter at the read: a future caller who forgets is exactly what this prevents.
   *
   *   1. the LOAN must be live — `active`, or `settled`/`outstandingAtExit` reached AFTER this
   *      month, since a month already priced does not un-price itself when the debt later closes;
   *   2. the INSTALMENT must be chargeable — `planned` or already `deducted`, never `cancelled`.
   *
   * The second condition is the subtle one: re-reading a past month must show what that month
   * cost, which is PY-8's stance applied to a debt.
   */
  async deductionsDueFor(
    employeeId: string,
    period: string,
  ): Promise<
    { installmentId: string; loanId: string; amountMinor: number; currency: string; reference: string }[]
  > {
    const rows = await loanInstallmentRepository.chargeableForEmployeePeriod(employeeId, period);
    if (rows.length === 0) return [];

    const due: {
      installmentId: string;
      loanId: string;
      amountMinor: number;
      currency: string;
      reference: string;
    }[] = [];
    for (const row of rows) {
      const loan = await employeeLoanRepository.findById(String(row.loanId));
      if (loan === null) continue;
      // A closed loan still owes the months it was open for. `deducted` is the proof that this
      // month was one of them — dropping it because the debt has since been settled would make an
      // issued payslip and a re-read of the same month disagree.
      if (loan.status !== 'active' && row.status !== 'deducted') continue;
      due.push({
        installmentId: String(row._id),
        loanId: String(loan._id),
        amountMinor: row.amountMinor,
        currency: loan.currency,
        reference: loan.reason,
      });
    }
    return due;
  }

  /**
   * Record that a payslip took an instalment — the ONLY thing that turns an intention into a fact.
   *
   * IDEMPOTENT TWICE OVER. The ledger row is written with `$setOnInsert` under the unique
   * `(loanId, period)` key, so a re-issued payslip, a second run over the same month or a retried
   * batch all collide on a row that already exists; and the instalment is only marked `deducted`
   * when this call was the one that inserted it. Re-running the batch is the normal case rather
   * than the exception — PY-7 is built to be re-run — so it must cost the employee nothing.
   */
  async recordDeducted(input: {
    installmentId: string;
    employeeId: string;
    period: string;
    runId: string;
    payslipId: string;
    amountMinor: number;
  }): Promise<boolean> {
    // The instalment knows which loan it belongs to, so the caller does not have to: payroll hands
    // over the row a line came from, and the debt behind it is this side's business.
    const installment = await LoanInstallmentModel.findById(input.installmentId)
      .lean<LoanInstallmentDoc>()
      .exec();
    if (installment === null) return false;
    const loanId = String(installment.loanId);
    const loan = await employeeLoanRepository.findById(loanId);
    if (loan === null) return false;

    const written = await LoanRepaymentModel.updateOne(
      { loanId: new Types.ObjectId(loanId), period: input.period },
      {
        $setOnInsert: {
          installmentId: new Types.ObjectId(input.installmentId),
          employeeId: new Types.ObjectId(input.employeeId),
          runId: new Types.ObjectId(input.runId),
          payslipId: new Types.ObjectId(input.payslipId),
          amountMinor: input.amountMinor,
          branchId: loan.branchId,
          recordedAt: new Date(),
        },
      },
      { upsert: true },
    ).exec();
    if (written.upsertedCount === 0) return false; // already recorded — nothing to do, twice

    await LoanInstallmentModel.updateOne(
      { _id: new Types.ObjectId(input.installmentId), status: 'planned' },
      { $set: { status: 'deducted' }, $inc: { __v: 1 } },
    ).exec();

    await auditService.record({
      entityRef: entityRef(loanId),
      action: 'update',
      changes: [
        { field: 'repayment.period', old: null, new: input.period },
        { field: 'repayment.amount', old: null, new: String(fromMinorUnits(input.amountMinor)) },
        { field: 'repayment.payslipId', old: null, new: input.payslipId },
      ],
    });
    await this.settleIfCleared(loanId);
    return true;
  }

  /**
   * D8 — the employee left. State the fact; decide nothing.
   *
   * Instalments scheduled for months AFTER the exit are withdrawn, because the compensation
   * calculation clips at the employment span and would never price them anyway. If a balance
   * remains the loan says so — `outstandingAtExit` — and that is where this system stops: nothing
   * is taken from a final salary, and nothing is written off. Both of those would be decisions
   * nobody has granted it.
   */
  async onEmployeeExited(employeeId: string, effectiveDate: string): Promise<void> {
    // The date comes from the EVENT, never from a re-read of the employee: this event is emitted
    // from inside the exit's application, before the document is saved, so reading it back here
    // would give the state from before the exit — and the schedule would be cut at the wrong month
    // or not at all.
    const exitPeriod = periodOfDate(toDateOnly(new Date(effectiveDate)));

    const live = await employeeLoanRepository.findLive(employeeId);
    if (live === null) return;
    const loanId = String(live._id);

    const doomed = await loanInstallmentRepository.plannedForEmployeeAfter(employeeId, exitPeriod);
    if (doomed.length > 0) {
      await LoanInstallmentModel.updateMany(
        { _id: { $in: doomed.map((row) => row._id) } },
        { $set: { status: 'cancelled' }, $inc: { __v: 1 } },
      ).exec();
    }

    // A loan that was never paid out is simply cancelled: there is no debt behind it.
    if (live.status !== 'active') {
      await employeeLoanRepository.updateById(
        loanId,
        {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: 'the employee left before the loan was paid out',
        } as never,
        { by: null, version: live.__v },
      );
      await this.recordStatus(loanId, live.status, 'cancelled', 'employee exited');
      return;
    }

    const repaidMinor = await loanRepaymentRepository.repaidMinor(loanId);
    if (remainingMinorOf(live, repaidMinor) <= 0) return; // already clear — an exit changes nothing

    await employeeLoanRepository.updateById(loanId, { status: 'outstandingAtExit' } as never, {
      by: null,
      version: live.__v,
    });
    await this.recordStatus(loanId, 'active', 'outstandingAtExit', 'employee exited');
  }

  /** The last instalment landed: the debt is clear, and the loan says so. */
  private async settleIfCleared(loanId: string): Promise<void> {
    const loan = await employeeLoanRepository.findById(loanId);
    if (loan === null || loan.status !== 'active') return;
    const repaidMinor = await loanRepaymentRepository.repaidMinor(loanId);
    if (remainingMinorOf(loan, repaidMinor) > 0) return;

    await employeeLoanRepository.updateById(loanId, { status: 'settled' } as never, {
      by: null,
      version: loan.__v,
    });
    await this.recordStatus(loanId, 'active', 'settled', 'repaid in full through payroll');
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

  /**
   * The caller's OWN loans (P-HR-18) — own-scope by construction.
   *
   * WHY THIS EXISTS. P-HR-07 made this feature tell the employee twice: their request was decided,
   * and the money was handed over with instalments beginning in a named month. Both notices go to
   * their own login — and until now there was nowhere for them to look. A notice pointing at
   * nothing is worse than silence, because it says the information exists.
   *
   * The employee is resolved from the login link and nothing the caller sends can widen that, so
   * this path carries no permission and no scope selector: there is no wider set to reach. It is
   * the posture `/payslips/me`, `/days/me` and My Leave already have, applied to a debt somebody
   * is repaying out of their own salary — which they are plainly entitled to see.
   */
  async listMine(userId: string, query: ListEmployeeLoansQuery): Promise<Paginated<EmployeeLoanDoc>> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    return employeeLoanRepository.listForEmployee(String(employee._id), query);
  }

  /** One loan with its schedule and what payroll took — what the employee's Loans tab reads. */
  async detail(
    employeeId: string,
    id: string,
    scope: ScopeSelector,
  ): Promise<{
    loan: EmployeeLoanDoc;
    installments: LoanInstallmentDoc[];
    repayments: LoanRepaymentDoc[];
  }> {
    await employeeRepository.getById(employeeId, scope);
    const loan = await employeeLoanRepository.getForEmployee(employeeId, id);
    return {
      loan,
      installments: await loanInstallmentRepository.forLoan(id),
      repayments: await loanRepaymentRepository.forLoan(id),
    };
  }

  /** Both children of a page of loans, in one query each rather than one per row. */
  async childrenFor(docs: readonly EmployeeLoanDoc[]): Promise<{
    installments: Map<string, LoanInstallmentDoc[]>;
    repayments: Map<string, LoanRepaymentDoc[]>;
  }> {
    const ids = docs.map((doc) => String(doc._id));
    return {
      installments: await loanInstallmentRepository.forLoans(ids),
      repayments: await loanRepaymentRepository.forLoans(ids),
    };
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

  /**
   * The optimistic version, checked BEFORE the writes rather than only by the final update.
   *
   * Three operations here write instalments before they touch the loan — disbursement creates a
   * schedule, a reschedule rewrites its tail, a settlement cancels what is left — and each of
   * those is the interesting half of the operation. Letting `updateById` be the only version check
   * would mean a stale caller got their rows written and then a 409, which is the one outcome
   * worse than either answer alone.
   */
  private assertFresh(doc: EmployeeLoanDoc, version: number): void {
    if (version !== doc.__v) {
      throw new ConflictError('this loan was modified — reload and retry');
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

  /**
   * To whoever can end the wait (P-HR-07) — by PERMISSION, not to a manager.
   *
   * Lending is not a line-management decision: `employeeLoan.approve` is what P-HR-05 declared as
   * the authority to agree to lend, and the administration screen P-HR-06-B built is where those
   * people work. Notifying a manager instead would address somebody who cannot act.
   *
   * Best-effort by construction: a failed notice must never undo a decision that was correctly
   * recorded. That is the posture Attendance and Leave already take, and it is why the emit above
   * comes first — the durable fact is the write and the event, not the message.
   */
  private async notifySubmitted(employee: EmployeeDoc, doc: EmployeeLoanDoc): Promise<void> {
    await notificationsService
      .notify({
        template: HrEmployeeLoanTemplates.Submitted,
        to: { permission: 'employeeLoan.approve', scope: 'organization' },
        data: { employeeCode: employee.code, type: doc.type },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /** …and back to the person it is about, if they have a login to receive it. */
  private async notifyDecided(
    employee: EmployeeDoc,
    doc: EmployeeLoanDoc,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    if (employee.userId === null) return;
    await notificationsService
      .notify({
        template: HrEmployeeLoanTemplates.Decided,
        to: { userIds: [String(employee.userId)] },
        data: { type: doc.type, decision },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /**
   * The notice that carries a consequence: instalments start coming off a salary.
   *
   * It states the COUNT and the FIRST MONTH rather than an amount, because those are the two facts
   * an employee needs in order to know what to expect and when — the figure itself is on their own
   * loans tab, behind the permission that governs reading pay.
   */
  private async notifyDisbursed(
    employee: EmployeeDoc,
    doc: EmployeeLoanDoc,
    disbursedAt: string,
  ): Promise<void> {
    if (employee.userId === null) return;
    await notificationsService
      .notify({
        template: HrEmployeeLoanTemplates.Disbursed,
        to: { userIds: [String(employee.userId)] },
        data: {
          type: doc.type,
          disbursedAt,
          installmentCount: String(doc.installmentCount),
          firstPeriod: doc.firstPeriod,
        },
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
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
