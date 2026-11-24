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
import { duplicateRefusal, isDuplicateWrite, searchPatterns } from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { auditItemCategoryCreated, auditItemCategoryEdited } from './item-category-audit';
import { parentProblem, parentRefusal } from './item-category-rules';
import { type AdministrationItemCategoryDoc } from './item-category.model';
import { administrationItemCategoryRepository as repository } from './item-category.repository';

/** The parent's names, by id — the list's one label (§19.4). */
export type ItemCategoryParentNames = ReadonlyMap<string, LocalizedString>;

/** Where a write would leave the row, and under which name and code — what the checks compare. */
interface Claim {
  parentId: string | null;
  nameKey: string;
  code: string | null;
}

const idOf = (id: Types.ObjectId | null): string | null => (id === null ? null : String(id));

class AdministrationItemCategoryService {
  async list(
    query: ListAdministrationItemCategoriesQuery,
  ): Promise<Paginated<AdministrationItemCategoryDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.parentId !== undefined) filter.parentId = new Types.ObjectId(query.parentId);
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const search = searchPatterns(query.search);
    if (search !== null) {
      filter.$or = [
        { code: search.typed },
        { 'name.ar': search.typed },
        { 'name.en': search.typed },
        ...(search.folded === null ? [] : [{ nameKey: search.folded }]),
      ];
    }
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

  async create(
    input: CreateAdministrationItemCategory,
    ctx: AuthContext,
  ): Promise<AdministrationItemCategoryDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationCatalog.manage');
    const claim: Claim = {
      parentId: input.parentId ?? null,
      nameKey: foldName(input.name.ar),
      code: input.code ?? null,
    };
    await this.assertParent(null, claim.parentId);
    await this.assertFree(claim, undefined);

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
      throw await this.explainDuplicate(error, claim, undefined);
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
    const claim: Claim = {
      parentId: input.parentId === undefined ? idOf(before.parentId) : input.parentId,
      nameKey: input.name === undefined ? before.nameKey : foldName(input.name.ar),
      code: input.code === undefined ? before.code : input.code,
    };
    // Only a move is judged: a subcategory whose parent retired since is still edited in place.
    const moves = claim.parentId !== idOf(before.parentId);
    if (moves) await this.assertParent(id, claim.parentId);
    await this.assertFree(claim, id);

    const set: Partial<AdministrationItemCategoryDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = claim.nameKey;
    }
    if (moves) set.parentId = claim.parentId === null ? null : new Types.ObjectId(claim.parentId);
    if (input.description !== undefined) set.description = input.description;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    // A deactivation is this field (§5.3); a category has no rule against it.
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationItemCategoryDoc;
    try {
      updated = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw await this.explainDuplicate(error, claim, id);
    }
    await auditItemCategoryEdited(before, updated);
    return updated;
  }

  /** The parent a write asks for, judged by the pure rule (`parentProblem`). */
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

  /** The early answer: a live category under the same parent holds the name, or any holds the code. */
  private async assertFree(claim: Claim, exceptId: string | undefined): Promise<void> {
    const field = await this.takenField(claim, exceptId);
    if (field !== null) throw duplicateRefusal(field);
  }

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

  /**
   * A unique index refused a write that raced past the early check: the row that won is in now, so
   * the same check names the field. Any other failure goes on as it came.
   */
  private async explainDuplicate(
    error: unknown,
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<unknown> {
    if (!isDuplicateWrite(error)) return error;
    const field = await this.takenField(claim, exceptId);
    return field === null ? error : duplicateRefusal(field);
  }
}

export const administrationItemCategoryService = new AdministrationItemCategoryService();
