import { Types, type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { ItAssetAssignmentModel, type ItAssetAssignmentDoc } from '../assets/assignment.model';
import { ItLocationModel, type ItLocationDoc } from './location.model';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

class ItLocationRepository extends BaseRepository<ItLocationDoc> {
  constructor() {
    // Per branch (design §2): a branch-scoped `itCatalog.manage` reads its own branches' places.
    super(ItLocationModel, { branchField: 'branchId' });
  }

  /** The live place of this Arabic name in the branch, other than `excludeId` — or null. */
  async findByBranchAndNameAr(
    branchId: string,
    nameAr: string,
    excludeId?: string,
  ): Promise<ItLocationDoc | null> {
    return this.model
      .findOne({
        branchId: oid(branchId),
        'name.ar': nameAr,
        isDeleted: false,
        ...(excludeId === undefined ? {} : { _id: { $ne: oid(excludeId) } }),
      })
      .lean<ItLocationDoc>()
      .exec();
  }

  /**
   * The pickers' list — every branch's places, or one branch's; the active ones unless
   * `includeInactive`. Unscoped and unpaged, as the department options are: the rows are names,
   * and a hand-over may name a place in a branch the caller's catalog grant does not reach.
   */
  async listOptions(params: {
    branchId?: string | undefined;
    includeInactive?: boolean | undefined;
  }): Promise<ItLocationDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        ...(params.branchId === undefined ? {} : { branchId: oid(params.branchId) }),
        ...(params.includeInactive === true ? {} : { isActive: true }),
      })
      .sort({ branchId: 1, sortOrder: 1, 'name.ar': 1, _id: 1 })
      .lean<ItLocationDoc[]>()
      .exec();
  }
}

export const itLocationRepository = new ItLocationRepository();

/**
 * The custody intervals a place is named by — read here, beside the place, because the place's
 * two questions about them belong to the place: how many assets it holds now («في عهدته الآن»),
 * and whether it may be retired. Scoped exactly as the custody register is (`branchField:
 * 'branchId'`, assignment.repository.ts), so a count never shows more than the reader's
 * `itAsset.view` would list.
 *
 * An interval names a place only when a DEPARTMENT holds it (`holderKind: 'department'`), so
 * `locationId` set is the whole test. The `$type` clause lets the partial index
 * `ix_location_open` serve the read.
 */
class HeldAtLocationReader extends BaseRepository<ItAssetAssignmentDoc> {
  constructor() {
    super(ItAssetAssignmentModel, { branchField: 'branchId' });
  }

  /** Assets held at each of these places right now, as `scope` may see them. Absent = none. */
  async countOpenByLocations(
    locationIds: readonly string[],
    scope?: ScopeSelector,
  ): Promise<Map<string, number>> {
    const ids = [...new Set(locationIds)].filter((id) => Types.ObjectId.isValid(id)).map(oid);
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: this.baseFilter(scope, {
            locationId: { $in: ids, $type: 'objectId' },
            returnedAt: null,
          } as FilterQuery<ItAssetAssignmentDoc>),
        },
        { $group: { _id: '$locationId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  /** Every asset held at the place right now, whoever may see it — the retire rule's count. */
  async countOpenAt(locationId: string): Promise<number> {
    return this.count({
      locationId: { $eq: oid(locationId), $type: 'objectId' },
      returnedAt: null,
    } as FilterQuery<ItAssetAssignmentDoc>);
  }
}

export const heldAtLocationReader = new HeldAtLocationReader();
