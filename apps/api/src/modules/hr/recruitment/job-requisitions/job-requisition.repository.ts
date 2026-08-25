// Requisition data access.
//
// BOTH SCOPE AXES ARE DECLARED, and that is D-REQ-14 rather than thoroughness. `scopeFilter`
// answers a scope whose field is undeclared with `{}`, and `baseFilter` drops empty clauses — so a
// repository that forgets `departmentField` does not warn, does not fail, and does not narrow: a
// department-scoped reader is silently answered as an organization-scoped one. P-SCOPE-1 found that
// across four payroll collections. A requisition names its department in the request itself, so
// there is no version of this file where the field is absent.
import { Types } from 'mongoose';
import { type ListJobRequisitionsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { JobRequisitionModel, type JobRequisitionDoc } from './job-requisition.model';
import { JobRequisitionFillModel, type JobRequisitionFillDoc } from './job-requisition-fill.model';

class JobRequisitionRepository extends BaseRepository<JobRequisitionDoc> {
  constructor() {
    super(JobRequisitionModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  async listScoped(
    query: ListJobRequisitionsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<JobRequisitionDoc>> {
    const search = query.search === undefined ? undefined : query.search.trim();
    return this.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'neededBy', 'quantity', 'code'],
      scope,
      filter: {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.priority === undefined ? {} : { priority: query.priority }),
        ...(query.departmentId === undefined
          ? {}
          : { departmentId: new Types.ObjectId(query.departmentId) }),
        ...(query.branchId === undefined ? {} : { branchId: new Types.ObjectId(query.branchId) }),
        ...(query.jobTitleId === undefined
          ? {}
          : { jobTitleId: new Types.ObjectId(query.jobTitleId) }),
        // Free text reaches two fields only, and both are this module's own strings — the code a
        // person quotes on the phone, and the reason they wrote. No field path comes from the query.
        ...(search === undefined || search === ''
          ? {}
          : {
              $or: [
                { code: { $regex: escapeRegex(search), $options: 'i' } },
                { reason: { $regex: escapeRegex(search), $options: 'i' } },
              ],
            }),
      } as never,
    });
  }

  /** How many hires stand against this requisition — the derived count, never a stored one. */
  async countFills(requisitionId: string): Promise<number> {
    return JobRequisitionFillModel.countDocuments({
      requisitionId: new Types.ObjectId(requisitionId),
      isDeleted: false,
    }).exec();
  }

  /** The same count for several requisitions at once, so a list page is one round trip. */
  async countFillsFor(requisitionIds: readonly string[]): Promise<Map<string, number>> {
    const ids = [...new Set(requisitionIds)].map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const rows = await JobRequisitionFillModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { requisitionId: { $in: ids }, isDeleted: false } },
      { $group: { _id: '$requisitionId', count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((row) => [String(row._id), row.count]));
  }

  async listFills(requisitionId: string): Promise<JobRequisitionFillDoc[]> {
    return JobRequisitionFillModel.find({
      requisitionId: new Types.ObjectId(requisitionId),
      isDeleted: false,
    })
      .sort({ filledAt: 1 })
      .lean<JobRequisitionFillDoc[]>()
      .exec();
  }
}

/** Mongo takes the pattern literally otherwise, and a `.` in a search box is not a wildcard. */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const jobRequisitionRepository = new JobRequisitionRepository();
