// An item category's pure rules (design §2.3.3, §5.3, §5.15): where it may sit, what a retired one
// still allows, and what keeps one from retiring. No database and no clock: the service reads the
// facts, these decide.
//
// Two levels (OD-06 A): a parent must itself be top level, so a subcategory never has children and
// a category that has them never moves under another. So the only cycle one write can ask for is
// a pair — a category asked to sit under one of its own subcategories — named apart from "too
// deep" because it is a different mistake to correct.
//
// Each write is judged on what it reads, outside any transaction, so two writes at once can each
// pass and together leave what neither was allowed: a move racing a child create under the moved
// category leaves three levels, and two crossing moves of two childless top-level categories, A
// under B and B under A, leave each the other's parent and neither a root. Both need two catalog
// managers on the same two rows at one moment: accepted for Phase 1 (§19.7), and both are repaired
// by an edit — a move to the top level, which no rule refuses.
import { ErrorCodes, type AdministrationCategoryParentProblem } from '@ecms/contracts';
import { AppError } from '../../../../shared/errors';

/** The facts a parent is judged on. Ids in the database's own spelling: they compare as strings. */
export interface CategoryParentFacts {
  /** The category being written; null on a create. */
  categoryId: string | null;
  /** Whether it already has subcategories (a create has none). */
  hasChildren: boolean;
  /** The parent asked for; null asks for the top level. */
  parent: { id: string; parentId: string | null; isActive: boolean } | null;
}

/** Why this parent is refused, or null. Asked only when the parent changes. */
export const parentProblem = (
  facts: CategoryParentFacts,
): AdministrationCategoryParentProblem | null => {
  const { parent } = facts;
  // The top level is always a place to stand: moving there shortens every chain.
  if (parent === null) return null;
  if (parent.id === facts.categoryId) return 'self';
  if (facts.categoryId !== null && parent.parentId === facts.categoryId) return 'cycle';
  if (parent.parentId !== null) return 'tooDeep';
  if (facts.hasChildren) return 'hasChildren';
  if (!activeFor(parent, 'newReference')) return 'inactive';
  return null;
};

const PROBLEM_MESSAGES: Record<AdministrationCategoryParentProblem, string> = {
  self: 'a category cannot be its own parent',
  cycle: 'a category cannot sit under one of its own subcategories',
  tooDeep: 'a subcategory cannot hold subcategories: two levels only',
  inactive: 'the parent category is retired',
  hasChildren: 'a category that has subcategories cannot move under another',
};

/** The 422 a refused parent answers, its detail naming the problem for the screen to word. */
export const parentRefusal = (problem: AdministrationCategoryParentProblem): AppError =>
  new AppError(ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID, 422, PROBLEM_MESSAGES[problem], {
    details: [{ field: 'parentId', code: problem, message: PROBLEM_MESSAGES[problem] }],
  });

/**
 * The acts that name a category. Retiring one hides it from NEW references — a new item, a new
 * subcategory, a move under it — while an item that already names it keeps it (§2.3.3).
 */
export type ItemCategoryAct = 'newReference' | 'existingReference';

export const activeFor = (category: { isActive: boolean }, act: ItemCategoryAct): boolean =>
  act === 'existingReference' || category.isActive;

/**
 * Why this category may not retire: never. A category has no deactivation rule (§5.3); its
 * subcategories and items keep naming it, and it stays out of every new choice.
 */
export const deactivationProblem = (_category: { isActive: boolean }): null => null;
