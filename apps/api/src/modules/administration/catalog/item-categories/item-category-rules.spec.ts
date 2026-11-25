// An item category's rules (design §2.3.3, §5.15, §19.7): two levels (OD-06 A); never its own
// parent, never under its own subcategory; under an active parent only; and a category with
// subcategories never moves. Each refusal is the one 422 code, its detail naming the problem.
import { ErrorCodes } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../shared/errors';
import {
  activeFor,
  deactivationProblem,
  parentProblem,
  parentRefusal,
  type CategoryParentFacts,
} from './item-category-rules';

const TOOLS = 'a0000000000000000000000a'; // top level
const HAND_TOOLS = 'a0000000000000000000000b'; // under TOOLS
const PAPER = 'a0000000000000000000000c'; // top level

const topLevel = (id: string, isActive = true) => ({ id, parentId: null, isActive });
const under = (id: string, parentId: string) => ({ id, parentId, isActive: true });

const facts = (over: Partial<CategoryParentFacts>): CategoryParentFacts => ({
  categoryId: null,
  hasChildren: false,
  parent: null,
  ...over,
});

describe('parentProblem — where a category may sit', () => {
  it('lets a new category stand at the top level, or under an active top-level one', () => {
    expect(parentProblem(facts({}))).toBeNull();
    expect(parentProblem(facts({ parent: topLevel(TOOLS) }))).toBeNull();
  });

  it('lets a category move to the top level, children or not', () => {
    expect(parentProblem(facts({ categoryId: TOOLS, hasChildren: true, parent: null }))).toBeNull();
  });

  it('moves a childless subcategory to another top-level category', () => {
    expect(parentProblem(facts({ categoryId: HAND_TOOLS, parent: topLevel(PAPER) }))).toBeNull();
  });

  it('refuses the category itself as its parent — self', () => {
    expect(parentProblem(facts({ categoryId: TOOLS, parent: topLevel(TOOLS) }))).toBe('self');
  });

  it('refuses one of its own subcategories as its parent — cycle', () => {
    expect(
      parentProblem(
        facts({ categoryId: TOOLS, hasChildren: true, parent: under(HAND_TOOLS, TOOLS) }),
      ),
    ).toBe('cycle');
  });

  it('refuses a subcategory as a parent — tooDeep: two levels only (OD-06)', () => {
    expect(parentProblem(facts({ parent: under(HAND_TOOLS, TOOLS) }))).toBe('tooDeep');
    expect(parentProblem(facts({ categoryId: PAPER, parent: under(HAND_TOOLS, TOOLS) }))).toBe(
      'tooDeep',
    );
  });

  it('refuses to move a category that has subcategories under another — hasChildren', () => {
    expect(
      parentProblem(facts({ categoryId: TOOLS, hasChildren: true, parent: topLevel(PAPER) })),
    ).toBe('hasChildren');
  });

  it('refuses a retired parent — inactive', () => {
    expect(parentProblem(facts({ parent: topLevel(PAPER, false) }))).toBe('inactive');
  });
});

describe('parentRefusal — the answer the screen words', () => {
  it.each(['self', 'cycle', 'tooDeep', 'inactive', 'hasChildren'] as const)(
    '%s is a 422 ADMINISTRATION_CATEGORY_PARENT_INVALID naming the problem on parentId',
    (problem) => {
      const error = parentRefusal(problem);
      expect(error).toBeInstanceOf(AppError);
      expect(error.httpStatus).toBe(422);
      expect(error.code).toBe(ErrorCodes.ADMINISTRATION_CATEGORY_PARENT_INVALID);
      expect(error.details).toEqual([
        { field: 'parentId', code: problem, message: expect.any(String) as string },
      ]);
    },
  );
});

describe('activeFor and deactivationProblem', () => {
  it('a retired category is refused to a new reference and kept by an existing one', () => {
    expect(activeFor({ isActive: false }, 'newReference')).toBe(false);
    expect(activeFor({ isActive: false }, 'existingReference')).toBe(true);
    expect(activeFor({ isActive: true }, 'newReference')).toBe(true);
  });

  it('nothing keeps a category from retiring', () => {
    expect(deactivationProblem({ isActive: true })).toBeNull();
  });
});
