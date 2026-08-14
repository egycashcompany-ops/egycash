// The payroll run (PY-6) — the only thing in this system that freezes a period.
//
// THE FREEZE, IN ORDER, AND WHY THE ORDER IS THE DESIGN:
//
//   1. CHECK EVERYTHING FIRST. The period must have ended, the run must still be a draft, and no
//      leave request may still be in flight over it. Nothing is written until all three pass.
//   2. FREEZE ATTENDANCE. `freezePeriod()` — this is its first caller in production, and the one
//      the attendance design named. It is idempotent: its filter is `frozenAt: null`, and a frozen
//      row refuses recomputation.
//   3. SNAPSHOT LEAVE. Each consumption cut to this period, with its own pay split, written under
//      a unique key so a re-run cannot double a row.
//   4. STAMP THE STATUS. Last, and only now.
//
// That order IS the atomicity. An interruption in step 2 or 3 leaves the run in `draft` with some
// rows already frozen — harmless, because freezing a row is final and desirable anyway, and
// pressing freeze again finishes what is left cheaply. The business contract holds because the
// status flip is the commit point: a run is `frozen` only when every fact behind it is.
//
// THERE IS NO UNFREEZE. Cancelling changes the run's status and nothing else.
import { Types } from 'mongoose';
import {
  CANCELLABLE_PAYROLL_RUN_STATUSES,
  type CreatePayrollRun,
  type ListPayrollRunsQuery,
  type Paginated,
  type PayrollLeaveSnapshotDto,
  type PayrollRunDto,
} from '@ecms/contracts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { cairoToday, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { periodRange } from '../compensation/compensation-rules';
import { attendanceFreezePort } from './attendance-freeze.port';
import { leaveFactsPort } from './leave-facts.port';
import { sliceForPeriod } from './leave-allocation';
import { PayrollLeaveSnapshotModel, type PayrollLeaveSnapshotDoc } from './payroll-leave-snapshot.model';
import { PayrollRunModel, type PayrollRunDoc } from './payroll-run.model';
import { payrollRunRepository } from './payroll-run.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'payrollRun', entityId: id });

class PayrollRunService {
  async create(input: CreatePayrollRun, by: string): Promise<PayrollRunDoc> {
    // Checked here for the readable 409; the partial unique index is what holds under a race.
    const live = await PayrollRunModel.findOne({
      period: input.period,
      status: { $in: ['draft', 'frozen'] },
      isDeleted: false,
    })
      .lean()
      .exec();
    if (live !== null) {
      throw new ConflictError(
        `period ${input.period} already has a ${live.status} payroll run — cancel it before starting another`,
      );
    }

    const doc = await payrollRunRepository.create(
      { period: input.period, status: 'draft', note: input.note ?? null },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'period', old: null, new: doc.period }],
    });
    return doc;
  }

  /**
   * Pin every fact this period will be priced from.
   *
   * The three refusals are all about the same thing: a fact that is still moving. A period still
   * being lived has days that have not happened; a leave request still in flight has no ledger
   * entry and therefore no pay split, so freezing around it would snapshot a silent hole.
   */
  async freeze(id: string, version: number, by: string): Promise<PayrollRunDoc> {
    const run = await payrollRunRepository.getById(id);
    if (run.status !== 'draft') {
      throw new BusinessRuleError(`a ${run.status} payroll run cannot be frozen`);
    }
    const window = periodRange(run.period);
    if (window.to.getTime() >= cairoToday().getTime()) {
      throw new BusinessRuleError(
        `period ${run.period} has not ended yet — it can only be frozen once its last day has passed`,
      );
    }

    const unsettled = await leaveFactsPort.unsettledRequestsIn(window);
    if (unsettled > 0) {
      throw new BusinessRuleError(
        `${String(unsettled)} leave request(s) covering ${run.period} are still in flight — settle them before freezing, or their pay split cannot be snapshotted`,
      );
    }

    // 2 — attendance. Idempotent, and the first production caller of the AT-4 seam.
    const frozen = await attendanceFreezePort.freeze(run.period);

    // 3 — leave. Written under a unique key per (run, entry, slice start), so a retried freeze
    // after an interruption re-walks the same entries without doubling one.
    const snapshotAt = new Date();
    let snapshotRows = 0;
    for (const entry of await leaveFactsPort.consumedIn(window)) {
      const slice = sliceForPeriod(entry, window);
      if (slice === null) continue;
      const written = await PayrollLeaveSnapshotModel.updateOne(
        {
          runId: new Types.ObjectId(id),
          ledgerEntryId: new Types.ObjectId(entry.ledgerEntryId),
          from: slice.from,
        },
        {
          $setOnInsert: {
            period: run.period,
            employeeId: new Types.ObjectId(entry.employeeId),
            requestId: entry.requestId === null ? null : new Types.ObjectId(entry.requestId),
            typeId: new Types.ObjectId(entry.typeId),
            typeCode: entry.typeCode,
            to: slice.to,
            days: slice.days,
            breakdown: slice.breakdown,
            allocation: slice.allocation,
            snapshotAt,
            isDeleted: false,
            createdBy: new Types.ObjectId(by),
            updatedBy: null,
          },
        },
        { upsert: true },
      ).exec();
      if (written.upsertedCount > 0) snapshotRows += 1;
    }

    // 4 — the commit point. Everything above succeeded, so the run may now claim to be frozen.
    const updated = await payrollRunRepository.updateById(
      id,
      {
        status: 'frozen',
        frozenAt: new Date(),
        frozenBy: new Types.ObjectId(by),
        attendanceFrozenRows: frozen.frozen,
        attendanceComputedRows: frozen.computed,
        leaveSnapshotRows: snapshotRows,
      },
      { by, version },
    );
    // `statusChange` rather than a new audit action: the shared vocabulary is closed, and the
    // entity ref plus these fields already say exactly what happened.
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: 'draft', new: 'frozen' },
        { field: 'attendanceFrozenRows', old: null, new: String(frozen.frozen) },
        { field: 'leaveSnapshotRows', old: null, new: String(snapshotRows) },
      ],
    });
    return updated;
  }

  /**
   * Abandon a run. Changes the RUN and nothing else (D4).
   *
   * Frozen attendance rows stay frozen — there is no unfreeze in this system — and the snapshot is
   * left exactly as written. A later recalculation is a NEW run over the same period, which the
   * partial unique index allows precisely because a cancelled run no longer occupies it.
   */
  /**
   * Approve the figures a frozen run produced (P-HR-10).
   *
   * ONLY FROM `frozen`, and the order is forced rather than chosen: a payslip is issued FROM a
   * frozen run, so before the freeze there is nothing to approve. Approving a draft would be
   * agreeing with figures that do not exist yet.
   *
   * TWO PEOPLE, the shape every money decision in this system uses (P-HR-04 D1, P-HR-05 D2):
   * whoever froze the run may not approve it. The permission says what you MAY do; it does not say
   * who you are.
   */
  async approve(
    id: string,
    input: { note?: string | undefined; version: number },
    by: string,
  ): Promise<PayrollRunDoc> {
    const run = await payrollRunRepository.getById(id);
    if (run.status !== 'frozen') {
      throw new BusinessRuleError(
        `a ${run.status} run cannot be approved — only a frozen run has figures to approve`,
      );
    }
    if (run.frozenBy !== null && String(run.frozenBy) === by) {
      throw new ForbiddenError('a payroll run cannot be approved by the person who froze it');
    }

    const updated = await payrollRunRepository.updateById(
      id,
      {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: new Types.ObjectId(by),
        approvalNote: input.note ?? null,
      },
      { by, version: input.version },
    );
    await this.recordTransition(id, 'frozen', 'approved', [
      ...(input.note === undefined ? [] : [{ field: 'approvalNote', old: null, new: input.note }]),
    ]);
    return updated;
  }

  /**
   * Record that the payroll was PAID — inside this system, and only that (P-HR-10 §1).
   *
   * ECMS pays nobody. This is the note that a payment happened elsewhere, exactly as a loan
   * disbursement is. There is no bank file, no transfer and no integration behind it, and the
   * payload carries no amount: the figures are the payslips', already frozen and already approved.
   *
   * ONLY FROM `approved`. That is the brief's hardest rule — no payment before approval — and it is
   * a state check before the write rather than a convention.
   */
  async pay(
    id: string,
    input: { paidOn: string; reference?: string | undefined; version: number },
    by: string,
  ): Promise<PayrollRunDoc> {
    const run = await payrollRunRepository.getById(id);
    if (run.status !== 'approved') {
      throw new BusinessRuleError(
        `a ${run.status} run cannot be paid — approve it first`,
      );
    }

    const updated = await payrollRunRepository.updateById(
      id,
      {
        status: 'paid',
        paidAt: new Date(),
        paidBy: new Types.ObjectId(by),
        paidOn: toDateOnly(new Date(input.paidOn)),
        paymentReference: input.reference ?? null,
      },
      { by, version: input.version },
    );
    await this.recordTransition(id, 'approved', 'paid', [
      { field: 'paidOn', old: null, new: input.paidOn },
      ...(input.reference === undefined
        ? []
        : [{ field: 'paymentReference', old: null, new: input.reference }]),
    ]);
    return updated;
  }

  /**
   * Close a paid run. It moves nothing and asserts nothing new — the month is simply finished.
   *
   * ONLY FROM `paid`: closing a month nobody was paid for would be a claim that the payroll is
   * done when the people are still waiting.
   */
  async close(
    id: string,
    input: { note?: string | undefined; version: number },
    by: string,
  ): Promise<PayrollRunDoc> {
    const run = await payrollRunRepository.getById(id);
    if (run.status !== 'paid') {
      throw new BusinessRuleError(`a ${run.status} run cannot be closed — record the payment first`);
    }

    const updated = await payrollRunRepository.updateById(
      id,
      { status: 'closed', closedAt: new Date(), closedBy: new Types.ObjectId(by), note: input.note ?? run.note },
      { by, version: input.version },
    );
    await this.recordTransition(id, 'paid', 'closed', []);
    return updated;
  }

  /** One shape for every governance transition, so none of them can forget to leave a trace. */
  private async recordTransition(
    id: string,
    from: string,
    to: string,
    extra: { field: string; old: string | null; new: string }[],
  ): Promise<void> {
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: from, new: to }, ...extra],
    });
  }

  /**
   * Withdrawing a run — and only while nothing has been paid.
   *
   * `paid` and `closed` are absent from the cancellable set on purpose: once money has left, a
   * status flip cannot call it back, and pretending otherwise is the failure the freeze exists to
   * prevent. A payment recorded in error is corrected in a later period, which is the same
   * forward-only stance the rest of payroll takes about a month that is closed.
   */
  async cancel(id: string, reason: string, version: number, by: string): Promise<PayrollRunDoc> {
    const run = await payrollRunRepository.getById(id);
    if (run.status === 'cancelled') throw new BusinessRuleError('this run is already cancelled');
    if (!CANCELLABLE_PAYROLL_RUN_STATUSES.includes(run.status as 'draft')) {
      throw new BusinessRuleError(
        `a ${run.status} run cannot be cancelled — money has already been recorded as paid`,
      );
    }

    const updated = await payrollRunRepository.updateById(
      id,
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: new Types.ObjectId(by),
        cancelReason: reason,
      },
      { by, version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: run.status, new: 'cancelled' },
        { field: 'cancelReason', old: null, new: reason },
      ],
    });
    return updated;
  }

  async getById(id: string): Promise<PayrollRunDoc> {
    const doc = await payrollRunRepository.findById(id);
    if (doc === null) throw new NotFoundError('payroll run not found');
    return doc;
  }

  async list(query: ListPayrollRunsQuery): Promise<Paginated<PayrollRunDoc>> {
    return payrollRunRepository.list({
      filter: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.period === undefined ? {} : { period: query.period }),
      },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'period',
      sortDir: query.sortDir,
      sortableFields: ['period', 'status', 'frozenAt', 'createdAt'],
    });
  }

  /**
   * The periods that currently have a FROZEN run (PY-9).
   *
   * `frozen` and not `cancelled`, deliberately: a cancelled run no longer speaks for its period —
   * PY-5 stops pricing leave from one and PY-7 refuses to issue from one — so the month is open
   * again for the correction and the new run that will re-pin it. The list is short by nature
   * (one entry per frozen month) and the decision it feeds is pure.
   */
  async frozenPeriods(): Promise<string[]> {
    const rows = await PayrollRunModel.find({ status: 'frozen', isDeleted: false })
      .select({ period: 1 })
      .lean<{ period: string }[]>()
      .exec();
    return rows.map((row) => row.period);
  }

  /** One run's leave snapshot — the frozen answer PY-5 will price against. */
  async snapshotFor(runId: string, employeeId?: string): Promise<PayrollLeaveSnapshotDoc[]> {
    await this.getById(runId);
    return PayrollLeaveSnapshotModel.find({
      runId: new Types.ObjectId(runId),
      isDeleted: false,
      ...(employeeId === undefined ? {} : { employeeId: new Types.ObjectId(employeeId) }),
    })
      .sort({ employeeId: 1, from: 1 })
      .lean<PayrollLeaveSnapshotDoc[]>()
      .exec();
  }

  toDto(doc: PayrollRunDoc): PayrollRunDto {
    const window = periodRange(doc.period);
    return {
      id: String(doc._id),
      period: doc.period,
      from: dateOnlyIso(window.from),
      to: dateOnlyIso(window.to),
      status: doc.status,
      frozenAt: doc.frozenAt === null ? null : doc.frozenAt.toISOString(),
      frozenBy: doc.frozenBy === null ? null : String(doc.frozenBy),
      attendanceFrozenRows: doc.attendanceFrozenRows,
      attendanceComputedRows: doc.attendanceComputedRows,
      leaveSnapshotRows: doc.leaveSnapshotRows,
      approvedAt: doc.approvedAt === null ? null : doc.approvedAt.toISOString(),
      approvedBy: doc.approvedBy === null ? null : String(doc.approvedBy),
      approvalNote: doc.approvalNote,
      paidAt: doc.paidAt === null ? null : doc.paidAt.toISOString(),
      paidBy: doc.paidBy === null ? null : String(doc.paidBy),
      paidOn: doc.paidOn === null ? null : dateOnlyIso(doc.paidOn),
      paymentReference: doc.paymentReference,
      closedAt: doc.closedAt === null ? null : doc.closedAt.toISOString(),
      closedBy: doc.closedBy === null ? null : String(doc.closedBy),
      cancelledAt: doc.cancelledAt === null ? null : doc.cancelledAt.toISOString(),
      cancelledBy: doc.cancelledBy === null ? null : String(doc.cancelledBy),
      cancelReason: doc.cancelReason,
      note: doc.note,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  snapshotToDto(doc: PayrollLeaveSnapshotDoc): PayrollLeaveSnapshotDto {
    return {
      id: String(doc._id),
      runId: String(doc.runId),
      period: doc.period,
      employeeId: String(doc.employeeId),
      ledgerEntryId: String(doc.ledgerEntryId),
      requestId: doc.requestId === null ? null : String(doc.requestId),
      typeId: String(doc.typeId),
      typeCode: doc.typeCode,
      from: dateOnlyIso(toDateOnly(doc.from)),
      to: dateOnlyIso(toDateOnly(doc.to)),
      days: doc.days,
      breakdown: doc.breakdown,
      allocation: doc.allocation,
      snapshotAt: doc.snapshotAt.toISOString(),
    };
  }
}

export const payrollRunService = new PayrollRunService();
