// The IT store: the parts catalogue and the movement ledger (design §2.7, ADR-024).
//
// Two write paths only, and both go through `moveStock`:
//   * `receive`  — a positive movement, entered by hand today and by Procurement one day (ADR-024).
//   * `consume`  — a negative movement, ALWAYS tied to a maintenance order (FR-9). It is called by
//                  the order service inside the completion transaction, and by nothing else.
//
// There is no third path, and in particular no "set on-hand to N": an adjustment that leaves no
// movement is a number nobody can explain six months later.
import { Types, type ClientSession } from 'mongoose';
import {
  ItEvents,
  type CreateItSparePart,
  type ListItSparePartMovementsQuery,
  type ListItSparePartsQuery,
  type Paginated,
  type ReceiveItSparePart,
  type UpdateItSparePart,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import { type AuthContext } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { itSparePartRepository } from './part.repository';
import { itSparePartMovementRepository } from './movement.repository';
import { crossedBelowMin } from './stock-rules';
import { type ItSparePartDoc } from './part.model';
import { type ItSparePartMovementDoc } from './movement.model';

const entityRef = (id: string) => ({ moduleId: 'it', entityType: 'sparePart', entityId: id });

const snapshot = (doc: ItSparePartDoc) => ({
  partCode: doc.partCode,
  name: doc.name,
  unit: doc.unit,
  minQty: doc.minQty,
  active: doc.active,
});

class ItSparePartService {
  async create(input: CreateItSparePart, ctx: AuthContext): Promise<ItSparePartDoc> {
    const clash = await itSparePartRepository.findByCode(input.partCode);
    if (clash !== null) {
      throw new ConflictError(`a spare part with code ${input.partCode} already exists`);
    }
    const doc = await itSparePartRepository.create(
      {
        partCode: input.partCode,
        name: input.name,
        unit: input.unit,
        // Stock arrives through a receipt movement, never as a creation field — otherwise the
        // opening balance would be the one number in the store with no movement behind it.
        onHandQty: 0,
        minQty: input.minQty ?? null,
        active: true,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListItSparePartsQuery): Promise<Paginated<ItSparePartDoc>> {
    return itSparePartRepository.listFiltered(query);
  }

  async getById(id: string): Promise<ItSparePartDoc> {
    return itSparePartRepository.getById(id);
  }

  /** `onHandQty` is absent from the update schema: it moves only through the ledger. */
  async update(id: string, input: UpdateItSparePart, ctx: AuthContext): Promise<ItSparePartDoc> {
    const before = await itSparePartRepository.getById(id);
    const set: Partial<ItSparePartDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.unit !== undefined) set.unit = input.unit;
    if (input.minQty !== undefined) set.minQty = input.minQty;
    if (input.active !== undefined) set.active = input.active;

    const updated = await itSparePartRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * The ledger write, shared by both directions.
   *
   * `moveStock` guards sufficiency IN THE FILTER, so the movement row is only inserted once the
   * `$inc` has actually happened — and both live in one transaction, which is what makes
   * "`onHandQty` can never disagree with the ledger" a property rather than an intention.
   */
  private async writeMovement(
    input: {
      partId: string;
      delta: number;
      orderId: Types.ObjectId | null;
      at: Date;
      note: string | null;
    },
    by: string | null,
    session: ClientSession,
  ): Promise<{ part: ItSparePartDoc; movement: ItSparePartMovementDoc }> {
    const part = await itSparePartRepository.moveStock(input.partId, input.delta, session);
    const movement = await itSparePartMovementRepository.create(
      {
        partId: new Types.ObjectId(input.partId),
        qty: input.delta,
        orderId: input.orderId,
        at: input.at,
        byUserId: by === null ? null : new Types.ObjectId(by),
        note: input.note,
      },
      { by, session },
    );
    return { part, movement };
  }

  /** Receipt: stock into the store. Positive, and never carries an `orderId`. */
  async receive(
    partId: string,
    input: ReceiveItSparePart,
    ctx: AuthContext,
  ): Promise<{ part: ItSparePartDoc; movement: ItSparePartMovementDoc }> {
    const existing = await itSparePartRepository.getById(partId);
    if (!existing.active) {
      throw new BusinessRuleError(`spare part ${existing.partCode} is archived and cannot receive stock`);
    }
    const at = new Date();
    return unitOfWork(async (session) => {
      const result = await this.writeMovement(
        { partId, delta: input.qty, orderId: null, at, note: input.note ?? null },
        ctx.userId,
        session,
      );
      await auditService.record({
        entityRef: entityRef(partId),
        action: 'receive',
        changes: [
          {
            field: 'onHandQty',
            // Derived from the write's own result, so the row is true even if another receipt
            // landed between the pre-check above and this transaction.
            old: result.part.onHandQty - input.qty,
            new: result.part.onHandQty,
          },
        ],
      });
      return result;
    });
  }

  /**
   * Consumption, called by the order service INSIDE the completion transaction (FR-9).
   *
   * It takes the caller's session rather than opening its own, because the parts and the completed
   * order have to land together: an order that says it used three cables while the store says it
   * used none is exactly the drift ADR-024 exists to prevent.
   *
   * Returns the parts that crossed their minimum, so the caller can emit after ITS commit — a
   * warning about a stock level that later rolled back is not a fact.
   */
  async consumeForOrder(
    orderId: Types.ObjectId,
    usages: readonly { partId: string; qty: number }[],
    ctx: AuthContext,
    at: Date,
    session: ClientSession,
  ): Promise<{ partId: string; partCode: string; onHandQty: number; minQty: number }[]> {
    const crossed: { partId: string; partCode: string; onHandQty: number; minQty: number }[] = [];
    for (const usage of usages) {
      const { part } = await this.writeMovement(
        { partId: usage.partId, delta: -usage.qty, orderId, at, note: null },
        ctx.userId,
        session,
      );
      // The level BEFORE is derived from the level after, not re-read: a second read would have to
      // join this transaction to be right, and arithmetic on the value the write returned is both
      // exact and free.
      const before = { onHandQty: part.onHandQty + usage.qty, minQty: part.minQty };
      if (crossedBelowMin(before, part) && part.minQty !== null) {
        crossed.push({
          partId: String(part._id),
          partCode: part.partCode,
          onHandQty: part.onHandQty,
          minQty: part.minQty,
        });
      }
    }
    return crossed;
  }

  /** Emit the below-minimum warnings a completed order produced. Called AFTER the commit. */
  async announceBelowMin(
    crossed: readonly { partId: string; partCode: string; onHandQty: number; minQty: number }[],
  ): Promise<void> {
    for (const part of crossed) {
      await emit(ItEvents.SparePartBelowMin, {
        partId: part.partId,
        partCode: part.partCode,
        onHandQty: part.onHandQty,
        minQty: part.minQty,
      });
    }
  }

  async listMovements(
    query: ListItSparePartMovementsQuery,
  ): Promise<Paginated<ItSparePartMovementDoc>> {
    return itSparePartMovementRepository.listFiltered(query);
  }
}

export const itSparePartService = new ItSparePartService();
