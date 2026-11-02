// «حذف العملية» — a «طلب عهدة», a «استعاضة» (transferred, from before the hold, held or cancelled)
// or a «تسوية» entered by mistake comes off «سجل العهدة», and the deletions have a log of their
// own: «زرار امسح منه استعادة او طلب عهدة او تسوية ووجود سجل للهذة الحركات».
//
// A SOFT delete with a release, in ONE transaction under the fund's lock — the same lock every
// letter and every move writes first, so a delete never interleaves with a charge, a confirm or a
// cancel, and the fund it records on either side is the fund at its own commit:
//
//   1. the live operation (404), at the version the dialog read (409 otherwise);
//   2. «إجمالي العهدة» before it;
//   3. what it had claimed is freed — found by QUERY, never by its snapshot:
//        charge                         → nothing;
//        replenishment (any status)     → every live memo it still holds («لم تُستعَض بعد» again) —
//                                         a cancelled one holds none, so it frees nothing, and a
//                                         memo another replenishment re-took is never touched;
//        settlement                     → each licensing memo it still settles («لم تُسوَّ بعد»);
//   4. the fund after it, in piastres: a charge, a transferred (or legacy) replenishment and a
//      settlement move it by their amount; a held or cancelled replenishment never counted;
//   5. the conditional write that marks it deleted (`isDeleted` + `deletion`) — of two moves on one
//      operation exactly one lands.
//
// Every read already filters `isDeleted: false`, so the operation leaves the ledger, the tiles, the
// dashboard and the dialogs' «الآن» with no change to those reads; the ledger refolds as if it
// never happened. A charge with operations after it may be deleted and the fund may go negative —
// the dialog says so. Letters printed after it keep their figures: signed paper is not rewritten.
// There is no restore.
//
// After the commit: the operation's `delete` audit row, one `statusChange` per freed memo and per
// freed licensing record (each announces itself to the screens that read it), and the receipts
// screen's signal when memos were freed — their receipts are editable again.
import { Types, type ClientSession } from 'mongoose';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  parseFleetSort,
  type DeleteFleetCustodyOperation,
  type FleetCustodyOperationDto,
  type FleetLicenseExpenseKind,
  type ListFleetCustodyDeletedQuery,
  type Paginated,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { NotFoundError, StaleDocumentError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { actorNameOf, actorNamesOf } from '../fleet-actor-name';
import { cairoDayRange, cairoDayStart } from '../fleet-cairo-day';
import {
  FleetLicenseExpenseModel,
  type FleetLicenseExpenseDoc,
} from '../license-expenses/license-expense.model';
import { fleetLicenseExpenseRepository } from '../license-expenses/license-expense.repository';
import { settlementField, settlementOf } from '../license-expenses/license-expense-lock';
import { dayKey, fromPiastres, readCustodyFundTerms, toPiastres } from './custody-fund';
import {
  ensureFundLock,
  lockFund,
  memoRef,
  operationRef,
  operationSnapshot,
  toCustodyOperationDto,
} from './custody-fund.service';
import { signalReceiptsOfMemo } from './custody-memo-guard';
import { fleetCustodyMemoRepository, type ReleasedMemo } from './custody-memo.repository';
import {
  deletionDtoOf,
  operationStatusOf,
  type FleetCustodyOperationDeletionDoc,
  type FleetCustodyOperationDoc,
} from './custody-operation.model';
import { fleetCustodyOperationRepository } from './custody-operation.repository';

const userOid = (by: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(by) ? new Types.ObjectId(by) : null;

const licenseExpenseRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'licenseExpense',
  entityId: id,
});

/** A licensing memo a deleted settlement freed, with the settlement it had. */
interface ReleasedPart {
  expenseId: string;
  part: FleetLicenseExpenseKind;
  settledAt: Date;
}

interface Deleted {
  op: FleetCustodyOperationDoc;
  deletion: FleetCustodyOperationDeletionDoc;
  memos: ReleasedMemo[];
  parts: ReleasedPart[];
}

/**
 * What the delete does to «إجمالي العهدة», in piastres — the fold's own rule: only what is `done`
 * ever moved it (a charge and a settlement always are; a replenishment once transferred, or from
 * before the hold).
 */
export const deletionEffectPiastres = (
  op: Pick<FleetCustodyOperationDoc, 'kind' | 'status' | 'amount'>,
): number => {
  const piastres = toPiastres(op.amount);
  if (op.kind === 'charge') return -piastres;
  if (op.kind === 'settle') return piastres;
  return operationStatusOf(op) === 'done' ? -piastres : 0;
};

/** The fund after the delete, from the fund before it — exact, may be negative. */
export const fundAfterDeleteOf = (
  fundBefore: number,
  op: Pick<FleetCustodyOperationDoc, 'kind' | 'status' | 'amount'>,
): number => fromPiastres(toPiastres(fundBefore) + deletionEffectPiastres(op));

/**
 * Every licensing memo the settlement still settles is «لم تُسوَّ بعد» again — found by the
 * settlement each record carries, inside the transaction; each write is conditional on it.
 */
const releaseParts = async (
  operationId: Types.ObjectId,
  by: string,
  session: ClientSession,
): Promise<ReleasedPart[]> => {
  const records = await FleetLicenseExpenseModel.find({
    isDeleted: false,
    $or: FLEET_LICENSE_EXPENSE_KINDS.map((part) => ({
      [`${settlementField(part)}.operationId`]: operationId,
    })),
  })
    .sort({ date: 1, _id: 1 })
    .session(session)
    .lean<FleetLicenseExpenseDoc[]>()
    .exec();
  const released: ReleasedPart[] = [];
  for (const record of records) {
    for (const part of FLEET_LICENSE_EXPENSE_KINDS) {
      const settlement = settlementOf(record, part);
      if (settlement === null || !settlement.operationId.equals(operationId)) continue;
      const expenseId = String(record._id);
      // Read inside this transaction a moment ago: a miss would be a write another transaction
      // made meanwhile, which the database answers with a conflict and `unitOfWork` retries.
      if (
        await fleetLicenseExpenseRepository.releaseSettlement(
          expenseId,
          part,
          operationId,
          by,
          session,
        )
      ) {
        released.push({ expenseId, part, settledAt: settlement.settledAt });
      }
    }
  }
  return released;
};

/** The direction of «تاريخ الحذف» — the only column the page orders by; newest first. */
const directionOf = (
  query: Pick<ListFleetCustodyDeletedQuery, 'sort' | 'sortBy' | 'sortDir'>,
): 'asc' | 'desc' => {
  const chosen = parseFleetSort(query.sort).find((entry) => entry.by === 'deletedAt');
  if (chosen !== undefined) return chosen.dir;
  return query.sortBy === 'deletedAt' ? query.sortDir : 'desc';
};

class FleetCustodyDeleteService {
  /**
   * «حذف العملية» — the reason is optional, `version` is the operation's as the dialog read it.
   * Gone already (or never there): 404. Changed since it was read — confirmed, cancelled, or
   * deleted by somebody else a moment earlier: 409, and nothing is written.
   */
  async remove(id: string, input: DeleteFleetCustodyOperation, by: string): Promise<void> {
    const byName = await actorNameOf(by);
    // One instant for the whole delete — a retried transaction keeps it.
    const at = new Date();
    await ensureFundLock();
    const deleted = await unitOfWork(async (session): Promise<Deleted> => {
      await lockFund(session);
      const op = await fleetCustodyOperationRepository.findLive(id, session);
      if (op === null) throw new NotFoundError(`custody operation ${id} not found`);
      if (op.__v !== input.version) {
        throw new StaleDocumentError(
          `custody operation ${id} changed since it was opened — read it again before deleting it`,
        );
      }
      const { fundTotal } = await readCustodyFundTerms(session);
      const memos =
        op.kind === 'replenish'
          ? await fleetCustodyMemoRepository.releaseReplenishment(op._id, by, session)
          : [];
      const parts = op.kind === 'settle' ? await releaseParts(op._id, by, session) : [];
      const deletion: FleetCustodyOperationDeletionDoc = {
        reason: input.reason,
        by: userOid(by),
        byName,
        at,
        fundBefore: fundTotal,
        fundAfter: fundAfterDeleteOf(fundTotal, op),
      };
      if (
        !(await fleetCustodyOperationRepository.markDeleted(
          op._id,
          input.version,
          deletion,
          by,
          session,
        ))
      ) {
        throw new StaleDocumentError(`custody operation ${id} changed or was deleted meanwhile`);
      }
      return { op, deletion, memos, parts };
    });
    await this.audit(deleted);
  }

  /** «العمليات المحذوفة» — one page; `from`/`to` are Cairo days of the delete. */
  async deletedList(
    query: ListFleetCustodyDeletedQuery,
  ): Promise<Paginated<FleetCustodyOperationDto>> {
    const page = await fleetCustodyOperationRepository.listDeleted({
      kinds: query.kind,
      from: query.from === undefined ? undefined : cairoDayStart(dayKey(query.from)),
      before: query.to === undefined ? undefined : cairoDayRange(dayKey(query.to)).end,
      dir: directionOf(query),
      page: query.page,
      pageSize: query.pageSize,
    });
    // «سجّلها» for the whole page in one lookup; «حذفها» was frozen with the delete.
    const names = await actorNamesOf(
      page.items.map((doc) => (doc.createdBy == null ? null : String(doc.createdBy))),
    );
    return {
      items: page.items.map((doc) =>
        toCustodyOperationDto(
          doc,
          null,
          doc.createdBy == null ? null : (names.get(String(doc.createdBy)) ?? null),
        ),
      ),
      meta: page.meta,
    };
  }

  /** One deleted operation — what its letter printed and its deletion; it has no place in the fund. */
  async deletedOne(id: string): Promise<FleetCustodyOperationDto> {
    const doc = await fleetCustodyOperationRepository.findDeleted(id);
    if (doc === null) throw new NotFoundError(`deleted custody operation ${id} not found`);
    return toCustodyOperationDto(
      doc,
      null,
      await actorNameOf(doc.createdBy == null ? null : String(doc.createdBy)),
    );
  }

  private async audit({ op, deletion, memos, parts }: Deleted): Promise<void> {
    const opId = String(op._id);
    await auditService.record({
      entityRef: operationRef(opId),
      action: 'delete',
      changes: [
        ...diffChanges(operationSnapshot(op), {}),
        { field: 'deletion', old: null, new: deletionDtoOf({ deletion }) },
      ],
    });
    for (const memo of memos) {
      await auditService.record({
        entityRef: memoRef(memo.id),
        action: 'statusChange',
        changes: [
          { field: 'replenishmentId', old: opId, new: null },
          {
            field: 'replenishedAt',
            old: memo.replenishedAt === null ? null : dayKey(memo.replenishedAt),
            new: null,
          },
          // Only a held memo's hold changed; a transferred one was not held already.
          ...(memo.held ? [{ field: 'replenishmentHeld', old: true, new: false }] : []),
        ],
      });
    }
    // One status change per record, naming each of its memos this delete freed.
    const records = new Map<string, ReleasedPart[]>();
    for (const part of parts)
      records.set(part.expenseId, [...(records.get(part.expenseId) ?? []), part]);
    for (const [expenseId, freed] of records) {
      await auditService.record({
        entityRef: licenseExpenseRef(expenseId),
        action: 'statusChange',
        changes: freed.map((part) => ({
          field: settlementField(part.part),
          old: { operationId: opId, settledAt: dayKey(part.settledAt) },
          new: null,
        })),
      });
    }
    // Their receipts are editable again: the receipts screen reads again (one signal, not one per memo).
    if (memos.length > 0) signalReceiptsOfMemo(opId);
  }
}

export const fleetCustodyDeleteService = new FleetCustodyDeleteService();
