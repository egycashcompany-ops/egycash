// A line's custody and its state: hand over · return · suspend · reactivate (FR-19) — «صفحة
// لإدارتهم وتسليمهم».
//
// Named actions, never a PATCH of `status`, exactly as an asset's custody is: each has its own
// guard, history entry and audit action, and each runs in ONE transaction (FR-3) that writes the
// interval, the line's denormalization, the history and — for an employee — the acknowledgment
// they sign. The audit rows are written AFTER the commit: the audit service is not part of the
// transaction, so a row written inside it would outlive a hand-over the database then refused, and
// a retried transaction would write it twice. The «one open interval per line» invariant is the interval collection's partial
// unique index; the status checks below produce the readable refusal, the index is what holds.
//
// A line goes to an EMPLOYEE, on the same «إقرار استلام» a device does, or to a CAR — the SIM in its
// tracker — written as the car's code and plate; a car signs nothing, so it gets no paper.
import { Types } from 'mongoose';
import {
  type AssignItMobileLine,
  type ItMobileLineStatusAction,
  type ReturnItMobileLine,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { logger } from '../../../infrastructure/logging/logger';
import { refuseLeaver, signer } from '../assets/custody.service';
import { readReceiptHolder } from '../assets/receipt-holder';
import { claimReceiptNumber, mobileLineReceiptNumberFor } from '../assets/receipt-number';
import { itMobileLineRepository } from './mobile-line.repository';
import { itMobileLineAssignmentRepository } from './line-assignment.repository';
import { itMobileLineReceiptRepository } from './line-receipt.repository';
import {
  change,
  ensureItMobileLineCollections,
  lineEntityRef,
  writeLineHistory,
} from './line-history';
import { type ItMobileLineDoc } from './mobile-line.model';
import { type ItMobileLineAssignmentDoc } from './line-assignment.model';
import { type ItMobileLineReceiptDoc, type ItMobileLineReceiptLineSub } from './line-receipt.model';

/**
 * Only a line in stock is handed over — one message for the hand-over and for the paper printed
 * before it, so nobody signs for a line the system then refuses to hand them.
 */
export const refuseUnlessInStock = (line: ItMobileLineDoc): void => {
  if (line.status === 'assigned') {
    throw new ConflictError(`line ${line.phoneNumber} is already handed over; return it first`);
  }
  if (line.status === 'suspended') {
    throw new BusinessRuleError(
      `line ${line.phoneNumber} is suspended; reactivate it before handing it over`,
    );
  }
};

/** What the paper says about the line — a snapshot, so a reprint shows what was signed. */
export const receiptLineOf = (
  line: ItMobileLineDoc,
  assignmentId: Types.ObjectId,
): ItMobileLineReceiptLineSub => ({
  lineId: line._id,
  assignmentId,
  network: line.network,
  phoneNumber: line.phoneNumber,
  simKind: line.simKind,
  simSerial: line.simSerial ?? null,
  ratePlan: line.ratePlan ?? null,
  accountNumber: line.accountNumber ?? null,
});

/** The audit row for a line acknowledgment: who signed for which number. */
export const auditLineReceiptIssued = async (
  receiptId: Types.ObjectId,
  employeeId: string,
  phoneNumber: string,
): Promise<void> => {
  await auditService.record({
    entityRef: { moduleId: 'it', entityType: 'mobileLineReceipt', entityId: String(receiptId) },
    action: 'create',
    changes: [change('employeeId', null, employeeId), change('phoneNumber', null, phoneNumber)],
  });
};

/** The holder an interval names, for the audit trail: the employee's id, or the car as written. */
const holderOf = (assignment: ItMobileLineAssignmentDoc): unknown =>
  assignment.holderKind === 'employee'
    ? String(assignment.assignedToEmployeeId)
    : { vehicleCode: assignment.vehicleCode, vehiclePlate: assignment.vehiclePlate };

export interface ItMobileLineAssignResult {
  line: ItMobileLineDoc;
  assignment: ItMobileLineAssignmentDoc;
  receipt: ItMobileLineReceiptDoc | null;
}

class ItMobileLineCustodyService {
  /**
   * Hand a line over — to an employee, on a paper they sign, or to a car, on none.
   *
   * For an employee, HR is asked BEFORE the transaction (another module's data has no business
   * holding a custody write open), a leaver is refused (`refuseLeaver`, «اللى موجود بس»), and the
   * paper's number is taken there too: the one printed for this hand-over, or the next one — and
   * so a retry of the transaction never takes a second.
   */
  async assign(
    lineId: string,
    input: AssignItMobileLine,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItMobileLineAssignResult> {
    const at = input.assignedAt ?? new Date();
    const employeeId = input.employeeId ?? null;
    const holder = employeeId === null ? null : await readReceiptHolder(employeeId);
    if (holder !== null) refuseLeaver(holder.employee);
    await ensureItMobileLineCollections();
    const formNumber = holder === null ? null : await mobileLineReceiptNumberFor(input.formNumber);
    // Allocated up front so the interval can name its paper as it is created.
    const receiptId = holder === null ? null : new Types.ObjectId();
    const vehicleCode = employeeId === null ? (input.vehicleCode ?? null) : null;
    const vehiclePlate = employeeId === null ? (input.vehiclePlate ?? null) : null;

    const done = await unitOfWork(async (session) => {
      const line = await itMobileLineRepository.getByIdForUpdate(lineId, scope, session);
      refuseUnlessInStock(line);

      const assignment = await itMobileLineAssignmentRepository.create(
        {
          lineId: line._id,
          holderKind: employeeId === null ? 'vehicle' : 'employee',
          assignedToEmployeeId: employeeId === null ? null : new Types.ObjectId(employeeId),
          vehicleCode,
          vehiclePlate,
          assignedByUserId: new Types.ObjectId(ctx.userId),
          assignedAt: at,
          returnedAt: null,
          returnedToUserId: null,
          notes: input.notes ?? null,
          branchId: line.branchId,
          receiptId,
        },
        { by: ctx.userId, session },
      );

      const updated = await itMobileLineRepository.updateById(
        lineId,
        { status: 'assigned', currentAssignmentId: assignment._id },
        { by: ctx.userId, version: line.__v, session, scope },
      );

      await writeLineHistory(
        {
          lineId,
          type: 'assigned',
          at,
          // Every key, null where it does not apply: the history reads one shape for both holders.
          metadata: {
            assignmentId: String(assignment._id),
            holderKind: assignment.holderKind,
            employeeId,
            employeeCode: holder?.employeeCode ?? null,
            employeeName: holder?.employeeName ?? null,
            vehicleCode,
            vehiclePlate,
            receiptId: receiptId === null ? null : String(receiptId),
            formNumber,
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      let receipt: ItMobileLineReceiptDoc | null = null;
      if (holder !== null && employeeId !== null && receiptId !== null && formNumber !== null) {
        await claimReceiptNumber(formNumber, session);
        receipt = await itMobileLineReceiptRepository.create(
          {
            _id: receiptId,
            formNumber,
            employeeId: new Types.ObjectId(employeeId),
            ...signer(holder),
            issuedAt: at,
            issuedByUserId: new Types.ObjectId(ctx.userId),
            branchId: line.branchId,
            line: receiptLineOf(line, assignment._id),
            signedCopy: null,
          },
          { by: ctx.userId, session },
        );
      }

      return { line: updated, assignment, receipt, from: line.status };
    });

    await auditService.record({
      entityRef: lineEntityRef(lineId),
      action: 'assign',
      changes: [
        change('status', done.from, 'assigned'),
        change('holder', null, holderOf(done.assignment)),
      ],
    });
    if (done.receipt !== null && employeeId !== null) {
      await auditLineReceiptIssued(done.receipt._id, employeeId, done.line.phoneNumber);
    }
    return { line: done.line, assignment: done.assignment, receipt: done.receipt };
  }

  /** Return: closes the open interval and puts the line back in stock. */
  async returnLine(
    lineId: string,
    input: ReturnItMobileLine,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<{ line: ItMobileLineDoc; assignment: ItMobileLineAssignmentDoc }> {
    const at = input.returnedAt ?? new Date();
    await ensureItMobileLineCollections();
    const done = await unitOfWork(async (session) => {
      const line = await itMobileLineRepository.getByIdForUpdate(lineId, scope, session);
      const open =
        line.status === 'assigned'
          ? await itMobileLineAssignmentRepository.findOpenForLine(lineId, session)
          : null;
      if (open === null) {
        throw new ConflictError(`line ${line.phoneNumber} is not handed over to anyone`);
      }
      if (at.getTime() < open.assignedAt.getTime()) {
        throw new BusinessRuleError('the return cannot precede the hand-over it closes');
      }

      // `returnedAt` is what closes it, so the partial unique index frees the line at once.
      const closed = await itMobileLineAssignmentRepository.updateById(
        String(open._id),
        { returnedAt: at, returnedToUserId: new Types.ObjectId(ctx.userId) },
        { by: ctx.userId, version: open.__v, session },
      );

      const updated = await itMobileLineRepository.updateById(
        lineId,
        { status: 'inStock', currentAssignmentId: null },
        { by: ctx.userId, version: line.__v, session, scope },
      );

      await writeLineHistory(
        {
          lineId,
          type: 'returned',
          at,
          metadata: {
            assignmentId: String(open._id),
            holderKind: open.holderKind,
            employeeId:
              open.assignedToEmployeeId === null ? null : String(open.assignedToEmployeeId),
            vehicleCode: open.vehicleCode,
            vehiclePlate: open.vehiclePlate,
          },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      return { line: updated, assignment: closed, from: line.status, open };
    });

    await auditService.record({
      entityRef: lineEntityRef(lineId),
      action: 'return',
      changes: [
        change('status', done.from, 'inStock'),
        change('holder', holderOf(done.open), null),
      ],
    });
    return { line: done.line, assignment: done.assignment };
  }

  /** Suspend — stopped on the network. Only a line in stock: a held line is returned first. */
  async suspend(
    lineId: string,
    input: ItMobileLineStatusAction,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItMobileLineDoc> {
    return this.changeStatus(lineId, 'suspended', input, ctx, scope);
  }

  /** Reactivate — back in stock, to be handed over again. Only a suspended line. */
  async reactivate(
    lineId: string,
    input: ItMobileLineStatusAction,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItMobileLineDoc> {
    return this.changeStatus(lineId, 'inStock', input, ctx, scope);
  }

  private async changeStatus(
    lineId: string,
    to: 'suspended' | 'inStock',
    input: ItMobileLineStatusAction,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItMobileLineDoc> {
    const at = input.at ?? new Date();
    await ensureItMobileLineCollections();
    const done = await unitOfWork(async (session) => {
      const line = await itMobileLineRepository.getByIdForUpdate(lineId, scope, session);
      if (to === 'suspended' && line.status !== 'inStock') {
        throw new BusinessRuleError(
          line.status === 'assigned'
            ? `line ${line.phoneNumber} is handed over; return it before suspending it`
            : `line ${line.phoneNumber} is already suspended`,
        );
      }
      if (to === 'inStock' && line.status !== 'suspended') {
        throw new BusinessRuleError(`line ${line.phoneNumber} is not suspended`);
      }

      const updated = await itMobileLineRepository.updateById(
        lineId,
        { status: to },
        { by: ctx.userId, version: line.__v, session, scope },
      );

      await writeLineHistory(
        {
          lineId,
          type: to === 'suspended' ? 'suspended' : 'reactivated',
          at,
          metadata: { from: line.status, to },
          notes: input.notes ?? null,
        },
        ctx,
        session,
      );

      return { line: updated, from: line.status };
    });

    await auditService.record({
      entityRef: lineEntityRef(lineId),
      action: 'statusChange',
      changes: [change('status', done.from, to)],
    });
    return done.line;
  }

  /**
   * `hr.employee.exited` — the leaver's lines are RECORDED, never auto-returned, exactly as their
   * devices are (FR-13): a return is a thing somebody witnesses, and writing one because HR
   * closed a record would put a custody fact in the chain that never happened.
   */
  async flagMobileLinesHeldByExitedEmployee(employeeId: string): Promise<number> {
    const open = await itMobileLineAssignmentRepository.listOpenForEmployee(employeeId);
    if (open.length === 0) return 0;
    logger.warn(
      { employeeId, assignments: open.length },
      'employee exited while still holding mobile lines — the return must be recorded by a human (FR-13)',
    );
    for (const assignment of open) {
      await auditService.record({
        entityRef: lineEntityRef(String(assignment.lineId)),
        action: 'alertRaised',
        changes: [change('heldByExitedEmployee', null, employeeId)],
      });
    }
    return open.length;
  }
}

export const itMobileLineCustodyService = new ItMobileLineCustodyService();
