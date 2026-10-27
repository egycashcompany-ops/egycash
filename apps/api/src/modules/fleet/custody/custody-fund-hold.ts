// A held «استعاضة» moves on — once, and only one way: «تأكيد التحويل» (the money arrived on a day:
// the replenishment is `done` from that day and the fund rises by what its letter printed), or
// «إلغاء الاستعاضة المعلّقة» (it is `cancelled`, never counts, and its memos are free again).
//
// Each is one transaction under the fund's lock — a confirm moves the fund, so a charge or a
// settlement recorded at the same moment must not snapshot a stale one — and each writes its
// change only while the replenishment IS still held (`leaveHeld`), so of two moves at once exactly
// one lands. Its memos move in the same transaction, every one it took or nothing at all. Neither
// touches a figure the letter printed: `amount`, `fundBefore`, `chargedTotal`, `letterFigure`,
// `signatures` and `memos` stay as they were. A cancel is a status, never a delete.
import { Types, type ClientSession } from 'mongoose';
import {
  type CancelFleetCustodyReplenishment,
  type ConfirmFleetCustodyTransfer,
  type FleetCustodyOperationDto,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../shared/errors';
import { actorNameOf } from '../fleet-actor-name';
import { dayKey, utcDay } from './custody-fund';
import {
  ensureFundLock,
  fleetCustodyFundService,
  lockFund,
  memoRef,
  operationRef,
} from './custody-fund.service';
import { signalReceiptsOfMemo } from './custody-memo-guard';
import { fleetCustodyMemoRepository } from './custody-memo.repository';
import {
  cancellationDtoOf,
  operationStatusOf,
  transferDtoOf,
  type FleetCustodyOperationDoc,
} from './custody-operation.model';
import { fleetCustodyOperationRepository, type LeaveHeld } from './custody-operation.repository';

const userOid = (by: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(by) ? new Types.ObjectId(by) : null;

interface Moved {
  op: FleetCustodyOperationDoc;
  next: LeaveHeld;
  memoIds: string[];
}

interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

/**
 * The one transaction both moves share: the fund's lock, the live replenishment (404; not a
 * replenishment 422; no longer held 409), `change` (which may still refuse), the conditional write
 * of the status, then the memos — every one it took, or nothing at all (409).
 */
const leaveHeld = async (
  id: string,
  by: string,
  change: (op: FleetCustodyOperationDoc) => LeaveHeld,
  moveMemos: (
    memoIds: string[],
    op: FleetCustodyOperationDoc,
    session: ClientSession,
  ) => Promise<number>,
): Promise<Moved> => {
  await ensureFundLock();
  return unitOfWork(async (session) => {
    await lockFund(session);
    const op = await fleetCustodyOperationRepository.findLive(id, session);
    if (op === null) throw new NotFoundError(`custody operation ${id} not found`);
    if (op.kind !== 'replenish') {
      throw new BusinessRuleError(
        `custody operation ${id} is a ${op.kind} — only a replenishment waits for a transfer`,
      );
    }
    const status = operationStatusOf(op);
    if (status !== 'held') {
      const letter = dayKey(op.date);
      const on = op.transfer == null ? '' : ` on ${dayKey(op.transfer.date)}`;
      throw new ConflictError(
        status === 'done'
          ? `the replenishment of ${letter} was already transferred${on}`
          : `the replenishment of ${letter} was cancelled`,
      );
    }
    const next = change(op);
    if (!(await fleetCustodyOperationRepository.leaveHeld(op._id, next, by, session))) {
      throw new ConflictError('the replenishment was confirmed or cancelled meanwhile');
    }
    const memoIds = (op.memos ?? []).map((memo) => String(memo.memoId));
    if ((await moveMemos(memoIds, op, session)) !== memoIds.length) {
      throw new ConflictError('a memo of this replenishment changed meanwhile — try again');
    }
    return { op, next, memoIds };
  });
};

/** After a move commits: the operation's status change, each memo's, and the receipts' signal. */
const auditMove = async (
  moved: Moved,
  memoChanges: (letterDay: string) => FieldChange[],
): Promise<void> => {
  const opId = String(moved.op._id);
  const after = { ...moved.op, ...moved.next };
  await auditService.record({
    entityRef: operationRef(opId),
    action: 'statusChange',
    changes: [
      { field: 'status', old: 'held', new: moved.next.status },
      moved.next.status === 'done'
        ? { field: 'transfer', old: null, new: transferDtoOf(after) }
        : { field: 'cancellation', old: null, new: cancellationDtoOf(after) },
    ],
  });
  const changes = memoChanges(dayKey(moved.op.date));
  for (const memoId of moved.memoIds) {
    await auditService.record({ entityRef: memoRef(memoId), action: 'statusChange', changes });
  }
  // Their receipts' locks follow: the receipts screen reads again (one signal, not one per memo).
  if (moved.memoIds.length > 0) signalReceiptsOfMemo(opId);
};

class FleetCustodyHoldService {
  /**
   * «تأكيد التحويل» — the money arrived on `input.date`: the replenishment is `done` from that
   * day, the fund rises by what its letter printed, and its memos are replenished from that day.
   * Only the day is required, and it is never before the letter's (422). Already transferred or
   * cancelled: 409.
   */
  async confirmTransfer(
    id: string,
    input: ConfirmFleetCustodyTransfer,
    by: string,
  ): Promise<FleetCustodyOperationDto> {
    const day = utcDay(input.date);
    const byName = await actorNameOf(by);
    const at = new Date();
    const moved = await leaveHeld(
      id,
      by,
      (op) => {
        if (day.getTime() < utcDay(op.date).getTime()) {
          throw new BusinessRuleError(
            `the transfer day ${dayKey(day)} is before the letter's day ${dayKey(op.date)}`,
          );
        }
        const transfer = {
          date: day,
          reference: input.reference,
          note: input.note,
          by: userOid(by),
          byName,
          at,
        };
        return { status: 'done', transfer };
      },
      (memoIds, op, session) =>
        fleetCustodyMemoRepository.markTransferred(memoIds, op._id, day, by, session),
    );
    await auditMove(moved, (letterDay) => [
      { field: 'replenishedAt', old: letterDay, new: dayKey(day) },
      { field: 'replenishmentHeld', old: true, new: false },
    ]);
    return fleetCustodyFundService.operation(id);
  }

  /**
   * «إلغاء الاستعاضة المعلّقة» — the replenishment is `cancelled`: its row, its letter and its
   * signatures stay, and it never counts. Its memos are free again — back to «لم تُستعَض بعد»,
   * editable, offered to the next replenishment. Nothing is required. Already transferred or
   * cancelled: 409.
   */
  async cancelHeld(
    id: string,
    input: CancelFleetCustodyReplenishment,
    by: string,
  ): Promise<FleetCustodyOperationDto> {
    const byName = await actorNameOf(by);
    const at = new Date();
    const moved = await leaveHeld(
      id,
      by,
      () => ({
        status: 'cancelled',
        cancellation: { reason: input.reason, by: userOid(by), byName, at },
      }),
      (memoIds, op, session) =>
        fleetCustodyMemoRepository.releaseHeld(memoIds, op._id, by, session),
    );
    await auditMove(moved, (letterDay) => [
      { field: 'replenishmentId', old: String(moved.op._id), new: null },
      { field: 'replenishedAt', old: letterDay, new: null },
      { field: 'replenishmentHeld', old: true, new: false },
    ]);
    return fleetCustodyFundService.operation(id);
  }
}

export const fleetCustodyHoldService = new FleetCustodyHoldService();
