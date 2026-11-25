// Items (design §2.3.4, §5.3, §19.3): the organization's one item master, read by any holder of
// `administrationItem.view` and written only at organization scope (OD-04 A), audited, no events.
// Nothing is deleted: `isActive: false` retires an item (OD-70 A), which keeps its code, its name
// and its barcode. Each is a stock or a non-stock item (`stockTracked`, OD-14 C), set by the same
// writers on a create and on any edit.
//
// THE CODE. «ITM-00001» is taken from the module's counter as the first write of the create's
// transaction (OD-05 A, §2.8), so two creates at once get consecutive numbers — the second meets a
// write conflict on the counter and is run again — and a create that is refused inside it, by a
// unique index, gives its number back: the series has no gap.
//
// THE CHECKS. The levels' order, the references and the category's level are the rules'
// (`item-rules.ts`), judged on the row the write leaves — so an edit is first held to its
// version, or it would be judged on fields its sender never saw. A name is checked before the
// write for the early answer; a barcode is not — `ux_barcode` is its only check — and either
// index refusing a write that raced past is answered with the field it guards (§5.15).
import {
  foldName,
  formatAdministrationMasterCode,
  type AdministrationDuplicateField,
  type AdministrationItemReferenceField,
  type CreateAdministrationItem,
  type ListAdministrationItemsQuery,
  type LocalizedString,
  type Paginated,
  type UpdateAdministrationItem,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { type AppError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { ensureCounter, nextNumber } from '../../shared/counter.model';
import { ITEM_CODE_SERIES } from '../../shared/document-number';
import {
  assertCurrentVersion,
  assertNotTaken,
  explainDuplicate,
  masterSearchClause,
} from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { administrationCatalogItemService, unitActiveFor } from '../catalog-items/index';
import {
  administrationItemCategoryService,
  categoryActiveFor,
  type ItemCategoryLabel,
} from '../item-categories/index';
import { auditItemCreated, auditItemEdited } from './item-audit';
import {
  isStatusChangeOnly,
  referenceRefusal,
  stockLevelsRefusal,
  subcategoryRefusal,
  type StockLevels,
} from './item-rules';
import { type AdministrationItemDoc } from './item.model';
import { administrationItemRepository as repository } from './item.repository';

/** The names an item's DTO carries (§19.4): its category's and that one's parent's, its unit's. */
export interface ItemLabels {
  categories: ReadonlyMap<string, ItemCategoryLabel>;
  units: ReadonlyMap<string, LocalizedString>;
}

/** The name and barcode a write would leave the row with — what the duplicate checks compare. */
interface Claim {
  nameKey: string;
  barcode: string | null;
}

/**
 * The references a write leaves the row with, and which of them it names anew: a create names
 * both, an edit only what it changes — an item keeps a unit or category it already names.
 */
interface References {
  unitId: string;
  categoryId: string;
  isUnitNamed: boolean;
  isCategoryNamed: boolean;
}

/** An id as the database spells it: the contract takes A-F too, and ids compare as strings. */
const canonicalId = (id: string): string => String(new Types.ObjectId(id));

const refuseIf = (refusal: AppError | null): void => {
  if (refusal !== null) throw refusal;
};

/**
 * The item counter, raised to the highest code already given and never lowered — at every boot,
 * and before every create, OUTSIDE its transaction, so that transaction only ever moves a counter
 * that exists (§2.3.1). A counter lost while items exist comes back above their codes.
 */
export const ensureItemCodeCounter = async (): Promise<void> => {
  await ensureCounter(ITEM_CODE_SERIES.key, await repository.highestCodeNumber());
};

class AdministrationItemService {
  async list(query: ListAdministrationItemsQuery): Promise<Paginated<AdministrationItemDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.categoryId !== undefined) {
      const ids = await administrationItemCategoryService.idsWithSubcategories(query.categoryId);
      filter.categoryId = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    if (query.unitId !== undefined) filter.unitId = new Types.ObjectId(query.unitId);
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    // A scan types the barcode whole, so the register finds its item by it (§19.4).
    const search = masterSearchClause(query.search, ['barcode']);
    if (search !== null) filter.$or = search;
    return repository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'name.ar', 'createdAt'],
    });
  }

  /** One item by id, retired or not: a form holding a stored `itemId` still shows its name. */
  async getById(id: string): Promise<AdministrationItemDoc> {
    return repository.getById(id);
  }

  /** The labels of the rows at hand, read by id and unfiltered: retired ones still name themselves. */
  async labels(docs: readonly AdministrationItemDoc[]): Promise<ItemLabels> {
    const [categories, units] = await Promise.all([
      administrationItemCategoryService.labels(docs.map((doc) => String(doc.categoryId))),
      administrationCatalogItemService.unitNames(docs.map((doc) => String(doc.unitId))),
    ]);
    return { categories, units };
  }

  async create(input: CreateAdministrationItem, ctx: AuthContext): Promise<AdministrationItemDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationItem.create');
    const claim: Claim = { nameKey: foldName(input.name.ar), barcode: input.barcode ?? null };
    refuseIf(
      stockLevelsRefusal({
        minQty: input.minQty ?? null,
        reorderPointQty: input.reorderPointQty ?? null,
        maxQty: input.maxQty ?? null,
      }),
    );
    const references: References = {
      unitId: canonicalId(input.unitId),
      categoryId: canonicalId(input.categoryId),
      isUnitNamed: true,
      isCategoryNamed: true,
    };
    await this.assertReferences(references);
    await this.assertCategoryLevel(references.categoryId);
    await assertNotTaken(() => this.nameTaken(claim, undefined));

    // Both collections the transaction writes, with their indexes, before it begins — an insert
    // inside a transaction must not be what creates a collection — and the counter, which the
    // transaction only moves.
    await repository.ensureCollection();
    await ensureItemCodeCounter();
    let doc: AdministrationItemDoc;
    try {
      doc = await unitOfWork(async (session) => {
        const seq = await nextNumber(ITEM_CODE_SERIES.key, session);
        return repository.create(
          {
            code: formatAdministrationMasterCode(ITEM_CODE_SERIES.kind, seq),
            barcode: claim.barcode,
            name: input.name,
            nameKey: claim.nameKey,
            categoryId: new Types.ObjectId(references.categoryId),
            unitId: new Types.ObjectId(references.unitId),
            minQty: input.minQty ?? null,
            reorderPointQty: input.reorderPointQty ?? null,
            maxQty: input.maxQty ?? null,
            description: input.description ?? null,
            notes: input.notes ?? null,
            stockTracked: input.stockTracked,
            isActive: true,
          },
          { by: ctx.userId, session },
        );
      });
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, undefined));
    }
    await auditItemCreated(doc);
    return doc;
  }

  async update(
    id: string,
    input: UpdateAdministrationItem,
    ctx: AuthContext,
  ): Promise<AdministrationItemDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationItem.edit');
    const before = await repository.getById(id);
    assertCurrentVersion(before, input.version);
    const itemId = String(before._id);
    const claim: Claim = {
      nameKey: input.name === undefined ? before.nameKey : foldName(input.name.ar),
      barcode: input.barcode === undefined ? before.barcode : input.barcode,
    };
    const levels: StockLevels = {
      minQty: input.minQty === undefined ? before.minQty : input.minQty,
      reorderPointQty:
        input.reorderPointQty === undefined ? before.reorderPointQty : input.reorderPointQty,
      maxQty: input.maxQty === undefined ? before.maxQty : input.maxQty,
    };
    refuseIf(stockLevelsRefusal(levels));
    const unitId = input.unitId === undefined ? String(before.unitId) : canonicalId(input.unitId);
    const categoryId =
      input.categoryId === undefined ? String(before.categoryId) : canonicalId(input.categoryId);
    const references: References = {
      unitId,
      categoryId,
      isUnitNamed: unitId !== String(before.unitId),
      isCategoryNamed: categoryId !== String(before.categoryId),
    };
    await this.assertReferences(references);
    // Every edit, the category kept as much as one named anew: an item its category's first
    // subcategory left above the level is re-filed by its next edit (OD-06 (i)) — except one that
    // only retires or brings it back, which a new level must never block (§22, P1a.2 built).
    if (!isStatusChangeOnly(input)) await this.assertCategoryLevel(categoryId);
    await assertNotTaken(() => this.nameTaken(claim, itemId));

    const set: Partial<AdministrationItemDoc> = {};
    if (input.barcode !== undefined) set.barcode = input.barcode;
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = claim.nameKey;
    }
    if (references.isCategoryNamed) set.categoryId = new Types.ObjectId(categoryId);
    // The base unit may still change: no line or movement can name an item before P2 and P5, and
    // the checkers that will make it immutable then register with their features (§2.3.4, §3.6).
    if (references.isUnitNamed) set.unitId = new Types.ObjectId(unitId);
    if (input.minQty !== undefined) set.minQty = input.minQty;
    if (input.reorderPointQty !== undefined) set.reorderPointQty = input.reorderPointQty;
    if (input.maxQty !== undefined) set.maxQty = input.maxQty;
    if (input.description !== undefined) set.description = input.description;
    if (input.notes !== undefined) set.notes = input.notes;
    // No rule reads the kind before P5 (OD-14 C); whether it may change once stock exists is P5's
    // question (design §22, P2.1 built).
    if (input.stockTracked !== undefined) set.stockTracked = input.stockTracked;
    // A deactivation is this field (§5.3); an item has no rule against it (OD-70 A).
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationItemDoc;
    try {
      updated = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, itemId));
    }
    await auditItemEdited(before, updated);
    return updated;
  }

  /**
   * The unit and category a write names anew, judged by their own `activeFor`: a retired one is
   * refused to a new reference. One the item already names is not read here at all: it keeps it.
   * An id that names nothing is 404, as a category's parent is.
   */
  private async assertReferences(references: References): Promise<void> {
    const [unit, category] = await Promise.all([
      references.isUnitNamed ? administrationCatalogItemService.findUnit(references.unitId) : null,
      references.isCategoryNamed
        ? administrationItemCategoryService.findCategory(references.categoryId)
        : null,
    ]);
    if (references.isUnitNamed && unit === null) throw new NotFoundError('no such unit');
    if (references.isCategoryNamed && category === null) {
      throw new NotFoundError('no such item category');
    }

    const retired: AdministrationItemReferenceField[] = [];
    if (unit !== null && !unitActiveFor(unit, 'newReference')) retired.push('unitId');
    if (category !== null && !categoryActiveFor(category, 'newReference')) {
      retired.push('categoryId');
    }
    refuseIf(referenceRefusal(retired));
  }

  /** The level rule (OD-06 (i)) on the category the write leaves the item in, named or kept. */
  private async assertCategoryLevel(categoryId: string): Promise<void> {
    const hasActiveSubcategories =
      await administrationItemCategoryService.hasActiveSubcategories(categoryId);
    refuseIf(subcategoryRefusal({ hasActiveSubcategories }));
  }

  /** The early answer's question: does a live item, `exceptId` aside, hold this name? */
  private async nameTaken(
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    return (await repository.findLiveByNameKey(claim.nameKey, exceptId)) === null ? null : 'name';
  }

  /** After an index refused a write: the name, else the barcode, the row that won now holds. */
  private async takenField(
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    const name = await this.nameTaken(claim, exceptId);
    if (name !== null) return name;
    if (
      claim.barcode !== null &&
      (await repository.findLiveByBarcode(claim.barcode, exceptId)) !== null
    ) {
      return 'barcode';
    }
    return null;
  }
}

export const administrationItemService = new AdministrationItemService();
