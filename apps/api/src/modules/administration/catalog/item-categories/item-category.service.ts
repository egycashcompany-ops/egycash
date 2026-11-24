// Item categories (design §2.3.3, §5.3, §19.3): organization-wide master data in two levels
// (OD-06 A), written only at organization scope (OD-04 A), audited, no events. Nothing is deleted:
// `isActive: false` retires a category, which keeps its name under its parent while retired.
import {
  foldName,
  type AdministrationDuplicateField,
  type CreateAdministrationItemCategory,
  type ListAdministrationItemCategoriesQuery,
  type LocalizedString,
  type Paginated,
  type UpdateAdministrationItemCategory,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { assertNotTaken, explainDuplicate, masterSearchClause } from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { auditItemCategoryCreated, auditItemCategoryEdited } from './item-category-audit';
import { parentProblem, parentRefusal } from './item-category-rules';
import { type AdministrationItemCategoryDoc } from './item-category.model';
import { administrationItemCategoryRepository as repository } from './item-category.repository';

/** The parent's names, by id — the list's one label (§19.4). */
export type ItemCategoryParentNames = ReadonlyMap<string, LocalizedString>;

/** A category as an item's labels name it (§19.4): its own name, and its parent's. */
export interface ItemCategoryLabel {
  name: LocalizedString;
  parentId: string | null;
  parentName: LocalizedString | null;
}

/** Where a write would leave the row, and under which name and code — what the checks compare. */
interface Claim {
  parentId: string | null;
  nameKey: string;
  code: string | null;
}

const idOf = (id: Types.ObjectId | null): string | null => (id === null ? null : String(id));

/**
 * An id as the database spells it. The contract takes A-F as well as a-f, while the parent rule
 * and the move test compare ids as strings: a category's id typed in upper case would pass as
 * another category's, and the category could be saved as its own parent.
 */
const canonicalId = (id: string | null): string | null =>
  id === null ? null : String(new Types.ObjectId(id));

class AdministrationItemCategoryService {
  async list(
    query: ListAdministrationItemCategoriesQuery,
  ): Promise<Paginated<AdministrationItemCategoryDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.parentId !== undefined) filter.parentId = new Types.ObjectId(query.parentId);
    // Never beside `parentId` (the contract refuses both): true is the level a parent is picked
    // from, false every subcategory.
    if (query.topLevel !== undefined) filter.parentId = query.topLevel ? null : { $ne: null };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const search = masterSearchClause(query.search);
    if (search !== null) filter.$or = search;
    return repository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'name.ar', 'createdAt'],
    });
  }

  /**
   * The parents' names, read by id and unfiltered: a retired parent still names itself, and the
   * rows that cite it were already read.
   */
  async parentNames(
    docs: readonly AdministrationItemCategoryDoc[],
  ): Promise<ItemCategoryParentNames> {
    const ids = docs.map((doc) => idOf(doc.parentId)).filter((id): id is string => id !== null);
    const parents = await repository.findByIdsSystem(ids);
    return new Map(parents.map((parent) => [String(parent._id), parent.name]));
  }

  /**
   * The category `id` names, retired or not, or null: what an item's write reads to judge the
   * category it names (the item asks `activeFor` of it).
   */
  async findCategory(id: string): Promise<AdministrationItemCategoryDoc | null> {
    return repository.findById(id);
  }

  /**
   * Does the category hold subcategories still offered to new items? Then a new item names one of
   * them (OD-06 (i)); a category whose subcategories all retired is a leaf again.
   */
  async hasActiveSubcategories(id: string): Promise<boolean> {
    return repository.hasActiveChildren(id);
  }

  /**
   * The category and every subcategory under it: what an item register filtered by a category
   * reads, so a top-level category holds its subcategories' items. A subcategory has none.
   */
  async idsWithSubcategories(id: string): Promise<string[]> {
    const canonical = String(new Types.ObjectId(id));
    return [canonical, ...(await repository.childIds(canonical))];
  }

  /** The categories' labels, by id, read unfiltered as the parents' names are (§19.4). */
  async labels(ids: readonly string[]): Promise<ReadonlyMap<string, ItemCategoryLabel>> {
    const categories = await repository.findByIdsSystem(ids);
    const parents = await this.parentNames(categories);
    return new Map(
      categories.map((category) => {
        const parentId = idOf(category.parentId);
        const parentName = parentId === null ? null : (parents.get(parentId) ?? null);
        return [String(category._id), { name: category.name, parentId, parentName }];
      }),
    );
  }

  async create(
    input: CreateAdministrationItemCategory,
    ctx: AuthContext,
  ): Promise<AdministrationItemCategoryDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationCatalog.manage');
    const claim: Claim = {
      parentId: canonicalId(input.parentId ?? null),
      nameKey: foldName(input.name.ar),
      code: input.code ?? null,
    };
    await this.assertParent(null, claim.parentId);
    await assertNotTaken(() => this.takenField(claim, undefined));

    await repository.ensureCollection();
    let doc: AdministrationItemCategoryDoc;
    try {
      doc = await repository.create(
        {
          code: claim.code,
          name: input.name,
          nameKey: claim.nameKey,
          parentId: claim.parentId === null ? null : new Types.ObjectId(claim.parentId),
          description: input.description ?? null,
          sortOrder: input.sortOrder,
          isActive: true,
        },
        { by: ctx.userId },
      );
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, undefined));
    }
    await auditItemCategoryCreated(doc);
    return doc;
  }

  async update(
    id: string,
    input: UpdateAdministrationItemCategory,
    ctx: AuthContext,
  ): Promise<AdministrationItemCategoryDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationCatalog.manage');
    const before = await repository.getById(id);
    const categoryId = String(before._id);
    const claim: Claim = {
      parentId: input.parentId === undefined ? idOf(before.parentId) : canonicalId(input.parentId),
      nameKey: input.name === undefined ? before.nameKey : foldName(input.name.ar),
      code: input.code === undefined ? before.code : input.code,
    };
    // Only a move is judged: a subcategory whose parent retired since is still edited in place.
    const isMove = claim.parentId !== idOf(before.parentId);
    if (isMove) await this.assertParent(categoryId, claim.parentId);
    await assertNotTaken(() => this.takenField(claim, categoryId));

    const set: Partial<AdministrationItemCategoryDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = claim.nameKey;
    }
    if (isMove) set.parentId = claim.parentId === null ? null : new Types.ObjectId(claim.parentId);
    if (input.description !== undefined) set.description = input.description;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    // A deactivation is this field (§5.3); a category has no rule against it.
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationItemCategoryDoc;
    try {
      updated = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, categoryId));
    }
    await auditItemCategoryEdited(before, updated);
    return updated;
  }

  /** The parent a write asks for, judged by the pure rule (`parentProblem`); both ids canonical. */
  private async assertParent(categoryId: string | null, parentId: string | null): Promise<void> {
    if (parentId === null) return;
    const parent = await repository.findById(parentId);
    if (parent === null) throw new NotFoundError('no such parent category');
    const problem = parentProblem({
      categoryId,
      hasChildren: categoryId === null ? false : await repository.hasChildren(categoryId),
      parent: {
        id: String(parent._id),
        parentId: idOf(parent.parentId),
        isActive: parent.isActive,
      },
    });
    if (problem !== null) throw parentRefusal(problem);
  }

  /** What a live category, `exceptId` aside, holds: the name under the same parent, or the code. */
  private async takenField(
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    const named = await repository.findLiveByParentAndNameKey(
      claim.parentId,
      claim.nameKey,
      exceptId,
    );
    if (named !== null) return 'name';
    if (claim.code !== null && (await repository.findLiveByCode(claim.code, exceptId)) !== null) {
      return 'code';
    }
    return null;
  }
}

export const administrationItemCategoryService = new AdministrationItemCategoryService();
