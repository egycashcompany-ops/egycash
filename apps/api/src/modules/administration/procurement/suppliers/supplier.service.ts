// Suppliers (design §2.3.6, §5.3, §19.3): the organization's one supplier register, read by any
// holder of `administrationSupplier.view` and written only at organization scope (OD-04 A),
// audited, no events. Nothing is deleted: `isActive: false` retires a supplier (OD-12 A), which
// keeps its code and its name.
//
// THE CODE. «SUP-00001» is taken from the module's counter, under the supplier's own key, as the
// first write of the create's transaction (OD-05 A, §2.8) — the item code's machinery — so two
// creates at once get consecutive numbers, and a create refused inside it by a unique index gives
// its number back: the series has no gap.
//
// THE CHECKS. An edit is first held to its version, so it is never judged on fields its sender
// did not see. A name is checked before the write for the early answer, and `ux_name_key` refusing
// a write that raced past is answered the same way (§5.15). A category named anew must exist and
// be active; one the supplier already names is kept. A repeated tax number is never refused: the
// detail names the other holders as a warning (OD-11 (i)).
import {
  ADMINISTRATION_SUPPLIER_TAX_NUMBER_MATCHES,
  foldName,
  formatAdministrationMasterCode,
  type AdministrationDuplicateField,
  type CreateAdministrationSupplier,
  type ListAdministrationSuppliersQuery,
  type LocalizedString,
  type Paginated,
  type ScanStatus,
  type UpdateAdministrationSupplier,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { type AppError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import {
  administrationItemCategoryService,
  categoryActiveFor,
} from '../../catalog/item-categories/index';
import { ensureCounter, nextNumber } from '../../shared/counter.model';
import { SUPPLIER_CODE_SERIES } from '../../shared/document-number';
import {
  assertCurrentVersion,
  assertNotTaken,
  explainDuplicate,
  masterSearchClause,
} from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { auditSupplierCreated, auditSupplierEdited } from './supplier-audit';
import { administrationSupplierPapers } from './supplier-files';
import {
  canonicalCategoryIds,
  categoryReferenceRefusal,
  contactsFrom,
  newlyNamed,
} from './supplier-rules';
import { type AdministrationSupplierDoc } from './supplier.model';
import { administrationSupplierRepository as repository } from './supplier.repository';

/** The names a supplier's DTO carries (§19.4): its categories', by id. */
export interface SupplierLabels {
  categories: ReadonlyMap<string, LocalizedString>;
}

/** What the detail adds to the register row (§13.6 B): the papers' scan states, the warning. */
export interface SupplierDetailFacts {
  labels: SupplierLabels;
  scanStates: ReadonlyMap<string, ScanStatus | null>;
  taxNumberMatches: readonly AdministrationSupplierDoc[];
}

const refuseIf = (refusal: AppError | null): void => {
  if (refusal !== null) throw refusal;
};

/**
 * The supplier counter, raised to the highest code already given and never lowered — at every
 * boot, and before every create, OUTSIDE its transaction, so that transaction only ever moves a
 * counter that exists (§2.3.1). A counter lost while suppliers exist comes back above their codes.
 */
export const ensureSupplierCodeCounter = async (): Promise<void> => {
  await ensureCounter(SUPPLIER_CODE_SERIES.key, await repository.highestCodeNumber());
};

class AdministrationSupplierService {
  async list(
    query: ListAdministrationSuppliersQuery,
  ): Promise<Paginated<AdministrationSupplierDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.categoryId !== undefined) {
      // A top-level category holds its subcategories' suppliers, as it holds their items.
      const ids = await administrationItemCategoryService.idsWithSubcategories(query.categoryId);
      filter.categoryIds = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    const search = masterSearchClause(query.search);
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

  /** One supplier by id, retired or not: a form holding a stored `supplierId` still shows its name. */
  async getById(id: string): Promise<AdministrationSupplierDoc> {
    return repository.getById(id);
  }

  /** The labels of the rows at hand, read by id and unfiltered: retired ones still name themselves. */
  async labels(docs: readonly AdministrationSupplierDoc[]): Promise<SupplierLabels> {
    const ids = [...new Set(docs.flatMap((doc) => doc.categoryIds.map(String)))];
    const categories = await administrationItemCategoryService.labels(ids);
    return { categories: new Map([...categories].map(([id, label]) => [id, label.name])) };
  }

  /** What the supplier's page reads beside the row (§11.5, OD-11 (i)). */
  async detailFacts(
    ctx: AuthContext,
    doc: AdministrationSupplierDoc,
  ): Promise<SupplierDetailFacts> {
    const [labels, scanStates, taxNumberMatches] = await Promise.all([
      this.labels([doc]),
      administrationSupplierPapers.scanStates(ctx, doc),
      doc.taxNumber === null
        ? []
        : repository.taxNumberHolders(
            doc.taxNumber,
            String(doc._id),
            ADMINISTRATION_SUPPLIER_TAX_NUMBER_MATCHES,
          ),
    ]);
    return { labels, scanStates, taxNumberMatches };
  }

  async create(
    input: CreateAdministrationSupplier,
    ctx: AuthContext,
  ): Promise<AdministrationSupplierDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationSupplier.create');
    const nameKey = foldName(input.name.ar);
    const categoryIds = canonicalCategoryIds(input.categoryIds);
    await this.assertCategories(categoryIds);
    await assertNotTaken(() => this.nameTaken(nameKey, undefined));

    // The collection the transaction writes, with its indexes, before it begins — an insert inside
    // a transaction must not be what creates a collection — and the counter, which it only moves.
    await repository.ensureCollection();
    await ensureSupplierCodeCounter();
    let doc: AdministrationSupplierDoc;
    try {
      doc = await unitOfWork(async (session) => {
        const seq = await nextNumber(SUPPLIER_CODE_SERIES.key, session);
        return repository.create(
          {
            code: formatAdministrationMasterCode(SUPPLIER_CODE_SERIES.kind, seq),
            name: input.name,
            nameKey,
            phone: input.phone ?? null,
            email: input.email ?? null,
            address: input.address ?? null,
            contacts: contactsFrom(input.contacts),
            categoryIds: categoryIds.map((id) => new Types.ObjectId(id)),
            taxNumber: input.taxNumber ?? null,
            commercialRegistry: input.commercialRegistry ?? null,
            vatStatus: input.vatStatus ?? null,
            paymentTerms: input.paymentTerms ?? null,
            attachments: [],
            notes: input.notes ?? null,
            isActive: true,
          },
          { by: ctx.userId, session },
        );
      });
    } catch (error) {
      throw await explainDuplicate(error, () => this.nameTaken(nameKey, undefined));
    }
    await auditSupplierCreated(doc);
    return doc;
  }

  async update(
    id: string,
    input: UpdateAdministrationSupplier,
    ctx: AuthContext,
  ): Promise<AdministrationSupplierDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationSupplier.edit');
    const before = await repository.getById(id);
    assertCurrentVersion(before, input.version);
    const supplierId = String(before._id);
    const nameKey = input.name === undefined ? before.nameKey : foldName(input.name.ar);
    const categoryIds =
      input.categoryIds === undefined ? undefined : canonicalCategoryIds(input.categoryIds);
    if (categoryIds !== undefined) {
      await this.assertCategories(newlyNamed(categoryIds, before.categoryIds.map(String)));
    }
    await assertNotTaken(() => this.nameTaken(nameKey, supplierId));

    const set: Partial<AdministrationSupplierDoc> = {};
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = nameKey;
    }
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.email !== undefined) set.email = input.email;
    if (input.address !== undefined) set.address = input.address;
    if (input.contacts !== undefined) set.contacts = contactsFrom(input.contacts);
    if (categoryIds !== undefined) set.categoryIds = categoryIds.map((c) => new Types.ObjectId(c));
    // Never refused, whatever another supplier holds (OD-11 (i)): the detail warns instead.
    if (input.taxNumber !== undefined) set.taxNumber = input.taxNumber;
    if (input.commercialRegistry !== undefined) set.commercialRegistry = input.commercialRegistry;
    if (input.vatStatus !== undefined) set.vatStatus = input.vatStatus;
    if (input.paymentTerms !== undefined) set.paymentTerms = input.paymentTerms;
    if (input.notes !== undefined) set.notes = input.notes;
    // A deactivation is this field (§5.3); a supplier has no rule against it.
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationSupplierDoc;
    try {
      updated = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw await explainDuplicate(error, () => this.nameTaken(nameKey, supplierId));
    }
    await auditSupplierEdited(before, updated);
    return updated;
  }

  /**
   * The categories a write names anew, judged by the category's own `activeFor`: a retired one
   * stays out of every new choice. One that names nothing is 404, as an item's category is.
   */
  private async assertCategories(ids: readonly string[]): Promise<void> {
    const named = await Promise.all(
      ids.map(async (id) => ({
        id,
        category: await administrationItemCategoryService.findCategory(id),
      })),
    );
    const retired: string[] = [];
    for (const { id, category } of named) {
      if (category === null) throw new NotFoundError('no such item category');
      if (!categoryActiveFor(category, 'newReference')) retired.push(id);
    }
    refuseIf(categoryReferenceRefusal(retired));
  }

  /** The duplicate question, before and after the write: does a live supplier hold this name? */
  private async nameTaken(
    nameKey: string,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    return (await repository.findLiveByNameKey(nameKey, exceptId)) === null ? null : 'name';
  }
}

export const administrationSupplierService = new AdministrationSupplierService();
