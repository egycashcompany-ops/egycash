import { type FleetCatalogKind } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { FleetCatalogItemModel, type FleetCatalogItemDoc } from './catalog-item.model';

class FleetCatalogItemRepository extends BaseRepository<FleetCatalogItemDoc> {
  constructor() {
    super(FleetCatalogItemModel, {}); // organization-level catalog, no org scoping
  }

  async findByKindAndNameAr(
    kind: FleetCatalogKind,
    nameAr: string,
  ): Promise<FleetCatalogItemDoc | null> {
    return this.model
      .findOne({ kind, 'name.ar': nameAr, isDeleted: false })
      .lean<FleetCatalogItemDoc>()
      .exec();
  }

  /**
   * Every work type whose closure resets the maintenance cycle — ARCHIVED ONES INCLUDED.
   *
   * `isActive` is a WRITE-time fact everywhere else in this codebase: `findActiveOfKind` refuses
   * an archived item for a NEW record, the roster's pool lists active drivers, the licence sweep
   * warns about active ones. The design says what archiving is for — "archive instead of delete —
   * vehicles reference it" (§2.10) — and the catalog select already keeps an inactive current
   * value visible so history can still name itself.
   *
   * The alarm's baseline is history: which past visit reset the cycle. Filtering it by `isActive`
   * conflated "you may no longer CHOOSE this" with "this never counted", so archiving the single
   * seeded «صيانة» row emptied this list and turned every vehicle in the fleet to `noService` at
   * once — silently, with every visit still sitting in the database.
   *
   * `distinct` rather than a page: `list()` clamps to MAX_PAGE_SIZE (100), so a paginated read
   * would silently stop counting past the hundredth type rather than fail.
   */
  async countingWorkTypeIds(): Promise<string[]> {
    const ids = await this.model
      .distinct('_id', { kind: 'workType', countsForAlarm: true, isDeleted: false })
      .exec();
    return ids.map((id) => String(id));
  }

  /** Active item of the given kind, or null — the reference check services run before writes. */
  async findActiveOfKind(id: string, kind: FleetCatalogKind): Promise<FleetCatalogItemDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.kind === kind && doc.isActive ? doc : null;
  }
}

export const fleetCatalogItemRepository = new FleetCatalogItemRepository();
