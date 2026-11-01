import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type ItMobileLineHolderKind, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { collectionReady } from './ensure-collection';
import {
  ItMobileLineAssignmentModel,
  type ItMobileLineAssignmentDoc,
} from './line-assignment.model';

class ItMobileLineAssignmentRepository extends BaseRepository<ItMobileLineAssignmentDoc> {
  readonly ensureCollection = collectionReady(ItMobileLineAssignmentModel);

  constructor() {
    // Branch-scoped like the lines: a branch-scoped technician sees that branch's custody only.
    super(ItMobileLineAssignmentModel, { branchField: 'branchId' });
  }

  /** The open interval of a line, or null. Inside the transaction when one is given. */
  async findOpenForLine(
    lineId: string,
    session?: ClientSession,
  ): Promise<ItMobileLineAssignmentDoc | null> {
    const query = this.model.findOne({
      lineId: new Types.ObjectId(lineId),
      returnedAt: null,
      isDeleted: false,
    });
    if (session !== undefined) query.session(session);
    return query.lean<ItMobileLineAssignmentDoc>().exec();
  }

  /**
   * Move a line's OPEN interval to the branch the line moved to — inside the line edit's own
   * transaction — and answer the paper it names (null when none). A closed interval keeps the
   * branch it was held in: that is where it happened.
   */
  async moveOpenToBranch(
    lineId: string,
    branchId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId | null> {
    const moved = await this.model
      .findOneAndUpdate(
        { lineId: new Types.ObjectId(lineId), returnedAt: null, isDeleted: false },
        { $set: { branchId }, $inc: { __v: 1 } },
        { new: true, session },
      )
      .lean<ItMobileLineAssignmentDoc>()
      .exec();
    return moved?.receiptId ?? null;
  }

  /** Every line an employee holds right now — the exit safety net's question. */
  async listOpenForEmployee(employeeId: string): Promise<ItMobileLineAssignmentDoc[]> {
    return this.model
      .find({
        assignedToEmployeeId: new Types.ObjectId(employeeId),
        returnedAt: null,
        isDeleted: false,
      })
      .lean<ItMobileLineAssignmentDoc[]>()
      .exec();
  }

  /**
   * The ids of the OPEN intervals matching a holder filter — by employee, by kind, by a car's code
   * or plate — for the register to match lines against. Unscoped on purpose: the register applies
   * the caller's scope to the LINES, exactly as the asset register does with its holder filter.
   */
  async openIdsMatching(params: {
    employeeId?: string | undefined;
    holderKind?: ItMobileLineHolderKind | undefined;
    vehicle?: RegExp | undefined;
  }): Promise<Types.ObjectId[]> {
    const filter: FilterQuery<ItMobileLineAssignmentDoc> = { returnedAt: null, isDeleted: false };
    if (params.employeeId !== undefined) {
      filter.assignedToEmployeeId = new Types.ObjectId(params.employeeId);
    }
    if (params.holderKind !== undefined) filter.holderKind = params.holderKind;
    if (params.vehicle !== undefined) {
      filter.$or = [{ vehicleCode: params.vehicle }, { vehiclePlate: params.vehicle }];
    }
    const rows = await this.model.find(filter, { _id: 1 }).lean<{ _id: Types.ObjectId }[]>().exec();
    return rows.map((row) => row._id);
  }

  async listFiltered(params: {
    open?: boolean | undefined;
    lineId?: string | undefined;
    employeeId?: string | undefined;
    branchId?: string | undefined;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<ItMobileLineAssignmentDoc>> {
    const filter: FilterQuery<ItMobileLineAssignmentDoc> = {};
    if (params.open === true) filter.returnedAt = null;
    if (params.open === false) filter.returnedAt = { $ne: null };
    if (params.lineId !== undefined) filter.lineId = new Types.ObjectId(params.lineId);
    if (params.employeeId !== undefined) {
      filter.assignedToEmployeeId = new Types.ObjectId(params.employeeId);
    }
    if (params.branchId !== undefined) filter.branchId = new Types.ObjectId(params.branchId);
    return this.list({
      filter,
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['assignedAt', 'returnedAt', 'createdAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const itMobileLineAssignmentRepository = new ItMobileLineAssignmentRepository();
