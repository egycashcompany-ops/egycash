// «تحويل إلى فرع» — the rules of moving consumables' stock to another branch's store, pure (no
// database, no request): which store the items leave, what may receive them, and what a transfer
// answers.
//
// «وطبعاً المستهلكات لو مثلاً فى 10 ماوس .. فممكن أنقل 5 لفرع تاني وهكذا» (2026-11-11). Several
// items of ONE store, each with how many, to ONE other store, at once («فوراً») and with no paper
// («لا، السجل كفاية») — the ledger is the record: a `transferredOut` movement in the store it left
// and a `transferredIn` one in the store it reached, sharing one `transferId`.
//
// «Each branch keeps its own stock»: an item is a row per store, one per NAME in a store (the unique
// index `ux_branch_name`). So the units of «Mouse» reach the other store's «Mouse» — made there,
// same name, type and unit, when that store has none — and the name is matched exactly as that
// index compares it. A transfer never re-labels: the receiving item must count in the same unit,
// or five «علبة» would arrive as five «قطعة», and must still take stock (a retired item takes no
// delivery — receive's rule — and a transfer in is a delivery to it).
import {
  type ItConsumableTransferLineDto,
  type ItConsumableTransferResultDto,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';

/**
 * The store every item of a transfer leaves — the ONE branch they are all in. Items of two stores
 * are two transfers (a transfer is one store's shelf to another's, like a memo is one store's
 * paper), and a transfer to the store they are already in moves nothing.
 */
export const transferSourceBranch = (
  items: readonly { branchId: string }[],
  toBranchId: string,
): string => {
  const stores = [...new Set(items.map((item) => item.branchId))];
  const [store] = stores;
  if (store === undefined) throw new NotFoundError('consumable not found');
  if (stores.length > 1) {
    throw new BusinessRuleError(
      "the items of one transfer leave one store: transfer each branch's items on its own",
    );
  }
  if (store === toBranchId) {
    throw new BusinessRuleError('the items are already in that branch; choose another branch');
  }
  return store;
};

/** One unit's name as two stores may have typed it: «قطعة» and « قطعة », «Box» and «box». */
const unitKey = (unit: string): string => unit.trim().toLowerCase();

/** Whether two items count in the same unit — trimmed, case aside. */
export const sameUnit = (a: string, b: string): boolean => unitKey(a) === unitKey(b);

/**
 * Whether the receiving store's item of the same name may take the units — and if not, the
 * refusal: another unit (named, both of them), or a retired item. Null when it may.
 */
export const receivingItemRefusal = (
  source: { code: string; name: string; unit: string },
  receiving: { code: string; unit: string; active: boolean },
): BusinessRuleError | null => {
  if (!sameUnit(source.unit, receiving.unit)) {
    return new BusinessRuleError(
      `«${source.name}» counts in «${source.unit}» here and in «${receiving.unit}» in the receiving store (item ${receiving.code}); make the units agree before transferring it`,
    );
  }
  if (!receiving.active) {
    return new BusinessRuleError(
      `item ${receiving.code} («${source.name}») of the receiving store is inactive and takes no new stock`,
    );
  }
  return null;
};

/** What a transfer answers: its id, the two stores, when, and each line as it was written. */
export const consumableTransferResult = (input: {
  transferId: string;
  fromBranchId: string;
  toBranchId: string;
  at: Date;
  lines: readonly ItConsumableTransferLineDto[];
}): ItConsumableTransferResultDto => ({
  transferId: input.transferId,
  fromBranchId: input.fromBranchId,
  toBranchId: input.toBranchId,
  at: input.at.toISOString(),
  lines: input.lines.map((line) => ({
    fromConsumableId: line.fromConsumableId,
    fromCode: line.fromCode,
    toConsumableId: line.toConsumableId,
    toCode: line.toCode,
    name: line.name,
    unit: line.unit,
    qty: line.qty,
    created: line.created,
  })),
});
