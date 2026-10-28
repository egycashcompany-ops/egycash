import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { cairoDayEnd, cairoDayStart } from '../shared/cairo-day';
import { ItAssetAssignmentModel, type ItAssetAssignmentDoc } from './assignment.model';

/**
 * A date window on one field: from the start of its «من» day through the end of its «إلى» day,
 * however precisely the interval was stamped. The days are CAIRO days, the days the table prints:
 * the hand-over, return and transfer dialogs stamp the moment they were typed, so a hand-over at
 * 01:30 in Cairo is the previous day in UTC, and only Cairo's midnight puts it under its own day.
 */
const dayWindow = (
  field: 'assignedAt' | 'returnedAt',
  from: Date | undefined,
  to: Date | undefined,
): FilterQuery<ItAssetAssignmentDoc> | null =>
  from === undefined && to === undefined
    ? null
    : {
        [field]: {
          ...(from === undefined ? {} : { $gte: cairoDayStart(from) }),
          ...(to === undefined ? {} : { $lt: cairoDayEnd(to) }),
        },
      };

/**
 * The register's filters with every set they name already READ (`assignment.service`): the assets
 * the asset-side filters matched and the receipts that are signed. This file only says how each
 * becomes a condition, which keeps the translation pure — and pinned by its spec.
 */
export interface ItAssignmentRegisterFilter {
  open?: boolean | undefined;
  assetId?: string | undefined;
  /**
   * The assets «الصنف» and the category matched, read under the caller's scope. Absent: no such
   * filter. EMPTY: nothing matched — and `$in: []` matches nothing, which is the honest answer
   * rather than an unfiltered page.
   */
  assetIds?: readonly Types.ObjectId[] | undefined;
  employeeId?: string | undefined;
  branchId?: string | undefined;
  assignedFrom?: Date | undefined;
  assignedTo?: Date | undefined;
  /** Only a closed interval has a return day, so either bound alone leaves out every open one. */
  returnedFrom?: Date | undefined;
  returnedTo?: Date | undefined;
  /** `true`: still out past «موعد الإعادة». `false`: every other interval — the complement. */
  overdue?: boolean | undefined;
  receipt?:
    | { state: 'none' }
    | { state: 'signed' | 'unsigned'; signedReceiptIds: readonly Types.ObjectId[] }
    | undefined;
}

/**
 * The register's filters as ONE database filter. Every filter is its own clause under `$and`, so
 * two that touch the same field — the status and the return window both read `returnedAt`, the
 * asset and the «الصنف» search both `assetId` — narrow together instead of one overwriting the
 * other. `now` is the moment «overdue» is judged at: the request's own, handed in.
 */
export const assignmentRegisterFilter = (
  params: ItAssignmentRegisterFilter,
  now: Date,
): FilterQuery<ItAssetAssignmentDoc> => {
  const clauses: FilterQuery<ItAssetAssignmentDoc>[] = [];
  if (params.open === true) clauses.push({ returnedAt: null });
  if (params.open === false) clauses.push({ returnedAt: { $ne: null } });
  if (params.assetId !== undefined) clauses.push({ assetId: new Types.ObjectId(params.assetId) });
  if (params.assetIds !== undefined) clauses.push({ assetId: { $in: [...params.assetIds] } });
  if (params.employeeId !== undefined) {
    clauses.push({ assignedToEmployeeId: new Types.ObjectId(params.employeeId) });
  }
  if (params.branchId !== undefined) {
    clauses.push({ branchId: new Types.ObjectId(params.branchId) });
  }
  for (const window of [
    dayWindow('assignedAt', params.assignedFrom, params.assignedTo),
    dayWindow('returnedAt', params.returnedFrom, params.returnedTo),
  ]) {
    if (window !== null) clauses.push(window);
  }
  // A due date that has passed only matters while the asset is still out: returned late is
  // returned. A comparison never matches a null, so an interval with no due date is never overdue.
  if (params.overdue === true) {
    clauses.push({ returnedAt: null }, { expectedReturnAt: { $lt: now } });
  }
  if (params.overdue === false) {
    clauses.push({
      $or: [
        { returnedAt: { $ne: null } },
        { expectedReturnAt: null },
        { expectedReturnAt: { $gte: now } },
      ],
    });
  }
  // «إيصال الاستلام» as the receipt column reads it: no paper, a paper whose signed copy is filed,
  // or a paper still waiting for it. `null` also matches an interval from before receipts, which
  // carries no `receiptId` at all.
  if (params.receipt?.state === 'none') clauses.push({ receiptId: null });
  if (params.receipt?.state === 'signed') {
    clauses.push({ receiptId: { $in: [...params.receipt.signedReceiptIds] } });
  }
  if (params.receipt?.state === 'unsigned') {
    clauses.push({ receiptId: { $ne: null, $nin: [...params.receipt.signedReceiptIds] } });
  }
  if (clauses.length === 0) return {};
  return clauses.length === 1
    ? (clauses[0] as FilterQuery<ItAssetAssignmentDoc>)
    : { $and: clauses };
};

class ItAssetAssignmentRepository extends BaseRepository<ItAssetAssignmentDoc> {
  constructor() {
    // Branch-scoped like the assets themselves (design §7): a branch-scoped technician sees the
    // custody of that branch's assets and no other's.
    super(ItAssetAssignmentModel, { branchField: 'branchId' });
  }

  /** The open interval for an asset, or null. Reads inside the transaction when one is given. */
  async findOpenForAsset(
    assetId: string,
    session?: ClientSession,
  ): Promise<ItAssetAssignmentDoc | null> {
    const query = this.model.findOne({
      assetId: new Types.ObjectId(assetId),
      returnedAt: null,
      isDeleted: false,
    });
    if (session !== undefined) query.session(session);
    return query.lean<ItAssetAssignmentDoc>().exec();
  }

  /**
   * How many assets each of these people holds right now, as the reader may see it — ONE `$group`
   * for a page of people, never a count per row. Scoped like every custody read, so a branch-scoped
   * technician counts their branch's assets and not another's. People holding nothing are absent.
   */
  async countOpenByEmployees(
    employeeIds: readonly string[],
    scope?: ScopeSelector,
  ): Promise<Map<string, number>> {
    const ids = employeeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: this.baseFilter(scope, {
            assignedToEmployeeId: { $in: ids },
            returnedAt: null,
          }),
        },
        { $group: { _id: '$assignedToEmployeeId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  /** Everything an employee currently holds — the exit checklist's question (§9.1). */
  async listOpenForEmployee(employeeId: string): Promise<ItAssetAssignmentDoc[]> {
    return this.model
      .find({
        assignedToEmployeeId: new Types.ObjectId(employeeId),
        returnedAt: null,
        isDeleted: false,
      })
      .lean<ItAssetAssignmentDoc[]>()
      .exec();
  }

  async listFiltered(
    params: ItAssignmentRegisterFilter & {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
      scope?: ScopeSelector | undefined;
      /** When «overdue» is judged — the request's moment; now, when the caller names none. */
      now?: Date | undefined;
    },
  ): Promise<Paginated<ItAssetAssignmentDoc>> {
    return this.list({
      filter: assignmentRegisterFilter(params, params.now ?? new Date()),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['assignedAt', 'returnedAt', 'expectedReturnAt', 'createdAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const itAssetAssignmentRepository = new ItAssetAssignmentRepository();
