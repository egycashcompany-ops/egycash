// Data access only (ADR-003) — the sole place Mongoose is queried for approval chains.
import { Types } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { ApprovalWorkflowModel, type ApprovalWorkflowDoc } from './workflow.model';

class ApprovalWorkflowRepository extends BaseRepository<ApprovalWorkflowDoc> {
  constructor() {
    super(ApprovalWorkflowModel, { branchField: 'branchId' });
  }

  /**
   * Every live chain for one request type.
   *
   * All of them, because choosing among them is a rule (`selectChain`) rather than a query: there
   * are a handful per type, and asking the database four times in specificity order would put that
   * rule in two places — the one certain way for the screen and the engine to disagree about which
   * chain a request is on.
   *
   * Sorted, so that a duplicate row a future migration lets past the unique index resolves the
   * same way twice rather than at random.
   */
  async findActiveForType(requestType: string): Promise<ApprovalWorkflowDoc[]> {
    return this.model
      .find({ requestType, isActive: true, isDeleted: false })
      .sort({ departmentCatalogId: 1, branchId: 1, createdAt: 1 })
      .lean<ApprovalWorkflowDoc[]>()
      .exec();
  }

  /** Every chain of every type — the configuration screen's list. */
  async listAll(): Promise<ApprovalWorkflowDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .sort({ requestType: 1, departmentCatalogId: 1, branchId: 1 })
      .lean<ApprovalWorkflowDoc[]>()
      .exec();
  }

  /** The one chain written for a place, live or not — what a save replaces. */
  async findForPlace(
    requestType: string,
    departmentCatalogId: string | null,
    branchId: string | null,
  ): Promise<ApprovalWorkflowDoc | null> {
    return this.model
      .findOne({
        requestType,
        departmentCatalogId: departmentCatalogId === null ? null : new Types.ObjectId(departmentCatalogId),
        branchId: branchId === null ? null : new Types.ObjectId(branchId),
        isDeleted: false,
      })
      .lean<ApprovalWorkflowDoc>()
      .exec();
  }
}

export const approvalWorkflowRepository = new ApprovalWorkflowRepository();
