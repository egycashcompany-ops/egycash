import { type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { AutomationExecutionModel, type AutomationExecutionDoc } from './execution.model';

class AutomationExecutionRepository extends BaseRepository<AutomationExecutionDoc> {
  constructor() {
    // Operational collection: no soft-delete (an execution record is history, never "deleted").
    super(AutomationExecutionModel, { branchField: 'branchId', softDelete: false });
  }

  /**
   * Create the row, or report that this (event, workflow) already has one. The unique index is the
   * real guard; catching its duplicate-key error is how idempotency survives a race between two
   * workers rather than a check-then-write that has a window.
   */
  async createIfNew(
    doc: Partial<AutomationExecutionDoc>,
  ): Promise<{ created: boolean; doc: AutomationExecutionDoc | null }> {
    try {
      const created = await AutomationExecutionModel.create(doc);
      return { created: true, doc: created };
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
        return { created: false, doc: null };
      }
      throw error;
    }
  }

  async setOutcome(
    id: Types.ObjectId,
    patch: Partial<
      Pick<AutomationExecutionDoc, 'status' | 'providerRef' | 'error' | 'finishedAt' | 'startedAt'>
    >,
  ): Promise<void> {
    await AutomationExecutionModel.updateOne({ _id: id }, { $set: patch }).exec();
  }
}

export const automationExecutionRepository = new AutomationExecutionRepository();
