import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { branchScopeMatch } from '../../../../shared/base/branch-scope';
import { type ScopeSelector } from '../../../../shared/types';
import { collectionReady } from '../../shared/collection-ready';
import { AdministrationWarehouseModel, type AdministrationWarehouseDoc } from './warehouse.model';

/** Every live row but `exceptId` — the row being edited never clashes with itself. */
const others = (exceptId: string | undefined): FilterQuery<AdministrationWarehouseDoc> =>
  exceptId === undefined ? {} : { _id: { $ne: new Types.ObjectId(exceptId) } };

class AdministrationWarehouseRepository extends BaseRepository<AdministrationWarehouseDoc> {
  /** Awaited before every write: `ux_code` and `ux_branch_name_key` are what racing writes meet. */
  readonly ensureCollection = collectionReady(AdministrationWarehouseModel);

  constructor() {
    super(AdministrationWarehouseModel, { branchField: 'branchId' }); // a branch record (§7.2)
  }

  /**
   * Every scoped read — `findById`, `list`, `updateById` — through the shared fail-closed rule
   * (§7.2), not the base repository's: over a collection with a branch and no department, the
   * base WIDENS a department- or section-scoped grant to the whole company, and reads `own` as the
   * rows its holder created. This narrows the first to its branch and reads `own` as nothing. A
   * read without a selector is the system's own (a duplicate check, a label) and is not narrowed.
   */
  protected override scopeFilter(
    selector: ScopeSelector | undefined,
  ): FilterQuery<AdministrationWarehouseDoc> {
    if (selector === undefined) return {};
    // The shared rule answers a plain filter over `branchId`; this collection's field is that name.
    return branchScopeMatch(selector) as FilterQuery<AdministrationWarehouseDoc>;
  }

  /** The live warehouse holding `code` anywhere in the company, if any — codes are company-wide. */
  async findLiveByCode(
    code: string,
    exceptId?: string,
  ): Promise<AdministrationWarehouseDoc | null> {
    return this.findOne({ code, ...others(exceptId) });
  }

  /** The live warehouse of this branch whose folded name is `nameKey` — names are per branch. */
  async findLiveByBranchAndNameKey(
    branchId: string,
    nameKey: string,
    exceptId?: string,
  ): Promise<AdministrationWarehouseDoc | null> {
    return this.findOne({ branchId: new Types.ObjectId(branchId), nameKey, ...others(exceptId) });
  }
}

export const administrationWarehouseRepository = new AdministrationWarehouseRepository();
