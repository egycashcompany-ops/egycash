import { type FilterQuery } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { AutomationWorkflowModel, type AutomationWorkflowDoc } from './workflow.model';

class AutomationWorkflowRepository extends BaseRepository<AutomationWorkflowDoc> {
  constructor() {
    super(AutomationWorkflowModel, {
      branchField: 'branchId',
      // `own` scope means "workflows I own" rather than "workflows I created". They are usually
      // the same, and after a `workflow.transfer` they are not — and it is ownership, not
      // authorship, that decides what a workflow can do (§7.2).
      ownerUserField: 'ownerUserId',
    });
  }

  async findByKey(key: string): Promise<AutomationWorkflowDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).exec();
  }

  /** Every workflow a user owns, whatever its state — the input to suspend-on-deactivate. */
  async listByOwner(ownerUserId: string): Promise<AutomationWorkflowDoc[]> {
    return this.model
      .find({ ownerUserId, isDeleted: false } as FilterQuery<AutomationWorkflowDoc>)
      .exec();
  }

  /**
   * The dispatch lookup (design §8, `ix_dispatch`): active event-triggered workflows for one event
   * name. Runs on every published event, so it must hit the index — and it does, on
   * `{trigger.event, status}`.
   */
  async listActiveByEvent(eventName: string): Promise<AutomationWorkflowDoc[]> {
    return this.model
      .find({
        'trigger.kind': 'event',
        'trigger.event': eventName,
        status: 'active',
        isDeleted: false,
      } as FilterQuery<AutomationWorkflowDoc>)
      .exec();
  }
}

export const automationWorkflowRepository = new AutomationWorkflowRepository();
