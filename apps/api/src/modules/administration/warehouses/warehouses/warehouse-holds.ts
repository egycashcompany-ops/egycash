// "Does this warehouse hold stock, or does a document not yet ended name it?" (design §3.6) —
// asked by a warehouse's retirement (OD-70 B), answered by the features that put things in it.
//
// The question runs against the import direction: the stock ledger (P5) and every document that
// names a warehouse import this feature, so this feature cannot import them back without closing a
// cycle. It is inverted instead, as HR recruitment's engine inverts its stage bindings: this file
// owns a small registry, and each answering feature registers its checker at module load. None is
// registered in Phase 1 — nothing holds stock and no document exists — so nothing holds a
// warehouse and it retires freely; the rule that reads the answers (`deactivationProblem`) ships
// now, so the first registrant changes no code here.
import {
  ADMINISTRATION_DEACTIVATION_PROBLEMS,
  type AdministrationDeactivationProblem,
} from '@ecms/contracts';

/** One feature's answer for one warehouse: what of it holds the warehouse, or null for nothing. */
export type WarehouseHoldChecker = (
  warehouseId: string,
) => Promise<AdministrationDeactivationProblem | null>;

const checkers: WarehouseHoldChecker[] = [];

/** Called once, at module load, by each feature that can hold a warehouse (P5 onward). */
export const registerWarehouseHoldChecker = (checker: WarehouseHoldChecker): void => {
  checkers.push(checker);
};

/** What holds this warehouse now, each hold once, in the vocabulary's order: none, unregistered. */
export const warehouseHolds = async (
  warehouseId: string,
): Promise<AdministrationDeactivationProblem[]> => {
  const answers = await Promise.all(checkers.map((checker) => checker(warehouseId)));
  return ADMINISTRATION_DEACTIVATION_PROBLEMS.filter((hold) => answers.includes(hold));
};
