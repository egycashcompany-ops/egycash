import { Types, type ClientSession } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { ItAssetAssignmentModel, type ItAssetAssignmentDoc } from './assignment.model';

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

  async listFiltered(params: {
    open?: boolean | undefined;
    assetId?: string | undefined;
    employeeId?: string | undefined;
    branchId?: string | undefined;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<ItAssetAssignmentDoc>> {
    const filter: Record<string, unknown> = {};
    if (params.open === true) filter.returnedAt = null;
    if (params.open === false) filter.returnedAt = { $ne: null };
    if (params.assetId !== undefined) filter.assetId = new Types.ObjectId(params.assetId);
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
      sortableFields: ['assignedAt', 'returnedAt', 'expectedReturnAt', 'createdAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const itAssetAssignmentRepository = new ItAssetAssignmentRepository();
