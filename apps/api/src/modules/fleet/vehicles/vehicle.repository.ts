import { type ClientSession, type FilterQuery, Types } from 'mongoose';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import {
  FLEET_FIRST_WORKING_CODE,
  type ListFleetVehiclesQuery,
  type Paginated,
} from '@ecms/contracts';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';
import { FleetVehicleTypeModel } from '../vehicle-types/vehicle-type.model';

/**
 * THE SAME THREE GROUPS `fleetVehicleCodeOrderKey` builds, spelled as an aggregation expression.
 *
 * «اى عربيات تتعرض من اول 150 وانت طالع ... وبعدين الملاكى اللى هما بيبدا 61». The working fleet
 * first counting up, then the cars written in words, then «الملاكى» below 150.
 *
 * WRITTEN TWICE, DELIBERATELY, AND TESTED AGAINST ITS TWIN. The browser cannot run an aggregation
 * expression and Mongo cannot run a TypeScript function, so the rule has to exist in both
 * languages; what must not happen is the two DRIFTING, which is why the contract owns the rule,
 * the boundary constant is imported rather than spelled, and a spec walks the same codes through
 * both and expects the same order.
 *
 * `$convert` with `onError: null` is the numeric test as well as the conversion: a code that is
 * not a plain number simply fails to convert and falls to the middle group, which is exactly the
 * regular expression the contract uses, without a second pattern to keep in step.
 */
export const vehicleCodeOrder = (ref: string): unknown => ({
  $let: {
    vars: {
      n: { $convert: { input: ref, to: 'long', onError: null, onNull: null } },
      // LEFT-padded to a fixed width, so that text order and numeric order agree: the last twenty
      // characters of «00000000000000000000150» are «150» with nineteen zeros in front of it.
      padded: {
        $let: {
          vars: { s: { $concat: ['00000000000000000000', ref] } },
          in: {
            $substrCP: ['$$s', { $subtract: [{ $strLenCP: '$$s' }, 20] }, 20],
          },
        },
      },
    },
    in: {
      $cond: [
        { $eq: [{ $ifNull: [ref, null] }, null] },
        // No code at all — a row kept from the old book. Left null, which the missing-value flag
        // beside every derived sort already sends to the end.
        null,
        {
          $cond: [
            { $eq: ['$$n', null] },
            { $concat: ['1', ref] },
            {
              $concat: [
                { $cond: [{ $gte: ['$$n', FLEET_FIRST_WORKING_CODE] }, '0', '2'] },
                '$$padded',
              ],
            },
          ],
        },
      ],
    },
  },
});

/**
 * The registry's OWN code column, ordered by the same rule.
 *
 * A key of its own rather than computing over `code` in place: the derived machinery projects a
 * computed key away after sorting, so naming it `code` would strip the real column off every row
 * the registry hands back. `listVehicles` maps a request for `code` onto this.
 */
export const VEHICLE_CODE_ORDER_SORT = {
  key: 'codeOrder',
  expression: vehicleCodeOrder('$code'),
} as const;

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
  // …and ordered by the FLEET's rule, not by the text of the code — see `vehicleCodeOrder`.
  order: vehicleCodeOrder('$vehicleCode'),
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

  /**
   * The registry, ordered by the FLEET's rule whenever the reader asks for «كود السيارة».
   *
   * A request for `code` is rewritten onto `codeOrder` — the same column, the fleet's own three
   * groups — before it reaches the generic list. Rewritten rather than exposed: `code:asc` is
   * what every screen, every saved link and every other module's caller already sends, and the
   * rule is not a second sort a reader chooses between. Nothing about the request or the rows
   * changes; only the order does.
   */
  async listVehicles(params: ListParams<FleetVehicleDoc>): Promise<Paginated<FleetVehicleDoc>> {
    const ORDER = VEHICLE_CODE_ORDER_SORT.key;
    return this.list({
      ...params,
      ...(params.sortBy === 'code' ? { sortBy: ORDER } : {}),
      ...(params.sorts === undefined
        ? {}
        : {
            sorts: params.sorts.map((entry) =>
              entry.by === 'code' ? { ...entry, by: ORDER } : entry,
            ),
          }),
      sortableFields: ['code', ORDER, 'createdAt', 'licenseExpiresAt', VEHICLE_TYPE_NAME_SORT.key],
      sortDerived: [VEHICLE_TYPE_NAME_SORT, VEHICLE_CODE_ORDER_SORT],
    });
  }

  /**
   * Which of these vehicles point at one of these licence classes — a membership question, asked
   * about a known set of ids and answered without loading the registry.
   *
   * Unscoped and not `isDeleted`-filtered, deliberately: the caller (the licensing board's sweep)
   * is asking «is this car still on the board at all», which is a fact about the fleet rather than
   * about who is looking. Answered under a scope it would report every other branch's cars as
   * gone, and the sweep would retire their marks.
   */
  async idsOfClasses(
    vehicleIds: readonly string[],
    classIds: readonly string[],
  ): Promise<Set<string>> {
    if (vehicleIds.length === 0 || classIds.length === 0) return new Set();
    const rows = await this.model
      .find({
        _id: { $in: vehicleIds.map((id) => new Types.ObjectId(id)) },
        licenseClassId: { $in: classIds.map((id) => new Types.ObjectId(id)) },
      })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row._id)));
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
  /**
   * Take the car's accident-transfer lock for the rest of `session`'s transaction.
   *
   * Two clerks taking from one car at the same moment would each read its whole remaining and
   * each be allowed to take it. Writing to the car FIRST makes the second transaction conflict
   * with the first and re-run after it commits — reading the remaining the first one left. The
   * native driver, deliberately: this is a lock, not an edit, so the car's `__v` and `updatedAt`
   * stay as they are and no DTO ever carries the counter.
   */
  async lockForAccidentTransfer(id: string, session: ClientSession): Promise<void> {
    await this.model.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $inc: { accidentTransferSeq: 1 } },
      { session },
    );
  }

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
