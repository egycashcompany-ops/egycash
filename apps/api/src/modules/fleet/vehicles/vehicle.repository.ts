import { type FilterQuery, Types } from 'mongoose';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { type Paginated } from '@ecms/contracts';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';

class FleetVehicleRepository extends BaseRepository<FleetVehicleDoc> {
  constructor() {
    // Vehicles are branch-scoped assets (design §7): a branch-scoped caller sees that branch's
    // fleet, exactly as the legacy hardcoded `المهندسين` filter intended (§13-Q4 answered).
    super(FleetVehicleModel, { branchField: 'branchId', departmentField: 'departmentId' });
  }

  async findByCode(code: string): Promise<FleetVehicleDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<FleetVehicleDoc>().exec();
  }

  async listVehicles(params: ListParams<FleetVehicleDoc>): Promise<Paginated<FleetVehicleDoc>> {
    return this.list({ ...params, sortableFields: ['code', 'createdAt', 'licenseExpiresAt'] });
  }

  /**
   * Codes for a KNOWN set of ids, in one query — for the screens that print a code beside a row
   * whose vehicle they hold only by id.
   *
   * Deliberately not paginated and deliberately not `isDeleted`-filtered. The ids come from rows
   * the caller is already reading, so there is no list to bound; and a reading taken on a car that
   * has since been scrapped still belongs to that car, so its code stays readable rather than
   * turning into a dash the day the registry entry goes.
   */
  async codesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select({ code: 1 })
      .lean<{ _id: Types.ObjectId; code: string }[]>()
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.code]));
  }

  /**
   * The ids of every vehicle whose CODE contains `term`, case-insensitively.
   *
   * The screens that file paperwork against a car — accidents, maintenance — store the car by id
   * and show it by code, so a reader typing "21" is asking a question this collection has to
   * answer before the other one can be filtered at all.
   *
   * Deliberately unpaginated: the answer is a filter, not a page, and truncating it would quietly
   * hide rows whose vehicle happened to sort late. Deliberately not `isDeleted`-filtered, for the
   * same reason `codesByIds` is not: an accident recorded against a car that has since been
   * scrapped is still that car's file, and a code search that stopped finding it the day the
   * registry entry went would be losing history, not tidying it.
   *
   * An empty result is a real answer — no vehicle carries that code — and callers must narrow to
   * NOTHING on it rather than dropping the filter.
   */
  async idsByCodeSearch(term: string): Promise<string[]> {
    const rows = await this.model
      .find(vehicleIdentifierFilter('code', term))
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => String(row._id));
  }
}

const escaped = (term: string): RegExp =>
  new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** Substring search over the four physical identifiers at once (design §2.1 list page). */
export const vehicleSearchFilter = (term: string): FilterQuery<FleetVehicleDoc> => {
  const rx = escaped(term);
  return {
    $or: [{ code: rx }, { plateNumber: rx }, { chassisNumber: rx }, { motorNumber: rx }],
  };
};

/**
 * ONE identifier, narrowed. The per-column filters are ANDed by the caller, which is what makes
 * "plate 123 AND chassis ABC" answerable — `vehicleSearchFilter` can only ever answer "either".
 */
export const vehicleIdentifierFilter = (
  field: 'code' | 'plateNumber' | 'chassisNumber' | 'motorNumber',
  term: string,
): FilterQuery<FleetVehicleDoc> => ({ [field]: escaped(term) }) as FilterQuery<FleetVehicleDoc>;

export const fleetVehicleRepository = new FleetVehicleRepository();
