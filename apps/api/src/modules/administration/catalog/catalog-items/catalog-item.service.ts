// Units of measure (design §2.3.2, §5.3, §19.3): organization-wide master data, written only at
// organization scope (OD-04 A), audited, no events. Nothing is deleted: `isActive: false` retires
// a unit, and a retired unit keeps its name — reactivate it, never type it again.
import {
  foldName,
  type AdministrationDuplicateField,
  type CreateAdministrationCatalogItem,
  type ListAdministrationCatalogItemsQuery,
  type Paginated,
  type UpdateAdministrationCatalogItem,
} from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { assertNotTaken, explainDuplicate, masterSearchClause } from '../../shared/master-data';
import { assertAdministrationOrgAuthority } from '../../shared/org-authority';
import { auditCatalogItemCreated, auditCatalogItemEdited } from './catalog-item-audit';
import { type AdministrationCatalogItemDoc } from './catalog-item.model';
import { administrationCatalogItemRepository as repository } from './catalog-item.repository';

/** The name and code a write would leave the row with — what the duplicate checks compare. */
interface Claim {
  kind: AdministrationCatalogItemDoc['kind'];
  nameKey: string;
  code: string | null;
}

class AdministrationCatalogItemService {
  async list(
    query: ListAdministrationCatalogItemsQuery,
  ): Promise<Paginated<AdministrationCatalogItemDoc>> {
    const filter: Record<string, unknown> = { kind: query.kind };
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

  async create(
    input: CreateAdministrationCatalogItem,
    ctx: AuthContext,
  ): Promise<AdministrationCatalogItemDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationCatalog.manage');
    const claim: Claim = {
      kind: input.kind,
      nameKey: foldName(input.name.ar),
      code: input.code ?? null,
    };
    await assertNotTaken(() => this.takenField(claim, undefined));

    await repository.ensureCollection();
    let doc: AdministrationCatalogItemDoc;
    try {
      doc = await repository.create(
        {
          kind: input.kind,
          code: claim.code,
          name: input.name,
          nameKey: claim.nameKey,
          description: input.description ?? null,
          sortOrder: input.sortOrder,
          isActive: true,
        },
        { by: ctx.userId },
      );
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, undefined));
    }
    await auditCatalogItemCreated(doc);
    return doc;
  }

  async update(
    id: string,
    input: UpdateAdministrationCatalogItem,
    ctx: AuthContext,
  ): Promise<AdministrationCatalogItemDoc> {
    assertAdministrationOrgAuthority(ctx, 'administrationCatalog.manage');
    const before = await repository.getById(id);
    const claim: Claim = {
      kind: before.kind,
      nameKey: input.name === undefined ? before.nameKey : foldName(input.name.ar),
      code: input.code === undefined ? before.code : input.code,
    };
    await assertNotTaken(() => this.takenField(claim, id));

    const set: Partial<AdministrationCatalogItemDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) {
      set.name = input.name;
      set.nameKey = claim.nameKey;
    }
    if (input.description !== undefined) set.description = input.description;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    // A deactivation is this field (§5.3); a unit has no rule against it (`deactivationProblem`).
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await repository.ensureCollection();
    let updated: AdministrationCatalogItemDoc;
    try {
      updated = await repository.updateById(id, set, { by: ctx.userId, version: input.version });
    } catch (error) {
      throw await explainDuplicate(error, () => this.takenField(claim, id));
    }
    await auditCatalogItemEdited(before, updated);
    return updated;
  }

  /** What a live unit of the kind, `exceptId` aside, already holds: its name, then its code. */
  private async takenField(
    claim: Claim,
    exceptId: string | undefined,
  ): Promise<AdministrationDuplicateField | null> {
    if ((await repository.findLiveByNameKey(claim.kind, claim.nameKey, exceptId)) !== null) {
      return 'name';
    }
    if (
      claim.code !== null &&
      (await repository.findLiveByCode(claim.kind, claim.code, exceptId)) !== null
    ) {
      return 'code';
    }
    return null;
  }
}

export const administrationCatalogItemService = new AdministrationCatalogItemService();
