import { type FilterQuery, Types } from 'mongoose';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import { type ListFleetVehiclesQuery, type Paginated } from '@ecms/contracts';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';
import { FleetVehicleTypeModel } from '../vehicle-types/vehicle-type.model';

/**
 * «كود السيارة», as a sort key for the registers that REFERENCE a car.
 *
 * An odometer reading, a workshop visit, an accident file and a fine all store a `vehicleId`, and
 * the reader orders them by the car's CODE — which lives on the vehicle. So the code is joined in
 * before the page is cut (see `SortDerivedField`): sorting the fetched page instead would order
 * twenty-five rows out of two thousand and call it the register's order.
 *
 * One declaration, shared, so the four registers cannot drift into four spellings of one column.
 */
export const VEHICLE_CODE_SORT = {
  key: 'vehicleCode',
  from: FleetVehicleModel.collection.name,
  localField: 'vehicleId',
  pick: 'code',
} as const;

/**
 * «النوع» — the make, as a sort key for the registry itself.
 *
 * The vehicle stores a `typeId` and the column prints the type's NAME. Ordered by the ARABIC name,
 * which is what this screen is read in; an English-only type falls back to nothing and sorts last,
 * the same as any other missing value.
 */
export const VEHICLE_TYPE_NAME_SORT = {
  key: 'typeName',
  from: FleetVehicleTypeModel.collection.name,
  localField: 'typeId',
  pick: 'name.ar',
} as const;

class FleetVehicleRepository extends BaseRepository<FleetVehicleDoc> {
  constructor() {
    // Vehicles are branch-scoped assets (design §7): a branch-scoped caller sees that branch's
    // fleet, exactly as the legacy hardcoded `المهندسين` filter intended (§13-Q4 answered).
    super(FleetVehicleModel, { branchField: 'branchId', departmentField: 'departmentId' });
  }

  async findByCode(code: string): Promise<FleetVehicleDoc | null> {
    return this.model.findOne({ code, isDeleted: false }).lean<FleetVehicleDoc>().exec();
  }

  /**
   * The live holder of one of FR-1's other unique identifiers — plate, chassis or motor number.
   *
   * All four carry a partial unique index over non-deleted rows, so a caller that checks only
   * `code` before writing learns about the rest from a mid-write database rejection. This is what
   * lets an importer ask the question up front, while nothing has been written yet.
   */
  async findOneBy(
    where: Partial<Pick<FleetVehicleDoc, 'plateNumber' | 'chassisNumber' | 'motorNumber'>>,
  ): Promise<FleetVehicleDoc | null> {
    return this.model
      .findOne({ ...where, isDeleted: false })
      .lean<FleetVehicleDoc>()
      .exec();
  }

  async listVehicles(params: ListParams<FleetVehicleDoc>): Promise<Paginated<FleetVehicleDoc>> {
    return this.list({
      ...params,
      sortableFields: ['code', 'createdAt', 'licenseExpiresAt', VEHICLE_TYPE_NAME_SORT.key],
      sortDerived: [VEHICLE_TYPE_NAME_SORT],
    });
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

  /**
   * The ids of the vehicles carrying EXACTLY these codes — the vehicle-code picker's question.
   *
   * The exact sibling of `idsByCodeSearch`, and unpaginated, not `isDeleted`-filtered and honest
   * about emptiness for the same three reasons spelled out there. Exact because a ticked checkbox
   * names one car and cannot mean "and everything containing it": that is what `search` is for.
   */
  /**
   * The ids of the ACTIVE vehicles a plain filter matches — the dashboard's bridge from a branch
   * to the collections that reach a branch only through their vehicle (visits, accidents).
   *
   * Deliberately narrow: it takes a filter fragment and answers ids, so the caller composes the
   * scope and this stays the one place that knows a vehicle is `isDeleted: false`.
   */
  async idsMatching(filter: Record<string, unknown>): Promise<Types.ObjectId[]> {
    const rows = await this.model
      .find({ isDeleted: false, ...filter }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id);
  }

  /**
   * Every vehicle's code → id, in one read — the go-live imports' join, which brings twenty
   * thousand legacy rows across by the car code each one names. Deleted cars included, for the
   * reason `idsByCodes` gives: their history is still their history.
   */
  async codeIndex(): Promise<Map<string, string>> {
    const rows = await this.model
      .find({})
      .select({ code: 1 })
      .lean<{ _id: Types.ObjectId; code: string }[]>()
      .exec();
    return new Map(rows.map((row) => [row.code, String(row._id)]));
  }

  async idsByCodes(codes: readonly string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const rows = await this.model
      .find({ code: { $in: [...codes] } })
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

/**
 * THE WHOLE REGISTRY FILTER, as one pure function — every control on the bar, in one place.
 *
 * Pure so it can be read and tested without a database: what a filter MEANS is a decision, and
 * the decisions here are the ones that are easy to get quietly wrong — «several makes» has to OR
 * inside itself and AND with «several classes», and «nothing ticked» has to mean no filter at
 * all rather than an empty `$in` that matches no car in the fleet.
 *
 * SEVERAL VALUES PER REFERENCE FILTER — «اى فلتر ف الحركه زياده عن اتنين اختار ما بينهم اعملى
 * multi selection». One ticked value is a one-element `$in`, which is the same query the old
 * equality was, so every link saved before the multi-select answers exactly as it did.
 */
export const vehicleListFilter = (
  query: Pick<
    ListFleetVehiclesQuery,
    | 'status'
    | 'typeId'
    | 'branchId'
    | 'licenseClassId'
    | 'operationId'
    | 'insuranceCompanyId'
    | 'vehicleCodes'
    | 'code'
    | 'plateNumber'
    | 'chassisNumber'
    | 'motorNumber'
    | 'licenseExpiresBefore'
    | 'search'
  >,
): FilterQuery<FleetVehicleDoc> => {
  const clauses: FilterQuery<FleetVehicleDoc>[] = [];
  // The status is a word, the other five are ids — same shape, different cast.
  if (query.status !== undefined) clauses.push({ status: { $in: [...query.status] } });
  for (const [values, field] of [
    [query.typeId, 'typeId'],
    [query.branchId, 'branchId'],
    [query.licenseClassId, 'licenseClassId'],
    [query.operationId, 'operationId'],
    [query.insuranceCompanyId, 'insuranceCompanyId'],
  ] as const) {
    if (values === undefined) continue;
    clauses.push({ [field]: { $in: values.map((id) => new Types.ObjectId(id)) } });
  }
  // The vehicle-code picker: the cars named EXACTLY, ORed. Exact where `search` is substring,
  // because a checkbox can only mean the code it ticks. A code no car carries leaves an empty
  // `$in`, which matches nothing — the honest answer to a pick the registry does not have.
  if (query.vehicleCodes !== undefined) clauses.push({ code: { $in: [...query.vehicleCodes] } });
  // Per-identifier narrowing, ANDed with everything else — see `vehicleIdentifierFilter`.
  for (const [value, field] of [
    [query.code, 'code'],
    [query.plateNumber, 'plateNumber'],
    [query.chassisNumber, 'chassisNumber'],
    [query.motorNumber, 'motorNumber'],
  ] as const) {
    if (value !== undefined) clauses.push(vehicleIdentifierFilter(field, value));
  }
  if (query.licenseExpiresBefore !== undefined) {
    clauses.push({ licenseExpiresAt: { $lte: query.licenseExpiresBefore } });
  }
  if (query.search !== undefined) clauses.push(vehicleSearchFilter(query.search));
  return clauses.length === 0 ? {} : { $and: clauses };
};

export const fleetVehicleRepository = new FleetVehicleRepository();
