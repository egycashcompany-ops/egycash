// «تحويل إلى فرع» — consumables' stock from one branch's store to another's: «لو مثلاً فى 10 ماوس ..
// فممكن أنقل 5 لفرع تاني وهكذا» (2026-11-11). The rules are `consumable-transfer.ts`; this writes
// them.
//
// ONE action, ONE transaction, ONE `transferId`: every line leaves its store and reaches the other
// or none does. Per line, three writes move together — the source item's on hand down (guarded in
// the update's filter, as an issue's and a scrap's take is: never below zero), the receiving item's
// on hand up (that store's item of the same name, made there when it has none — its code reserved
// inside the transaction, so a refused transfer gives the number back), and the PAIR of movements
// that say so, one in each store's ledger. Recorded at once and with no paper: there is no «in
// transit» and nothing to confirm at the other end («فوراً», «السجل كفاية»).
//
// The audit rows follow the commit, as every stock write's do — the audit service is not part of
// the transaction — and through them the refresh signal reaches BOTH stores.
import { Types } from 'mongoose';
import {
  type ItConsumableTransferLineDto,
  type ItConsumableTransferResultDto,
  type TransferItConsumables,
} from '@ecms/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { keyReachesBranch, type AuthContext, type ScopeSelector } from '../../../shared/types';
import { branchRepository } from '../../../platform/organization';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { reserveSequenceBlock } from '../shared/sequence';
import { CONSUMABLE_SEQUENCE_KEY, formatConsumableCode } from './consumable-number';
import { beforeStockEffect, stockEffect, type StockEffect } from './consumable-stock';
import { itConsumableRepository } from './consumable.repository';
import { itConsumableMovementRepository } from './consumable-movement.repository';
import {
  auditConsumableCreated,
  auditStockMovement,
  change,
  consumableItemRow,
  consumableMovementRow,
  ensureItConsumableCollections,
} from './consumable-history';
import {
  consumableTransferResult,
  receivingItemRefusal,
  transferSourceBranch,
} from './consumable-transfer';
import { type ItConsumableDoc } from './consumable.model';
import { type ItConsumableMovementDoc } from './consumable-movement.model';

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** One line as the transaction wrote it — what the commit then audits and answers. */
interface WrittenLine {
  qty: number;
  /** The item it left, as it now stands. */
  from: ItConsumableDoc;
  /** The item it reached, as it now stands. */
  to: ItConsumableDoc;
  /** The receiving store had no item of that name: this transfer made it (as it was made). */
  made: ItConsumableDoc | null;
  out: ItConsumableMovementDoc;
  in: ItConsumableMovementDoc;
  outEffect: StockEffect;
  inEffect: StockEffect;
}

class ItConsumableTransferService {
  /**
   * Move every line's quantity from the one store its items are in to `toBranchId`'s.
   *
   * Refused before anything is written: a branch the caller's `itAsset.assign` does not reach
   * (403), an item they cannot see (404 — read under that grant's scope), items of two stores or a
   * transfer to the store they are in (422), a branch that is not there or not active (400). Inside
   * the transaction, refusing the whole transfer: more than a store holds, and a receiving item
   * that counts in another unit or is retired (422). A RETIRED source item may still send its stock
   * out — like a scrap, it empties its shelf.
   */
  async transfer(
    input: TransferItConsumables,
    ctx: AuthContext,
    scope: ScopeSelector,
  ): Promise<ItConsumableTransferResultDto> {
    // An id as the database spells it, once, and only this from here on: `objectId()` admits
    // upper-case hex, and an upper-case copy of the items' own store must read as «the same store»
    // — not slip past it and write a transfer from a shelf to itself.
    const toBranchId = input.toBranchId.toLowerCase();
    if (!keyReachesBranch(ctx, 'itAsset.assign', toBranchId)) {
      throw new ForbiddenError('itAsset.assign does not reach this branch');
    }

    const found = await itConsumableRepository.findManyByIds(
      input.lines.map((line) => line.consumableId),
      scope,
    );
    const items = new Map(found.map((item) => [String(item._id), item]));
    if (input.lines.some((line) => !items.has(line.consumableId))) {
      throw new NotFoundError('consumable not found');
    }
    const fromBranchId = transferSourceBranch(
      found.map((item) => ({ branchId: String(item.branchId) })),
      toBranchId,
    );
    const branch = await branchRepository.findById(toBranchId);
    if (branch === null || branch.status !== 'active') {
      throw new ValidationError([
        { field: 'body.toBranchId', code: 'UNKNOWN', message: 'branch not found or inactive' },
      ]);
    }

    const at = input.at ?? new Date();
    const notes = input.notes ?? null;
    const by = ctx.userId;
    const source = new Types.ObjectId(fromBranchId);
    const target = new Types.ObjectId(toBranchId);
    // Allocated up front, so every movement of the transfer can name it as it is written.
    const transferId = new Types.ObjectId();
    await ensureItConsumableCollections();

    const written = await unitOfWork(async (session) => {
      const lines: WrittenLine[] = [];
      for (const line of input.lines) {
        const outEffect = stockEffect('transferredOut', line.qty);
        const inEffect = stockEffect('transferredIn', line.qty);
        // 1. Out of its store, under the caller's scope; no `activeFor` — a retired item may still
        //    send what is left of it to another shelf.
        const from = await itConsumableRepository.moveStock(line.consumableId, outEffect, {
          session,
          by,
          scope,
        });

        // 2. The receiving store's item of the SAME name — exactly as `ux_branch_name` compares
        //    it — read in this transaction; made there when that store has none.
        let receiving = await itConsumableRepository.findByBranchAndName(
          target,
          from.name,
          undefined,
          session,
        );
        let made: ItConsumableDoc | null = null;
        if (receiving === null) {
          const seq = await reserveSequenceBlock(CONSUMABLE_SEQUENCE_KEY, 1, session);
          try {
            made = await itConsumableRepository.create(
              consumableItemRow({
                code: formatConsumableCode(seq),
                name: from.name,
                typeId: from.typeId,
                unit: from.unit,
                branchId: target,
                minQty: null,
                notes: null,
                openingQty: null,
              }),
              { by, session },
            );
          } catch (error) {
            // Somebody added that name to the receiving store a moment ago: the index holds, and
            // the transfer — none of it — is written.
            if (isDuplicateKey(error)) {
              throw new ConflictError(
                `«${from.name}» was just added to the receiving store; try the transfer again`,
              );
            }
            throw error;
          }
          receiving = made;
        } else {
          const refusal = receivingItemRefusal(from, receiving);
          if (refusal !== null) throw refusal;
        }

        // 3. Into the receiving store. NOT under the caller's read scope: the receiving store is
        //    judged by the reach check above — the command bar may have narrowed the scope to the
        //    store the items leave — and a retired item is refused in the filter, as a delivery is.
        const to = await itConsumableRepository.moveStock(String(receiving._id), inEffect, {
          session,
          by,
          activeFor: 'receive',
        });

        // 4. The pair, one in each store's ledger, naming each other.
        const out = await itConsumableMovementRepository.create(
          consumableMovementRow({
            item: from,
            kind: 'transferredOut',
            qty: line.qty,
            at,
            byUserId: by,
            notes,
            transferId,
            counterpartBranchId: target,
            counterpartConsumableId: to._id,
          }),
          { by, session },
        );
        const into = await itConsumableMovementRepository.create(
          consumableMovementRow({
            item: to,
            kind: 'transferredIn',
            qty: line.qty,
            at,
            byUserId: by,
            notes,
            transferId,
            counterpartBranchId: source,
            counterpartConsumableId: from._id,
          }),
          { by, session },
        );
        lines.push({ qty: line.qty, from, to, made, out, in: into, outEffect, inEffect });
      }
      return lines;
    });

    // After the commit, line by line: the item it left, the item made for it (if one was), the item
    // it reached — each on its own trail, each store's screens refreshed by its own signal.
    for (const line of written) {
      await auditStockMovement({
        consumableId: String(line.from._id),
        kind: 'transferredOut',
        before: beforeStockEffect(line.from, line.outEffect),
        after: line.from,
        extra: [
          change('movementId', null, String(line.out._id)),
          change('transferId', null, String(transferId)),
          change('toBranchId', null, toBranchId),
          change('toConsumableId', null, String(line.to._id)),
        ],
      });
      if (line.made !== null) await auditConsumableCreated(line.made);
      await auditStockMovement({
        consumableId: String(line.to._id),
        kind: 'transferredIn',
        before: beforeStockEffect(line.to, line.inEffect),
        after: line.to,
        extra: [
          change('movementId', null, String(line.in._id)),
          change('transferId', null, String(transferId)),
          change('fromBranchId', null, fromBranchId),
          change('fromConsumableId', null, String(line.from._id)),
        ],
      });
    }

    return consumableTransferResult({
      transferId: String(transferId),
      fromBranchId,
      toBranchId,
      at,
      lines: written.map((line): ItConsumableTransferLineDto => ({
        fromConsumableId: String(line.from._id),
        fromCode: line.from.code,
        toConsumableId: String(line.to._id),
        toCode: line.to.code,
        name: line.from.name,
        unit: line.from.unit,
        qty: line.qty,
        created: line.made !== null,
      })),
    });
  }
}

export const itConsumableTransferService = new ItConsumableTransferService();
